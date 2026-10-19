using System.Text.Json;

namespace CameraBridge;

/// <summary>Owns the open camera: acquisition thread, live view, grabs, settings, recording.</summary>
public sealed class CameraService
{
    private readonly List<ICameraDriver> _drivers;
    private readonly Storage _storage;
    private readonly WsHub _hub;
    private readonly BridgeConfig _cfg;
    private readonly Log _log;

    private readonly object _dev_lock = new();   // every call into the device
    private ICameraDevice _dev;
    private CameraInfo _info;
    private Thread _thread;
    private volatile bool _run;
    private string _wanted;                       // camera to keep connected (reconnect after unplug)

    private volatile string _trigger = "free";    // free | software | hardware
    private double _expUs = 10000;
    private bool _swIssued;
    private long _lastIndex, _frames, _errors;
    private string _lastError = "";
    private double _fps; private DateTime _fpsT = DateTime.Now; private long _fpsN;
    private int _w, _h; private string _pixFmt = "";

    private readonly SemaphoreSlim _grabSem = new(1, 1);
    private TaskCompletionSource<Frame> _grabTcs;
    private long _grabAfter;

    private CancellationTokenSource _recCts;
    private object _recState;

    public CameraService(List<ICameraDriver> drivers, Storage storage, WsHub hub, BridgeConfig cfg, Log log)
    {
        _drivers = drivers; _storage = storage; _hub = hub; _cfg = cfg; _log = log;
        _ = Task.Run(Watchdog);
    }

    public bool Connected => _dev != null;
    public CameraInfo Current => _info;

    // ---------------- cameras ----------------
    public List<CameraInfo> ListCameras()
    {
        var list = new List<CameraInfo>();
        foreach (var d in _drivers.Where(d => d.Available))
        {
            try { list.AddRange(d.Enumerate()); }
            catch (Exception e) { _log.Warn($"{d.Name}: enumerate failed: {e.Message}"); }
        }
        foreach (var c in list) c.Name = _cfg.CameraNames.TryGetValue(c.Serial, out var n) ? n : "";
        // the open camera may not be listed again by some drivers: keep it in the list
        if (_info != null && !list.Any(c => c.Id == _info.Id)) list.Insert(0, _info);
        return list;
    }

