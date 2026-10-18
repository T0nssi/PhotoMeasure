using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace CameraBridge;

/// <summary>One grabbed image. Kept in memory for a short time (served as BMP) and saved as PNG in data/shots.</summary>
public sealed class Shot
{
    public string Id = "";
    public DateTime Time;
    public int W, H;
    public byte[] Rgb;          // released after some newer shots
    public string PngPath = "";
    public Task Saved = Task.CompletedTask;
    public string CameraId = "", Model = "", Serial = "", Name = "";
    public bool Triggered;
    public long FrameIndex;
    public double WaitMs = -1, ConvertMs = -1;   // grab: request -> frame; buffer -> RGB
    public object ToJson() => new
    {
        shotId = Id, url = $"/api/shots/{Id}", w = W, h = H, time = Time.ToString("o"), camera = Name != "" ? Name : Model,
        model = Model, serial = Serial, cameraId = CameraId, triggered = Triggered, frame = FrameIndex,
        timing = new { waitMs = WaitMs >= 0 ? Math.Round(WaitMs, 1) : (double?)null, convertMs = ConvertMs >= 0 ? Math.Round(ConvertMs, 1) : (double?)null },
    };
}

/// <summary>Shots (data/shots/yyyy-MM-dd), recordings (record folder/yyyy-MM-dd) and clean-up.</summary>
public sealed class Storage
{
    private readonly BridgeConfig _cfg;
    private readonly Log _log;
    private readonly ConcurrentDictionary<string, Shot> _shots = new();
    private readonly LinkedList<Shot> _mem = new();
    private readonly object _memLock = new();
    private int _seq;
    public const int MemShots = 6;

    public string DataDir => _cfg.Abs(_cfg.DataDir);
    public string ShotDir => Path.Combine(DataDir, "shots");
    public string RecordRoot => string.IsNullOrWhiteSpace(_cfg.Record.Folder) ? Path.Combine(DataDir, "images") : _cfg.Abs(_cfg.Record.Folder);

    public Storage(BridgeConfig cfg, Log log)
    {
        _cfg = cfg; _log = log;
        Directory.CreateDirectory(ShotDir);
        Directory.CreateDirectory(RecordRoot);
    }

    public Shot AddShot(Frame f, CameraInfo cam, bool triggered)
    {
        var now = f.Time == default ? DateTime.Now : f.Time;
        var id = $"{now:yyyyMMdd-HHmmss-fff}-{Interlocked.Increment(ref _seq) % 1000:000}";
        var s = new Shot
        {
            Id = id, Time = now, W = f.W, H = f.H, Rgb = f.Rgb, CameraId = cam?.Id ?? "", Model = cam?.Model ?? "", Serial = cam?.Serial ?? "",
            Name = cam?.Name ?? "", Triggered = triggered, FrameIndex = f.Index, ConvertMs = f.ConvertMs,
        };
        var dir = Path.Combine(ShotDir, now.ToString("yyyy-MM-dd")); Directory.CreateDirectory(dir);
        s.PngPath = Path.Combine(dir, id + ".png");
        var rgb = s.Rgb;
        s.Saved = Task.Run(() =>
        {
            try { using var fs = File.Create(s.PngPath); ImageCodec.WritePng(fs, rgb, s.W, s.H); }
            catch (Exception e) { _log.Error($"save shot {id}: {e.Message}"); }
        });
        _shots[id] = s;
        lock (_memLock)
        {
            _mem.AddLast(s);
            while (_mem.Count > MemShots) { var old = _mem.First.Value; _mem.RemoveFirst(); old.Rgb = null; }
        }
        return s;
    }

