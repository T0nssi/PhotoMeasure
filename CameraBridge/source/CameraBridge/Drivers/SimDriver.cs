namespace CameraBridge;

/// <summary>Simulated camera for training and tests: plays the BMP/PPM images in the sim folder
/// (Grab = next image), or a test pattern. Exposure/gain change the brightness; ReverseX/Y mirror.</summary>
public sealed class SimDriver : ICameraDriver
{
    private readonly string _folder;
    public string Name => "sim";
    public bool Available => true;
    public string Error => "";
    public SimDriver(string folder) { _folder = folder; }

    public List<CameraInfo> Enumerate() => new()
    {
        new CameraInfo { Id = "sim:SIM0001", Driver = Name, Model = "Simulator (images from sim folder)", Serial = "SIM0001", Vendor = "PhotoMeasure", Interface = "Simulator" },
    };

    public ICameraDevice Open(CameraInfo info) => new SimDevice(info, _folder);
    public object Diag() => new { driver = Name, folder = _folder, files = Directory.Exists(_folder) ? Directory.GetFiles(_folder).Length : 0 };
}

internal sealed class SimDevice : ICameraDevice
{
    private readonly List<(byte[] rgb, int w, int h, string name)> _images = new();
    private int _cur;
    private long _index;
    private DateTime _next = DateTime.MinValue;
    private readonly Random _rnd = new(1);
    private readonly Dictionary<string, object> _v = new()
    {
        ["DeviceModelName"] = "Simulator", ["DeviceSerialNumber"] = "SIM0001", ["DeviceFirmwareVersion"] = "1.0", ["DeviceTemperature"] = 41.5,
        ["BslUSBSpeedMode"] = "SuperSpeed", ["ExposureAuto"] = "Off", ["ExposureTime"] = 10000.0, ["GainAuto"] = "Off", ["Gain"] = 0.0,
        ["BlackLevel"] = 0.0, ["Gamma"] = 1.0, ["PixelFormat"] = "BayerRG8", ["BalanceWhiteAuto"] = "Off",
        ["BalanceRatio:Red"] = 1.0, ["BalanceRatio:Green"] = 1.0, ["BalanceRatio:Blue"] = 1.0, ["LightSourcePreset"] = "Off",
        ["ReverseX"] = false, ["ReverseY"] = false, ["ShutterMode"] = "Rolling",
        ["AcquisitionFrameRateEnable"] = false, ["AcquisitionFrameRate"] = 10.0, ["ResultingFrameRate"] = 10.0,
        ["TriggerMode"] = "Off", ["TriggerSource"] = "Line1", ["TriggerActivation"] = "RisingEdge", ["TriggerDelay"] = 0.0,
        ["LineSource:Line2"] = "ExposureActive", ["LineInverter:Line2"] = false, ["UserSetSelector"] = "UserSet1", ["UserSetDefault"] = "Default",
    };
    private static readonly Dictionary<string, (string type, double min, double max, string[] opts, bool ro)> Meta = new()
    {
        ["DeviceModelName"] = ("string", 0, 0, null, true), ["DeviceSerialNumber"] = ("string", 0, 0, null, true), ["DeviceFirmwareVersion"] = ("string", 0, 0, null, true),
        ["DeviceTemperature"] = ("float", -40, 100, null, true), ["BslUSBSpeedMode"] = ("enum", 0, 0, new[] { "SuperSpeed", "HighSpeed" }, true),
        ["ExposureAuto"] = ("enum", 0, 0, new[] { "Off", "Once", "Continuous" }, false), ["ExposureTime"] = ("float", 35, 1000000, null, false),
        ["GainAuto"] = ("enum", 0, 0, new[] { "Off", "Once", "Continuous" }, false), ["Gain"] = ("float", 0, 18, null, false),
        ["BlackLevel"] = ("float", 0, 31, null, false), ["Gamma"] = ("float", 0, 3.99998, null, false),
        ["PixelFormat"] = ("enum", 0, 0, new[] { "Mono8", "BayerRG8", "BayerRG12", "RGB8", "BGR8", "YCbCr422_8" }, false),
        ["BalanceWhiteAuto"] = ("enum", 0, 0, new[] { "Off", "Once", "Continuous" }, false),
        ["BalanceRatio:Red"] = ("float", 1, 15.98, null, false), ["BalanceRatio:Green"] = ("float", 1, 15.98, null, false), ["BalanceRatio:Blue"] = ("float", 1, 15.98, null, false),
        ["LightSourcePreset"] = ("enum", 0, 0, new[] { "Off", "Daylight5000K", "Daylight6500K", "Tungsten2800K" }, false),
        ["Width"] = ("int", 16, 0, null, false), ["Height"] = ("int", 16, 0, null, false), ["OffsetX"] = ("int", 0, 0, null, false), ["OffsetY"] = ("int", 0, 0, null, false),
        ["ReverseX"] = ("bool", 0, 0, null, false), ["ReverseY"] = ("bool", 0, 0, null, false),
        ["ShutterMode"] = ("enum", 0, 0, new[] { "Rolling", "GlobalResetRelease" }, false),
        ["AcquisitionFrameRateEnable"] = ("bool", 0, 0, null, false), ["AcquisitionFrameRate"] = ("float", 1, 10, null, false), ["ResultingFrameRate"] = ("float", 0, 100, null, true),
        ["TriggerMode"] = ("enum", 0, 0, new[] { "Off", "On" }, false), ["TriggerSource"] = ("enum", 0, 0, new[] { "Software", "Line1", "Line3", "Line4" }, false),
        ["TriggerActivation"] = ("enum", 0, 0, new[] { "RisingEdge", "FallingEdge" }, false), ["TriggerDelay"] = ("float", 0, 1000000, null, false),
        ["LineSource:Line2"] = ("enum", 0, 0, new[] { "ExposureActive", "FrameTriggerWait", "Timer1Active", "UserOutput1" }, false),
        ["LineInverter:Line2"] = ("bool", 0, 0, null, false),
        ["UserSetSelector"] = ("enum", 0, 0, new[] { "Default", "UserSet1", "UserSet2", "UserSet3" }, false),
        ["UserSetDefault"] = ("enum", 0, 0, new[] { "Default", "UserSet1", "UserSet2", "UserSet3" }, false),
    };
    private int _fullW, _fullH;
    private bool _swTriggered;