    public object Open(string id)
    {
        var cams = ListCameras();
        var info = string.IsNullOrEmpty(id)
            ? cams.FirstOrDefault(c => !string.IsNullOrEmpty(_cfg.DefaultCamera) && c.Serial == _cfg.DefaultCamera) ?? cams.FirstOrDefault(c => c.Driver != "sim") ?? cams.FirstOrDefault()
            : cams.FirstOrDefault(c => c.Id == id || c.Serial == id);
        if (info == null) throw new BridgeException(cams.Count == 0 ? "No camera found. Check the cable (USB 3.0 / network) and that pylon Viewer and the MVS client are closed." : $"Camera {id} not found.");
        if (_info?.Id == info.Id && _dev != null) return Status();
        Close(false);
        var drv = _drivers.First(d => d.Name == info.Driver);
        var dev = drv.Open(info);
        lock (_dev_lock)
        {
            _dev = dev; _info = info; _lastIndex = 0; _frames = 0; _errors = 0; _lastError = ""; _swIssued = false;
            RefreshState();
            try { dev.StartAcquisition(); } catch (Exception e) { _log.Error("start acquisition: " + e.Message); }
        }
        _wanted = info.Id;
        _run = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "acquisition" };
        _thread.Start();
        _log.Info($"camera opened: {info.Model} {info.Serial} ({info.Driver})");
        _hub.Broadcast(new { type = "state", status = Status() });
        return Status();
    }

    public void Close(bool forget = true)
    {
        if (forget) _wanted = null;
        _run = false;
        var t = _thread; _thread = null;
        if (t != null && t != Thread.CurrentThread) t.Join(3000);
        lock (_dev_lock)
        {
            if (_dev != null)
            {
                try { _dev.Dispose(); } catch (Exception e) { _log.Warn("close: " + e.Message); }
                _log.Info($"camera closed: {_info?.Model} {_info?.Serial}");
            }
            _dev = null; _info = forget ? null : _info;
        }
        _grabTcs?.TrySetException(new BridgeException("camera closed"));
        _hub.Broadcast(new { type = "state", status = Status() });
    }

    /// <summary>Reconnects the wanted camera after it was unplugged; auto-connects at start.</summary>
    private async Task Watchdog()
    {
        await Task.Delay(1500);
        if (_cfg.AutoConnect && _dev == null)
        {
            try { Open(string.IsNullOrEmpty(_cfg.DefaultCamera) ? null : _cfg.DefaultCamera); } catch (Exception e) { _log.Info("auto-connect: " + e.Message); }
        }
        while (true)
        {
            await Task.Delay(3000);
            if (_wanted != null && _dev == null)
            {
                try { Open(_wanted); _log.Info("camera reconnected"); }
                catch { /* try again */ }
            }
            try { if (DateTime.Now.Minute == 0 && DateTime.Now.Second < 3) _storage.Cleanup(); } catch { }
        }
    }

    // ---------------- acquisition loop ----------------
    private void Loop()
    {
        while (_run)
        {
            var dev = _dev; if (dev == null) break;
            bool grab = _grabTcs != null, live = _hub.LiveDue(), hw = _trigger == "hardware";
            bool need = grab || live || hw, keep = false;
            Frame f;
            try
            {
                lock (_dev_lock)
                {
                    if (!_run || _dev != dev) break;
                    if (_trigger == "software" && (grab || live) && !_swIssued) { dev.Execute("TriggerSoftware"); _swIssued = true; }
                    int timeout = (int)Math.Clamp(_expUs / 1000 * 2 + 150, 150, 3000);
                    if (_trigger != "free") timeout = 150;
                    keep = hw || (grab && _lastIndex + 1 >= _grabAfter); // only frames that may be stored get their own buffer
                    f = dev.Retrieve(timeout, need, keep);
                }
            }
            catch (Exception e)
            {
                _errors++; _lastError = e.Message;
                bool lost = false; try { lost = !dev.IsConnected; } catch { lost = true; }
                if (lost)
                {
                    _log.Error($"camera connection lost: {e.Message}");
                    _hub.Broadcast(new { type = "error", message = "Camera connection lost. Reconnecting…" });
                    ThreadPool.QueueUserWorkItem(_ => Close(false));
                    break;
                }
                if (_errors % 50 == 1) _log.Warn("grab: " + e.Message);
                Thread.Sleep(100);
                continue;
            }
            if (!need) Thread.Sleep(1); // frames are only counted
            if (f == null) { if (!need && !hw) Thread.Sleep(20); continue; }
            _lastIndex = f.Index; _frames++; _fpsN++;
            var now = DateTime.Now; var dt = (now - _fpsT).TotalSeconds;
            if (dt >= 1) { _fps = _fpsN / dt; _fpsN = 0; _fpsT = now; }
            if (f.Failed) { _errors++; _lastError = f.Error; continue; }
            _w = f.W; _h = f.H; _pixFmt = f.PixelFormat;
            if (_trigger == "software") _swIssued = false;
            if (f.Rgb == null) continue;

            var tcs = _grabTcs;
            if (tcs != null && f.Index >= _grabAfter)
            {
                _grabTcs = null;
                // a live-view buffer is reused by the next frame: give the grab its own copy
                tcs.TrySetResult(keep ? f : new Frame { W = f.W, H = f.H, Rgb = (byte[])f.Rgb.Clone(), Index = f.Index, Time = f.Time, PixelFormat = f.PixelFormat });
            }
            else if (hw)
            {
                try
                {
                    var s = _storage.AddShot(f, _info, true);
                    _hub.Broadcast(new { type = "shot", shot = s.ToJson() });
                }
                catch (Exception e) { _log.Error("triggered shot: " + e.Message); }
            }
            if (live || _hub.LiveDue())
            {
                _hub.SendLive(f);
                try
                {
                    var (sm, sw, sh) = ImageCodec.Downsample(f.Rgb, f.W, f.H, 320);
                    var (hist, sat, mean) = ImageCodec.Histogram(sm, sw, sh);
                    var focus = ImageCodec.Focus(f.Rgb, f.W, f.H);
                    _hub.Broadcast(new { type = "stats", fps = Math.Round(_fps, 1), frames = _frames, errors = _errors, w = f.W, h = f.H, pixelFormat = f.PixelFormat, hist, sat = Math.Round(sat, 2), mean = Math.Round(mean, 1), focus = Math.Round(focus, 1), index = f.Index });
                }
                catch { }
            }
        }
    }

    // ---------------- grab ----------------
    public async Task<Shot> Grab(int timeoutMs = 0)
    {
        if (_dev == null) throw new BridgeException("No camera connected.");
        if (_trigger == "hardware") throw new BridgeException("The camera waits for its hardware trigger (TriggerMode = On, source = Line). Images come from the trigger; set TriggerMode Off to grab by button.");
        await _grabSem.WaitAsync();
        try
        {
            if (_dev is SimDevice sd) sd.NextImage();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var tcs = new TaskCompletionSource<Frame>(TaskCreationOptions.RunContinuationsAsynchronously);
            _grabAfter = _lastIndex + (_trigger == "software" ? 1 : 2); // skip a frame whose exposure may have started before the click
            _grabTcs = tcs;
            int to = timeoutMs > 0 ? timeoutMs : (int)Math.Max(5000, _expUs * 3 / 1000 + 2500);
            var done = await Task.WhenAny(tcs.Task, Task.Delay(to));
            if (done != tcs.Task) { _grabTcs = null; throw new BridgeException("No image from the camera (timeout). Check the cable, the trigger mode and the exposure time."); }
            var f = await tcs.Task;
            var shot = _storage.AddShot(f, _info, false);
            shot.WaitMs = sw.Elapsed.TotalMilliseconds;
            return shot;
        }
        finally { _grabSem.Release(); }
    }

    // ---------------- settings ----------------
    private void RefreshState()
    {
        var dev = _dev; if (dev == null) return;
        try
        {
            var tm = dev.ReadFeature(Features.Get("TriggerMode"))?.Value?.ToString();
            var ts = dev.ReadFeature(Features.Get("TriggerSource"))?.Value?.ToString();
            _trigger = tm == "On" ? (ts == "Software" ? "software" : "hardware") : "free";
        }
        catch { _trigger = "free"; }
        try { var e = dev.ReadFeature(Features.Get("ExposureTime"))?.Value; if (e != null) _expUs = Convert.ToDouble(e); } catch { }
    }

    public List<FeatureInfo> GetFeatures()
    {
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        var list = new List<FeatureInfo>();
        lock (_dev_lock)
        {
            // read with acquisition paused: settings that are locked while grabbing (Width, PixelFormat, ...)
            // then report their real limits and options; writing them pauses acquisition automatically.
            bool acq = dev.Acquiring;
            if (acq) try { dev.StopAcquisition(); } catch { }
            try
            {
                foreach (var d in Features.All)
                {
                    try { var f = dev.ReadFeature(d); if (f != null) list.Add(f); }
                    catch (Exception e) { _log.Warn($"read {d.Name}: {e.Message}"); }
                }
            }
            finally { if (acq) try { dev.StartAcquisition(); } catch (Exception e) { _log.Error("restart acquisition: " + e.Message); } }
        }
        return list;
    }

    private static object Plain(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Number => v.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => v.GetString(),
        _ => null,
    };

    /// <summary>Writes settings in a safe order; settings that are locked while grabbing are written with acquisition stopped.</summary>
    public object SetFeatures(Dictionary<string, JsonElement> values)
    {
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        var order = Features.ProfileOrder.ToList();
        var errors = new Dictionary<string, string>();
        lock (_dev_lock)
        {
            foreach (var kv in values.OrderBy(k => { var i = order.IndexOf(k.Key); return i < 0 ? 999 : i; }))
            {
                FeatureDef def;
                try { def = Features.Get(kv.Key); } catch (Exception e) { errors[kv.Key] = e.Message; continue; }
                var v = Plain(kv.Value);
                try { dev.WriteFeature(def, v); }
                catch (Exception e1) when (dev.Acquiring)
                {
                    try { dev.StopAcquisition(); dev.WriteFeature(def, v); }
                    catch (Exception e2) { errors[kv.Key] = e2.Message; }
                    finally { try { dev.StartAcquisition(); } catch (Exception e3) { _log.Error("restart acquisition: " + e3.Message); } }
                    if (!errors.ContainsKey(kv.Key)) _log.Info($"{kv.Key} written with acquisition stopped ({e1.Message})");
                }
                catch (Exception e) { errors[kv.Key] = e.Message; }
            }
            RefreshState();
        }
        _hub.Broadcast(new { type = "state", status = Status() });
        return new { errors, features = GetFeatures() };
    }

    public async Task<object> AutoOnce(string what)
    {
        var node = what switch { "exposure" => "ExposureAuto", "gain" => "GainAuto", "balance" => "BalanceWhiteAuto", _ => throw new BridgeException("what = exposure, gain or balance") };
        if (_trigger != "free") throw new BridgeException("Auto functions need free-running images: set TriggerMode Off first.");
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        lock (_dev_lock) dev.WriteFeature(Features.Get(node), "Once");
        var until = DateTime.Now.AddSeconds(8); string v = "Once";
        while (DateTime.Now < until)
        {
            await Task.Delay(150);
            lock (_dev_lock) v = dev.ReadFeature(Features.Get(node))?.Value?.ToString();
            if (v != "Once") break;
        }
        if (v == "Once") { lock (_dev_lock) try { dev.WriteFeature(Features.Get(node), "Off"); } catch { } }
        lock (_dev_lock) RefreshState();
        return new { done = v != "Once", features = GetFeatures() };
    }

    private static readonly HashSet<string> Commands = new(StringComparer.OrdinalIgnoreCase) { "UserSetLoad", "UserSetSave", "TriggerSoftware" };

    public object Command(string name)
    {
        if (!Commands.Contains(name)) throw new BridgeException($"command {name} not allowed");
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        lock (_dev_lock)
        {
            bool restart = dev.Acquiring && name.StartsWith("UserSet", StringComparison.OrdinalIgnoreCase);
            if (restart) dev.StopAcquisition();
            try { dev.Execute(name); }
            finally { if (restart) dev.StartAcquisition(); }
            RefreshState();
        }
        return new { ok = true, features = GetFeatures() };
    }

    /// <summary>User sets: save / load the current settings in the camera, or choose the start-up set.</summary>
    public object UserSet(string action, string set)
    {
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        set = string.IsNullOrWhiteSpace(set) ? "UserSet1" : set;
        lock (_dev_lock)
        {
            if (action == "startup") { dev.WriteFeature(Features.Get("UserSetDefault"), set); }
            else
            {
                if (action == "save" && set == "Default") throw new BridgeException("The Default set cannot be overwritten; choose UserSet1..3.");
                dev.WriteFeature(Features.Get("UserSetSelector"), set);
                bool acq = dev.Acquiring; if (acq) dev.StopAcquisition();
                try { dev.Execute(action == "save" ? "UserSetSave" : "UserSetLoad"); }
                finally { if (acq) dev.StartAcquisition(); }
            }
            RefreshState();
        }
        return new { ok = true, features = GetFeatures() };
    }

    /// <summary>Extension of the camera's settings file: .mfs (Hikrobot MVS) or .pfs (Basler pylon, simulator).</summary>
    public string ConfigExt => _info?.Driver == "hikrobot" ? ".mfs" : ".pfs";

    public byte[] SaveConfig()
    {
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        var tmp = Path.Combine(Path.GetTempPath(), $"pm_{Guid.NewGuid():N}{ConfigExt}");
        try { lock (_dev_lock) dev.SaveConfig(tmp); return File.ReadAllBytes(tmp); }
        finally { try { File.Delete(tmp); } catch { } }
    }

    public object LoadConfig(byte[] data)
    {
        var dev = _dev ?? throw new BridgeException("No camera connected.");
        var tmp = Path.Combine(Path.GetTempPath(), $"pm_{Guid.NewGuid():N}{ConfigExt}");
        File.WriteAllBytes(tmp, data);
        try
        {
            lock (_dev_lock)
            {
                bool acq = dev.Acquiring; if (acq) dev.StopAcquisition();
                try { dev.LoadConfig(tmp); } finally { if (acq) dev.StartAcquisition(); }
                RefreshState();
            }
        }
        finally { try { File.Delete(tmp); } catch { } }
        return new { ok = true, features = GetFeatures() };
    }

    // ---------------- recording ----------------
    public sealed class RecordRequest
    {
        public string ShotId { get; set; }
        public int Count { get; set; } = 1;
        public int IntervalMs { get; set; } = 1000;
        public string Format { get; set; }
        public string Pattern { get; set; }
        public Dictionary<string, string> Vars { get; set; } = new();
    }

    public async Task<object> Record(RecordRequest r)
    {
        var fmt = string.IsNullOrWhiteSpace(r.Format) ? _cfg.Record.Format : r.Format;
        var pat = string.IsNullOrWhiteSpace(r.Pattern) ? _cfg.Record.Pattern : r.Pattern;
        var vars = new Dictionary<string, string>(r.Vars ?? new(), StringComparer.OrdinalIgnoreCase);
        if (!vars.ContainsKey("camera")) vars["camera"] = _info?.Name is { Length: > 0 } n ? n : _info?.Model ?? "";
        if (!string.IsNullOrEmpty(r.ShotId))
        {
            var s = _storage.GetShot(r.ShotId) ?? throw new BridgeException("shot not found", 404);
            var p = await _storage.SaveShot(s, fmt, pat, vars, 1);
            _log.Info($"recorded {p}");
            return new { files = new[] { p } };
        }
        if (r.Count <= 1)
        {
            var s = await Grab();
            var p = await _storage.SaveShot(s, fmt, pat, vars, 1);
            _log.Info($"recorded {p}");
            return new { files = new[] { p }, shot = s.ToJson() };
        }
        if (_recCts != null) throw new BridgeException("A sequence is already running.");
        var cts = new CancellationTokenSource(); _recCts = cts;
        int count = Math.Clamp(r.Count, 2, 10000), interval = Math.Clamp(r.IntervalMs, 0, 3_600_000);
        _ = Task.Run(async () =>
        {
            var files = new List<string>();
            try
            {
                for (int i = 1; i <= count && !cts.IsCancellationRequested; i++)
                {
                    var t0 = DateTime.Now;
                    var s = await Grab();
                    var p = await _storage.SaveShot(s, fmt, pat, vars, i);
                    files.Add(p);
                    _recState = new { running = true, n = i, total = count, file = p };
                    _hub.Broadcast(new { type = "record", running = i < count, n = i, total = count, file = Path.GetFileName(p), shot = s.ToJson() });
                    var wait = interval - (int)(DateTime.Now - t0).TotalMilliseconds;
                    if (i < count && wait > 0) await Task.Delay(wait, cts.Token);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception e) { _log.Error("sequence: " + e.Message); _hub.Broadcast(new { type = "error", message = "Recording stopped: " + e.Message }); }
            finally
            {
                _recCts = null; _recState = null;
                _log.Info($"sequence finished: {files.Count} images");
                _hub.Broadcast(new { type = "record", running = false, n = files.Count, total = count, done = true });
            }
        });
        return new { started = true, count, intervalMs = interval };
    }

    public void StopRecord() => _recCts?.Cancel();

    // ---------------- status ----------------
    public object Status() => new
    {
        connected = _dev != null,
        camera = _info == null ? null : new
        {
            _info.Id, _info.Driver, _info.Model, _info.Serial, _info.Vendor, _info.Interface, _info.Name, ip = _info.Props?.GetValueOrDefault("IpAddress"),
            open = _dev != null, acquiring = _dev?.Acquiring ?? false,
        },
        reconnecting = _dev == null && _wanted != null,
        trigger = _trigger, fps = Math.Round(_fps, 1), frames = _frames, errors = _errors, lastError = _lastError,
        w = _w, h = _h, pixelFormat = _pixFmt, exposureUs = _expUs,
        recording = _recState,
    };
}