    private readonly object _timingLock = new();
    /// <summary>Append one processing-time row (sent by the app) to data/logs/timing-YYYY-MM-DD.csv.</summary>
    public string AppendTiming(string[] cols, string[] vals)
    {
        if (cols == null || vals == null || cols.Length == 0 || cols.Length != vals.Length || cols.Length > 64) throw new BridgeException("bad timing row", 400);
        static string Clean(string v) { v ??= ""; if (v.Length > 200) v = v[..200]; v = v.Replace("\r", " ").Replace("\n", " "); return v.IndexOfAny(new[] { ',', '"' }) >= 0 && !(v.StartsWith('"') && v.EndsWith('"')) ? "\"" + v.Replace("\"", "\"\"") + "\"" : v; }
        var dir = Path.Combine(DataDir, "logs"); Directory.CreateDirectory(dir);
        var p = Path.Combine(dir, $"timing-{DateTime.Now:yyyy-MM-dd}.csv");
        lock (_timingLock)
        {
            bool fresh = !File.Exists(p);
            using var w = new StreamWriter(p, true, new System.Text.UTF8Encoding(fresh));
            if (fresh) w.WriteLine(string.Join(",", cols.Select(Clean)));
            w.WriteLine(string.Join(",", vals.Select(Clean)));
        }
        return p;
    }

    public Shot GetShot(string id)
    {
        if (_shots.TryGetValue(id, out var s)) return s;
        if (!Regex.IsMatch(id, @"^\d{8}-\d{6}-\d{3}-\d{3}$")) return null;
        var p = Path.Combine(ShotDir, $"{id[..4]}-{id.Substring(4, 2)}-{id.Substring(6, 2)}", id + ".png");
        return File.Exists(p) ? new Shot { Id = id, PngPath = p } : null;
    }

    /// <summary>Image bytes for the browser: BMP straight from memory (fast) or the stored PNG.</summary>
    public async Task<(byte[] data, string type)> ShotBytes(string id)
    {
        var s = GetShot(id) ?? throw new BridgeException("shot not found", 404);
        var rgb = s.Rgb;
        if (rgb != null) return (ImageCodec.Bmp(rgb, s.W, s.H), "image/bmp");
        await s.Saved;
        if (!File.Exists(s.PngPath)) throw new BridgeException("shot file missing", 404);
        return (await File.ReadAllBytesAsync(s.PngPath), "image/png");
    }

    // ---------------- recordings ----------------
    private static string Clean(string s) => Regex.Replace(s ?? "", @"[\\/:*?""<>|\s]+", "_").Trim('_', '.');

    public string FileName(string pattern, Dictionary<string, string> vars, DateTime t, int n)
    {
        if (string.IsNullOrWhiteSpace(pattern)) pattern = "{date}_{time}_{n}";
        var name = Regex.Replace(pattern, @"\{(\w+)\}", m =>
        {
            var k = m.Groups[1].Value.ToLowerInvariant();
            return k switch
            {
                "date" => t.ToString("yyyyMMdd"),
                "time" => t.ToString("HHmmss"),
                "ms" => t.ToString("fff"),
                "n" => n.ToString("000"),
                _ => vars != null && vars.TryGetValue(k, out var v) && !string.IsNullOrWhiteSpace(v) ? Clean(v) : "",
            };
        });
        name = Regex.Replace(Clean(name), "_{2,}", "_");
        return string.IsNullOrEmpty(name) ? t.ToString("yyyyMMdd_HHmmss_fff") : name;
    }

    private string Unique(string dir, string name, string ext)
    {
        var p = Path.Combine(dir, name + ext);
        for (int i = 1; File.Exists(p); i++) p = Path.Combine(dir, $"{name}_{i}{ext}");
        return p;
    }

    public string DayDir(DateTime t) { var d = Path.Combine(RecordRoot, t.ToString("yyyy-MM-dd")); Directory.CreateDirectory(d); return d; }

    /// <summary>Saves an RGB image as PNG or BMP into today's record folder. Returns the full path.</summary>
    public string SaveImage(byte[] rgb, int w, int h, string format, string pattern, Dictionary<string, string> vars, DateTime t, int n)
    {
        var dir = DayDir(t); var ext = (format ?? "png").ToLowerInvariant() == "bmp" ? ".bmp" : ".png";
        var path = Unique(dir, FileName(pattern, vars, t, n), ext);
        using (var fs = File.Create(path))
        {
            if (ext == ".bmp") fs.Write(ImageCodec.Bmp(rgb, w, h)); else ImageCodec.WritePng(fs, rgb, w, h);
        }
        return path;
    }