    public CameraInfo Info { get; }
    public bool IsConnected => true;
    public bool Acquiring { get; private set; }

    public SimDevice(CameraInfo info, string folder)
    {
        Info = info;
        if (Directory.Exists(folder))
            foreach (var f in Directory.GetFiles(folder).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
            {
                try { var img = ImageCodec.ReadSimple(File.ReadAllBytes(f)); if (img != null) _images.Add((img.Value.rgb, img.Value.w, img.Value.h, Path.GetFileName(f))); } catch { }
            }
        if (_images.Count == 0) _images.Add((Pattern(1600, 1200, out var w, out var h), w, h, "pattern"));
        _fullW = _images.Max(i => i.w); _fullH = _images.Max(i => i.h);
        _v["Width"] = (long)_images[0].w; _v["Height"] = (long)_images[0].h; _v["OffsetX"] = 0L; _v["OffsetY"] = 0L;
    }

    private static byte[] Pattern(int w, int h, out int ow, out int oh)
    {
        ow = w; oh = h; var b = new byte[w * h * 3];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
            {
                int d = (y * w + x) * 3; bool grid = x % 100 < 2 || y % 100 < 2;
                double r1 = Math.Sqrt((x - 500) * (x - 500) + (y - 600) * (y - 600)), r2 = Math.Sqrt((x - 1100) * (x - 1100) + (y - 600) * (y - 600));
                byte v = (byte)(r1 < 80 || r2 < 60 ? 20 : grid ? 90 : 200);
                b[d] = v; b[d + 1] = (byte)(v * 0.95); b[d + 2] = (byte)(v * 0.9);
            }
        return b;
    }

    public FeatureInfo ReadFeature(FeatureDef def)
    {
        if (!Meta.TryGetValue(def.Name, out var m)) return null;
        var f = new FeatureInfo { Name = def.Name, Group = def.Group, Label = def.Label, Type = m.type, Node = def.Alts[0], Readable = true, Writable = !m.ro, Value = _v.GetValueOrDefault(def.Name) };
        if (m.type is "float" or "int") { f.Min = m.min; f.Max = m.max > 0 ? m.max : (def.Name is "Width" or "OffsetX" ? _fullW : _fullH); f.Inc = m.type == "int" ? 4 : null; }
        if (def.Name == "OffsetX") f.Max = _fullW - Convert.ToInt64(_v["Width"]);
        if (def.Name == "OffsetY") f.Max = _fullH - Convert.ToInt64(_v["Height"]);
        if (m.type == "enum") f.Options = m.opts;
        if (Acquiring && def.Name is "Width" or "Height" or "PixelFormat") f.Writable = false;
        return f;
    }

    public void WriteFeature(FeatureDef def, object value)
    {
        var f = ReadFeature(def) ?? throw new BridgeException($"{def.Name} is not available on this camera");
        if (!f.Writable) throw new BridgeException($"{def.Name} cannot be changed now", 409);
        object v = f.Type switch
        {
            "float" => Math.Clamp(Convert.ToDouble(value), f.Min ?? double.MinValue, f.Max ?? double.MaxValue),
            "int" => (long)Math.Clamp(Math.Round(Convert.ToDouble(value) / 4) * 4, f.Min ?? 0, f.Max ?? long.MaxValue),
            "bool" => value is bool b ? b : Convert.ToBoolean(value),
            _ => value?.ToString(),
        };
        if (f.Type == "enum" && !f.Options.Contains((string)v)) throw new BridgeException($"{def.Name}: {v} is not allowed");
        _v[def.Name] = v;
        if (def.Name.EndsWith("Auto") && (string)v == "Once") _onceAt = DateTime.Now; // finishes after a few frames
    }
    private DateTime _onceAt = DateTime.MinValue;

    public void Execute(string node)
    {
        if (node == "TriggerSoftware") { _swTriggered = true; return; }
        if (node is "UserSetLoad" or "UserSetSave") return;
        throw new BridgeException($"{node} is not available on this camera");
    }

    public void StartAcquisition() { Acquiring = true; }
    public void StopAcquisition() { Acquiring = false; }

    /// <summary>Next image for a grab (called by the service): the simulator moves to the next file.</summary>
    public void NextImage() { _cur = (_cur + 1) % _images.Count; }

    public Frame Retrieve(int timeoutMs, bool convert, bool keep = true)
    {
        if (!Acquiring) { Thread.Sleep(Math.Min(50, timeoutMs)); return null; }
        bool trig = (string)_v["TriggerMode"] == "On";
        if (trig)
        {
            if ((string)_v["TriggerSource"] != "Software" || !_swTriggered) { Thread.Sleep(Math.Min(timeoutMs, 100)); return null; }
            _swTriggered = false;
        }
        var wait = _next - DateTime.Now;
        if (wait > TimeSpan.Zero) { if (wait.TotalMilliseconds > timeoutMs) { Thread.Sleep(timeoutMs); return null; } Thread.Sleep(wait); }
        double fps = (bool)_v["AcquisitionFrameRateEnable"] ? Math.Min(10, (double)_v["AcquisitionFrameRate"]) : 10;
        _next = DateTime.Now.AddMilliseconds(1000 / fps);
        // finish "Once" auto functions after ~3 frames
        if (_onceAt != DateTime.MinValue && DateTime.Now - _onceAt > TimeSpan.FromMilliseconds(300))
        {
            if ((string)_v["ExposureAuto"] == "Once") { _v["ExposureAuto"] = "Off"; _v["ExposureTime"] = AutoExposure(); }
            if ((string)_v["GainAuto"] == "Once") { _v["GainAuto"] = "Off"; _v["Gain"] = 0.0; }
            if ((string)_v["BalanceWhiteAuto"] == "Once") { _v["BalanceWhiteAuto"] = "Off"; _v["BalanceRatio:Red"] = 1.0; _v["BalanceRatio:Green"] = 1.0; _v["BalanceRatio:Blue"] = 1.0; }
            _onceAt = DateTime.MinValue;
        }
        var img = _images[_cur];
        var f = new Frame { W = img.w, H = img.h, Index = ++_index, Time = DateTime.Now, PixelFormat = (string)_v["PixelFormat"] };
        if (convert) { var sw = System.Diagnostics.Stopwatch.StartNew(); f.Rgb = Render(img.rgb, img.w, img.h); f.ConvertMs = sw.Elapsed.TotalMilliseconds; }
        return f;
    }

    private double AutoExposure()
    {
        var img = _images[_cur]; long s = 0; int n = 0;
        for (int i = 0; i < img.rgb.Length; i += 301) { s += img.rgb[i]; n++; }
        double mean = n > 0 ? (double)s / n : 128;
        return Math.Clamp(10000 * 120 / Math.Max(1, mean), 100, 100000);
    }

    private byte[] Render(byte[] src, int w, int h)
    {
        double k = (double)_v["ExposureTime"] / 10000.0 * Math.Pow(10, (double)_v["Gain"] / 20.0);
        double kr = k * (double)_v["BalanceRatio:Red"], kg = k * (double)_v["BalanceRatio:Green"], kb = k * (double)_v["BalanceRatio:Blue"];
        bool mono = ((string)_v["PixelFormat"]).StartsWith("Mono"), rx = (bool)_v["ReverseX"], ry = (bool)_v["ReverseY"];
        double bl = (double)_v["BlackLevel"];
        var o = new byte[w * h * 3]; int seed = (int)_index;
        Parallel.For(0, h, y =>
        {
            var rnd = new Random(seed * 7919 + y);
            int sy = ry ? h - 1 - y : y;
            for (int x = 0; x < w; x++)
            {
                int sx = rx ? w - 1 - x : x, s = (sy * w + sx) * 3, d = (y * w + x) * 3;
                double n = rnd.Next(-2, 3);
                double r = src[s] * kr + bl + n, g = src[s + 1] * kg + bl + n, b = src[s + 2] * kb + bl + n;
                if (mono) r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
                o[d] = (byte)Math.Clamp(r, 0, 255); o[d + 1] = (byte)Math.Clamp(g, 0, 255); o[d + 2] = (byte)Math.Clamp(b, 0, 255);
            }
        });
        return o;
    }

    public void SaveConfig(string path)
    {
        var lines = _v.Where(kv => Meta.TryGetValue(kv.Key, out var m) && !m.ro).Select(kv => $"{kv.Key}\t{kv.Value}");
        File.WriteAllLines(path, new[] { "# {05D8C294-F295-4dfb-9D01-096BD04049F4}", "# GenApi persistence file (simulator)" }.Concat(lines));
    }

    public void LoadConfig(string path)
    {
        foreach (var line in File.ReadAllLines(path))
        {
            if (line.StartsWith("#")) continue;
            var p = line.Split('\t'); if (p.Length != 2 || !Meta.TryGetValue(p[0], out var m) || m.ro) continue;
            _v[p[0]] = m.type switch { "float" => double.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture), "int" => long.Parse(p[1]), "bool" => bool.Parse(p[1]), _ => p[1] };
        }
    }

    public void Dispose() { Acquiring = false; }
}