    /// <summary>Copies a stored shot (PNG) into the record folder, re-encoding only for BMP.</summary>
    public async Task<string> SaveShot(Shot s, string format, string pattern, Dictionary<string, string> vars, int n)
    {
        var t = s.Time == default ? DateTime.Now : s.Time;
        var bmp = (format ?? "png").ToLowerInvariant() == "bmp";
        if (s.Rgb != null) { var rgb = s.Rgb; return await Task.Run(() => SaveImage(rgb, s.W, s.H, format, pattern, vars, t, n)); }
        await s.Saved;
        if (!File.Exists(s.PngPath)) throw new BridgeException("shot file missing", 404);
        if (bmp) throw new BridgeException("this shot is no longer in memory; save it as PNG");
        var dest = Unique(DayDir(t), FileName(pattern, vars, t, n), ".png");
        File.Copy(s.PngPath, dest);
        return dest;
    }

    public string SaveUpload(byte[] data, string name, DateTime t)
    {
        var ext = Path.GetExtension(name ?? "").ToLowerInvariant();
        if (ext is not (".jpg" or ".jpeg" or ".png")) ext = ".jpg";
        var path = Unique(DayDir(t), Clean(Path.GetFileNameWithoutExtension(name ?? "")) is { Length: > 0 } b ? b : t.ToString("yyyyMMdd_HHmmss"), ext);
        File.WriteAllBytes(path, data);
        return path;
    }

    public object List(string day)
    {
        var dir = Path.Combine(RecordRoot, string.IsNullOrWhiteSpace(day) ? DateTime.Now.ToString("yyyy-MM-dd") : day);
        var days = Directory.Exists(RecordRoot) ? Directory.GetDirectories(RecordRoot).Select(Path.GetFileName).Where(n => Regex.IsMatch(n, @"^\d{4}-\d{2}-\d{2}$")).OrderByDescending(x => x).Take(60).ToArray() : Array.Empty<string>();
        var files = Directory.Exists(dir)
            ? new DirectoryInfo(dir).GetFiles().Where(f => f.Extension.ToLowerInvariant() is ".png" or ".bmp" or ".jpg" or ".jpeg")
                .OrderByDescending(f => f.LastWriteTime).Take(500)
                .Select(f => new { name = f.Name, size = f.Length, time = f.LastWriteTime.ToString("o"), url = $"/api/files/{Path.GetFileName(dir)}/{Uri.EscapeDataString(f.Name)}" }).ToArray()
            : Array.Empty<object>();
        return new { root = RecordRoot, day = Path.GetFileName(dir), days, files };
    }

    public string RecordFile(string day, string name)
    {
        if (!Regex.IsMatch(day ?? "", @"^\d{4}-\d{2}-\d{2}$") || string.IsNullOrEmpty(name) || name.Contains("..") || name.IndexOfAny(new[] { '/', '\\' }) >= 0) throw new BridgeException("bad file name", 404);
        var p = Path.Combine(RecordRoot, day, name);
        return File.Exists(p) ? p : throw new BridgeException("file not found", 404);
    }

    public object Disk()
    {
        try { var d = new DriveInfo(Path.GetPathRoot(RecordRoot) ?? "/"); return new { freeGB = Math.Round(d.AvailableFreeSpace / 1e9, 1), totalGB = Math.Round(d.TotalSize / 1e9, 1), low = d.AvailableFreeSpace < 2e9 }; }
        catch { return new { freeGB = -1.0, totalGB = -1.0, low = false }; }
    }

    /// <summary>Deletes old day folders of shots and recordings.</summary>
    public void Cleanup()
    {
        void Clean(string root, int days)
        {
            if (days <= 0 || !Directory.Exists(root)) return;
            var limit = DateTime.Today.AddDays(-days);
            foreach (var d in Directory.GetDirectories(root))
                if (DateTime.TryParseExact(Path.GetFileName(d), "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var day) && day < limit)
                    try { Directory.Delete(d, true); _log.Info($"deleted old folder {d}"); } catch (Exception e) { _log.Warn($"cannot delete {d}: {e.Message}"); }
        }
        Clean(ShotDir, _cfg.KeepShotDays);
        Clean(RecordRoot, _cfg.Record.KeepDays);
    }
}

/// <summary>Processing-time row sent by the app (POST /api/timing).</summary>
public sealed class TimingRow
{
    public string[] cols { get; set; }
    public string[] vals { get; set; }
}
