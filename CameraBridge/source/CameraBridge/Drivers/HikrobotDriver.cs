using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace CameraBridge;

/// <summary>
/// Hikrobot (Hikvision machine vision) GigE / USB3 cameras through the MVS camera runtime (MvCameraControl.dll, C API),
/// loaded at run time from the MVS installation. Nothing from Hikrobot is shipped with or compiled into the bridge;
/// install the Hikrobot MVS software (x64). Setting names are the standard GenICam names, as shown in the MVS client.
/// </summary>
public sealed class HikrobotDriver : ICameraDriver
{
    private readonly BridgeConfig _cfg;
    private readonly Log _log;
    private IntPtr _lib;
    private string _libPath = "", _error = "";
    private readonly List<string> _tried = new();
    private readonly List<string> _missing = new();
    internal readonly Mvs Api = new();
    internal readonly object EnumLock = new();

    public string Name => "hikrobot";
    public bool Available => _lib != IntPtr.Zero;
    public string Error => _error;

    public HikrobotDriver(BridgeConfig cfg, Log log)
    {
        _cfg = cfg; _log = log;
        try { Load(); }
        catch (Exception e) { _error = e.Message; }
        if (Available) _log.Info($"Hikrobot MVS runtime loaded: {_libPath} (SDK {SdkVersion()})");
        else _log.Info($"Hikrobot MVS runtime not available: {_error}");
    }

    // ---------------- finding and loading MvCameraControl.dll ----------------
    private IEnumerable<string> Candidates()
    {
        var file = OperatingSystem.IsWindows() ? "MvCameraControl.dll" : "libMvCameraControl.so";
        if (!string.IsNullOrWhiteSpace(_cfg.MvsLibrary)) yield return _cfg.Abs(_cfg.MvsLibrary);
        var sub = OperatingSystem.IsWindows() ? "Win64_x64" : "";
        var env = Environment.GetEnvironmentVariable("MVCAM_COMMON_RUNENV");
        if (!string.IsNullOrWhiteSpace(env)) yield return Path.Combine(env, sub, file);
        if (OperatingSystem.IsWindows())
        {
            foreach (var pf in new[] { Environment.GetEnvironmentVariable("CommonProgramFiles(x86)"), Environment.GetEnvironmentVariable("CommonProgramW6432"), Environment.GetEnvironmentVariable("CommonProgramFiles") })
                if (!string.IsNullOrWhiteSpace(pf)) yield return Path.Combine(pf, "MVS", "Runtime", sub, file);
        }
        else yield return Path.Combine("/opt/MVS/lib/64", file);
        yield return file; // PATH / default search
    }

    private void Load()
    {
        if (!Environment.Is64BitProcess) throw new Exception("the bridge must run as a 64-bit process");
        foreach (var c in Candidates().Distinct())
        {
            if (Path.IsPathRooted(c) && !File.Exists(c)) { _tried.Add($"MISSING {c}"); continue; }
            if (NativeLibrary.TryLoad(c, out var h)) { _lib = h; _libPath = c; _tried.Add($"OK {c}"); break; }
            _tried.Add($"FAIL {c}");
        }
        if (_lib == IntPtr.Zero)
            throw new Exception("MvCameraControl.dll not found. Install the Hikrobot MVS software (x64), or set \"mvsLibrary\" in bridge.config.json.");
        try { Api.Bind(_lib, _missing); }
        catch { NativeLibrary.Free(_lib); _lib = IntPtr.Zero; throw; }
        if (Api.Initialize != null) Mvs.Check(Api.Initialize(), "MV_CC_Initialize");
    }

    internal string SdkVersion()
    {
        if (Api.GetSDKVersion == null) return "?";
        var v = Api.GetSDKVersion();
        return $"{v >> 24}.{(v >> 16) & 0xFF}.{(v >> 8) & 0xFF}.{v & 0xFF}";
    }

    public object Diag() => new
    {
        driver = Name, available = Available, error = _error, library = _libPath, sdkVersion = Available ? SdkVersion() : "",
        tried = _tried, missingFunctions = _missing,
        env = new[] { "MVCAM_COMMON_RUNENV", "MVCAM_GENICAM_CLPROTOCOL" }.ToDictionary(k => k, k => Environment.GetEnvironmentVariable(k) ?? ""),
        runtime = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription, arch = RuntimeInformation.ProcessArchitecture.ToString(),
    };

    // ---------------- cameras ----------------
    /// <summary>Enumerates GigE and USB3 cameras. Returns the SDK's device-info pointers, valid until the next enumeration.</summary>
    private List<(CameraInfo info, IntPtr ptr)> EnumerateRaw()
    {
        var res = new List<(CameraInfo, IntPtr)>();
        var list = Marshal.AllocHGlobal(Mvs.DeviceListSize);
        try
        {
            Mvs.Zero(list, Mvs.DeviceListSize);
            Mvs.Check(Api.EnumDevices(Mvs.GigE | Mvs.Usb, list), "MV_CC_EnumDevices");
            int n = Math.Min(Marshal.ReadInt32(list), 256);
            for (int i = 0; i < n; i++)
            {
                var p = Marshal.ReadIntPtr(list, IntPtr.Size * (i + 1));
                if (p == IntPtr.Zero) continue;
                var info = Mvs.ReadDeviceInfo(p);
                // Basler cameras are handled by the pylon driver
                if (info.Vendor.Contains("Basler", StringComparison.OrdinalIgnoreCase)) continue;
                info.Driver = Name;
                info.Id = "hik:" + (string.IsNullOrEmpty(info.Serial) ? $"{info.Interface}-{i}" : info.Serial);
                res.Add((info, p));
            }
        }
        finally { Marshal.FreeHGlobal(list); }
        return res;
    }

    public List<CameraInfo> Enumerate()
    {
        if (!Available) return new List<CameraInfo>();
        lock (EnumLock) return EnumerateRaw().Select(x => x.info).ToList();
    }

    public ICameraDevice Open(CameraInfo info)
    {
        IntPtr handle = IntPtr.Zero;
        lock (EnumLock)
        {
            // enumerate again so that the device-info pointer is fresh
            var ptr = EnumerateRaw().FirstOrDefault(x => x.info.Id == info.Id).ptr;
            if (ptr == IntPtr.Zero) throw new BridgeException($"camera {info.Id} not found");
            Mvs.Check(Api.CreateHandle(out handle, ptr), "MV_CC_CreateHandle");
        }
        int r = Api.OpenDevice(handle, 1 /* exclusive */, 0);
        if (r != Mvs.OK)
        {
            Api.DestroyHandle(handle);
            throw new BridgeException($"cannot open camera (is it used by the MVS client or another program?): {Mvs.Err(r)}");
        }
        return new HikrobotDevice(this, handle, info, _log);
    }
}

internal sealed class HikrobotDevice : ICameraDevice
{
    private readonly HikrobotDriver _d;
    private readonly Mvs _api;
    private IntPtr _h;
    private readonly Log _log;
    private readonly IntPtr _buf;            // scratch buffer for SDK structs
    private readonly IntPtr _frameOut;
    private readonly object _lock = new();
    private int _convMode; // 0 untested, 1 SDK converter, 2 own conversion
    private long _index;
    private byte[] _raw, _live;

    public CameraInfo Info { get; }
    public bool Acquiring { get; private set; }

    public HikrobotDevice(HikrobotDriver d, IntPtr handle, CameraInfo info, Log log)
    {
        _d = d; _api = d.Api; _h = handle; Info = info; _log = log;
        _buf = Marshal.AllocHGlobal(Mvs.ScratchSize);
        _frameOut = Marshal.AllocHGlobal(Mvs.ScratchSize);
        // GigE: use the largest packet size the network allows (fewer lost packets, less CPU)
        if (info.Interface.StartsWith("GigE") && _api.GetOptimalPacketSize != null)
        {
            int ps = _api.GetOptimalPacketSize(_h);
            if (ps > 0) { int r = _api.SetIntValueEx != null ? _api.SetIntValueEx(_h, "GevSCPSPacketSize", ps) : _api.SetIntValue(_h, "GevSCPSPacketSize", (uint)ps); if (r != Mvs.OK) _log.Warn("GigE packet size: " + Mvs.Err(r)); }
        }
        _api.SetGrabStrategy?.Invoke(_h, 2 /* LatestImages */);
    }

    public bool IsConnected
    {
        get { try { return _h != IntPtr.Zero && (_api.IsDeviceConnected == null || _api.IsDeviceConnected(_h)); } catch { return false; } }
    }

    // ---------------- parameters ----------------
    /// <summary>GenICam interface type of a node: float, int, enum, bool, command, string, or null if the camera does not have it.</summary>
    private string KindOf(string node)
    {
        if (_api.GetNodeInterfaceType != null)
        {
            if (_api.GetNodeInterfaceType(_h, node, out var t) != Mvs.OK) return null;
            return t switch { 2 => "int", 3 => "bool", 4 => "command", 5 => "float", 6 => "string", 9 => "enum", _ => null };
        }
        // older SDK: probe
        Mvs.Zero(_buf, Mvs.ScratchSize);
        if (_api.GetEnumValue(_h, node, _buf) == Mvs.OK) return "enum";
        if (_api.GetFloatValue(_h, node, _buf) == Mvs.OK) return "float";
        if (GetInt(node, out _, out _, out _, out _)) return "int";
        if (_api.GetBoolValue(_h, node, out _) == Mvs.OK) return "bool";
        if (_api.GetStringValue(_h, node, _buf) == Mvs.OK) return "string";
        return null;
    }

    /// <summary>(readable, writable). Without the access-mode function a node is taken as readable and writable.</summary>
    private (bool r, bool w) Access(string node)
    {
        if (_api.GetNodeAccessMode == null) return (true, true);
        if (_api.GetNodeAccessMode(_h, node, out var m) != Mvs.OK) return (false, false);
        return (m == 3 || m == 4, m == 2 || m == 4); // AM_RO = 3, AM_RW = 4, AM_WO = 2
    }

    private bool GetInt(string node, out long cur, out long min, out long max, out long inc)
    {
        cur = min = max = inc = 0;
        Mvs.Zero(_buf, Mvs.ScratchSize);
        if (_api.GetIntValueEx != null)
        {
            if (_api.GetIntValueEx(_h, node, _buf) != Mvs.OK) return false;
            cur = Marshal.ReadInt64(_buf, 0); max = Marshal.ReadInt64(_buf, 8); min = Marshal.ReadInt64(_buf, 16); inc = Marshal.ReadInt64(_buf, 24);
            return true;
        }
        if (_api.GetIntValue(_h, node, _buf) != Mvs.OK) return false;
        cur = (uint)Marshal.ReadInt32(_buf, 0); max = (uint)Marshal.ReadInt32(_buf, 4); min = (uint)Marshal.ReadInt32(_buf, 8); inc = (uint)Marshal.ReadInt32(_buf, 12);
        return true;
    }

    private bool GetFloat(string node, out double cur, out double min, out double max)
    {
        cur = min = max = 0;
        Mvs.Zero(_buf, Mvs.ScratchSize);
        if (_api.GetFloatValue(_h, node, _buf) != Mvs.OK) return false;
        // float -> double via the shortest decimal text, so 0.1f is reported as 0.1 and not 0.100000001
        double F(int o) => double.Parse(BitConverter.Int32BitsToSingle(Marshal.ReadInt32(_buf, o)).ToString("R", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        cur = F(0); max = F(4); min = F(8);
        return true;
    }

    /// <summary>Symbolic name of an enum value ("Off", "BayerRG8", …).</summary>
    private string Symbol(string node, uint value)
    {
        if (_api.GetEnumEntrySymbolic != null)
        {
            var e = Marshal.AllocHGlobal(512);
            try
            {
                Mvs.Zero(e, 512);
                Marshal.WriteInt32(e, 0, (int)value);
                if (_api.GetEnumEntrySymbolic(_h, node, e) == Mvs.OK)
                {
                    var s = Mvs.Str(e, 4, 64);
                    if (s != "") return s;
                }
            }
            finally { Marshal.FreeHGlobal(e); }
        }
        return Mvs.KnownSymbol(node, value) ?? value.ToString();
    }

    private bool GetEnum(string node, out string cur, out string[] options)
    {
        cur = null; options = null;
        Mvs.Zero(_buf, Mvs.ScratchSize);
        if (_api.GetEnumValue(_h, node, _buf) != Mvs.OK) return false;
        uint v = (uint)Marshal.ReadInt32(_buf, 0);
        int n = Math.Clamp(Marshal.ReadInt32(_buf, 4), 0, 64);
        var vals = new uint[n];
        for (int i = 0; i < n; i++) vals[i] = (uint)Marshal.ReadInt32(_buf, 8 + 4 * i);
        cur = Symbol(node, v);
        options = vals.Select(x => Symbol(node, x)).ToArray();
        return true;
    }

    private void Select(FeatureDef def)
    {
        if (def.Selector == null || KindOf(def.Selector) != "enum") return;
        if (!Access(def.Selector).w) return;
        if (GetEnum(def.Selector, out var cur, out _) && string.Equals(cur, def.SelectorValue, StringComparison.OrdinalIgnoreCase)) return;
        _api.SetEnumValueByString(_h, def.Selector, def.SelectorValue);
    }

    private string Resolve(FeatureDef def, out string kind)
    {
        kind = null;
        foreach (var n in def.Alts)
        {
            var k = KindOf(n);
            if (k == null) continue;
            Select(def);
            var (r, w) = Access(n);
            if (k != "command" && !r && !w) continue;
            kind = k; return n;
        }
        return null;
    }

    public FeatureInfo ReadFeature(FeatureDef def)
    {
        lock (_lock)
        {
            var node = Resolve(def, out var kind);
            if (node == null) return null;
            var (r, w) = Access(node);
            var f = new FeatureInfo { Name = def.Name, Group = def.Group, Label = def.Label, Type = kind, Node = node, Readable = r, Writable = w };
            if (!r) return f;
            switch (kind)
            {
                case "float":
                    if (GetFloat(node, out var fc, out var fmin, out var fmax)) { f.Value = fc; f.Min = fmin; f.Max = fmax; }
                    break;
                case "int":
                    if (GetInt(node, out var ic, out var imin, out var imax, out var iinc)) { f.Value = ic; f.Min = imin; f.Max = imax; f.Inc = iinc > 0 ? iinc : null; }
                    break;
                case "enum":
                    if (GetEnum(node, out var ec, out var opts)) { f.Value = ec; f.Options = opts.Contains(ec) ? opts : opts.Prepend(ec).ToArray(); }
                    break;
                case "bool":
                    if (_api.GetBoolValue(_h, node, out var b) == Mvs.OK) f.Value = b;
                    break;
                case "string":
                    Mvs.Zero(_buf, Mvs.ScratchSize);
                    if (_api.GetStringValue(_h, node, _buf) == Mvs.OK) f.Value = Mvs.Str(_buf, 0, 256);
                    break;
            }
            return f;
        }
    }

    public void WriteFeature(FeatureDef def, object value)
    {
        lock (_lock)
        {
            var node = Resolve(def, out var kind) ?? throw new BridgeException($"{def.Name} is not available on this camera");
            if (!Access(node).w) throw new BridgeException($"{def.Name} cannot be changed now", 409);
            int r;
            switch (kind)
            {
                case "float":
                {
                    double v = Convert.ToDouble(value);
                    if (GetFloat(node, out _, out var min, out var max) && max > min) v = Math.Clamp(v, min, max); // like pylon ClipToRange
                    r = _api.SetFloatValue(_h, node, (float)v);
                    break;
                }
                case "int":
                {
                    double v = Math.Round(Convert.ToDouble(value));
                    if (GetInt(node, out _, out var min, out var max, out var inc) && max >= min)
                    {
                        v = Math.Clamp(v, min, max);
                        if (inc > 1) v = Math.Min(max, min + Math.Round((v - min) / inc) * inc); // nearest valid value
                    }
                    r = _api.SetIntValueEx != null ? _api.SetIntValueEx(_h, node, (long)v) : _api.SetIntValue(_h, node, (uint)v);
                    break;
                }
                case "enum": r = _api.SetEnumValueByString(_h, node, value?.ToString() ?? ""); break;
                case "bool": r = _api.SetBoolValue(_h, node, value is bool b ? b : Convert.ToBoolean(value)); break;
                case "command": r = _api.SetCommandValue(_h, node); break;
                case "string": r = _api.SetStringValue(_h, node, value?.ToString() ?? ""); break;
                default: throw new BridgeException($"{def.Name}: unsupported type");
            }
            if (r != Mvs.OK) throw new BridgeException($"{def.Name}: {Mvs.Err(r)}");
        }
    }

    public void Execute(string node)
    {
        lock (_lock)
        {
            var k = KindOf(node) ?? throw new BridgeException($"{node} is not available on this camera");
            if (k != "command") throw new BridgeException($"{node} is not a command");
            Mvs.Check(_api.SetCommandValue(_h, node), node);
        }
    }

    // ---------------- grabbing ----------------
    public void StartAcquisition()
    {
        if (Acquiring) return;
        Mvs.Check(_api.StartGrabbing(_h), "MV_CC_StartGrabbing");
        Acquiring = true;
    }

    public void StopAcquisition()
    {
        if (!Acquiring) return;
        int r = _api.StopGrabbing(_h);
        if (r != Mvs.OK) _log.Warn("stop grabbing: " + Mvs.Err(r));
        Acquiring = false;
    }

    public Frame Retrieve(int timeoutMs, bool convert, bool keep = true)
    {
        if (!Acquiring) { Thread.Sleep(Math.Min(timeoutMs, 50)); return null; }
        Mvs.Zero(_frameOut, Mvs.ScratchSize);
        int r = _api.GetImageBuffer(_h, _frameOut, (uint)Math.Max(0, timeoutMs));
        if (r == Mvs.NoData) return null;
        if (r != Mvs.OK) throw new BridgeException("grab: " + Mvs.Err(r));
        try
        {
            var pix = Marshal.ReadIntPtr(_frameOut, 0);
            int fi = IntPtr.Size;
            int w = (ushort)Marshal.ReadInt16(_frameOut, fi + 0), h = (ushort)Marshal.ReadInt16(_frameOut, fi + 2);
            uint pt = (uint)Marshal.ReadInt32(_frameOut, fi + 4);
            int len = Marshal.ReadInt32(_frameOut, fi + 32);
            var f = new Frame { W = w, H = h, Index = ++_index, Time = DateTime.Now, PixelFormat = Mvs.PixelName(pt) };
            if (pix == IntPtr.Zero || w == 0 || h == 0) return new Frame { Failed = true, Error = "empty frame", Index = f.Index, Time = f.Time };
            if (convert)
            {
                byte[] dest;
                if (keep) dest = new byte[w * h * 3];
                else { if (_live == null || _live.Length != w * h * 3) _live = new byte[w * h * 3]; dest = _live; }
                var sw = System.Diagnostics.Stopwatch.StartNew();
                f.Rgb = ToRgb(pix, len, w, h, pt, f.PixelFormat, dest);
                f.ConvertMs = sw.Elapsed.TotalMilliseconds;
            }
            return f;
        }
        finally { _api.FreeImageBuffer(_h, _frameOut); }
    }

    private byte[] ToRgb(IntPtr pix, int len, int w, int h, uint pt, string fmt, byte[] dest)
    {
        if (pt == Mvs.PixRGB8) { Marshal.Copy(pix, dest, 0, Math.Min(len, dest.Length)); return dest; }
        if (_convMode != 2 && _api.ConvertPixelType != null)
        {
            var p = Marshal.AllocHGlobal(256);
            var pin = GCHandle.Alloc(dest, GCHandleType.Pinned);
            try
            {
                Mvs.Zero(p, 256);
                // MV_CC_PIXEL_CONVERT_PARAM (x64 layout)
                Marshal.WriteInt16(p, 0, (short)w); Marshal.WriteInt16(p, 2, (short)h); Marshal.WriteInt32(p, 4, (int)pt);
                Marshal.WriteIntPtr(p, 8, pix); Marshal.WriteInt32(p, 16, len);
                Marshal.WriteInt32(p, 20, (int)Mvs.PixRGB8); Marshal.WriteIntPtr(p, 24, pin.AddrOfPinnedObject()); Marshal.WriteInt32(p, 36, dest.Length);
                int r = _api.ConvertPixelType(_h, p);
                if (r == Mvs.OK)
                {
                    if (_convMode == 0) _log.Info("MVS pixel converter used for colour conversion");
                    _convMode = 1;
                    return dest;
                }
                if (_convMode == 1) throw new BridgeException($"pixel conversion ({fmt}): {Mvs.Err(r)}");
                _log.Warn($"MVS pixel converter not usable ({Mvs.Err(r)}); using built-in conversion");
                _convMode = 2;
            }
            finally { pin.Free(); Marshal.FreeHGlobal(p); }
        }
        if (_raw == null || _raw.Length != len) _raw = new byte[len];
        Marshal.Copy(pix, _raw, 0, len);
        return ImageCodec.ToRgb(_raw, w, h, fmt, dest) ?? throw new BridgeException($"pixel format {fmt} not supported by the built-in conversion; choose an 8-bit format (Mono8, Bayer..8, RGB8)");
    }

    // ---------------- settings files (MVS .mfs, also readable by the MVS client) ----------------
    public void SaveConfig(string path) { lock (_lock) Mvs.Check(_api.FeatureSave(_h, path), "MV_CC_FeatureSave"); }
    public void LoadConfig(string path) { lock (_lock) Mvs.Check(_api.FeatureLoad(_h, path), "MV_CC_FeatureLoad"); }

    public void Dispose()
    {
        if (_h == IntPtr.Zero) return;
        try { StopAcquisition(); } catch { }
        try { _api.CloseDevice(_h); } catch { }
        try { _api.DestroyHandle(_h); } catch { }
        _h = IntPtr.Zero;
        Marshal.FreeHGlobal(_buf); Marshal.FreeHGlobal(_frameOut);
    }
}

/// <summary>The part of the MVS C API (MvCameraControl.h) used by the bridge, bound at run time.
/// Struct layouts are those of the 64-bit SDK; structs are read from unmanaged scratch buffers that are larger than any SDK version needs.</summary>
internal sealed class Mvs
{
    public const int OK = 0;
    public const int NoData = unchecked((int)0x80000007);
    public const uint GigE = 0x1, Usb = 0x4;
    public const int DeviceListSize = 4 + 4 + 256 * 8;
    public const int ScratchSize = 4096;
    public const uint PixRGB8 = 0x02180014;

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnVoid();
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate uint FnVersion();
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnEnum(uint layers, IntPtr list);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnCreate(out IntPtr handle, IntPtr devInfo);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnHandle(IntPtr h);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnOpen(IntPtr h, uint access, ushort key);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] [return: MarshalAs(UnmanagedType.U1)] public delegate bool FnConnected(IntPtr h);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnGetStruct(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnGetBool(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, [MarshalAs(UnmanagedType.U1)] out bool value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnGetInt32(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, out int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetFloat(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, float value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetInt(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetInt64(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, long value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetBool(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, [MarshalAs(UnmanagedType.U1)] bool value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetString(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key, [MarshalAs(UnmanagedType.LPStr)] string value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnKey(IntPtr h, [MarshalAs(UnmanagedType.LPStr)] string key);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnSetUInt(IntPtr h, uint value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnFrame(IntPtr h, IntPtr frame, uint timeoutMs);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnFree(IntPtr h, IntPtr frame);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int FnConvert(IntPtr h, IntPtr param);

    // required (GetIntValue/SetIntValue: the Ex pair or the plain pair)
    public FnEnum EnumDevices; public FnCreate CreateHandle; public FnHandle DestroyHandle, CloseDevice, StartGrabbing, StopGrabbing, GetOptimalPacketSize;
    public FnOpen OpenDevice; public FnGetStruct GetFloatValue, GetIntValue, GetEnumValue, GetStringValue, GetEnumEntrySymbolic, GetIntValueEx;
    public FnGetBool GetBoolValue; public FnSetFloat SetFloatValue; public FnSetInt SetIntValue; public FnSetInt64 SetIntValueEx;
    public FnSetBool SetBoolValue; public FnSetString SetEnumValueByString, SetStringValue; public FnKey SetCommandValue, FeatureSave, FeatureLoad;
    public FnFrame GetImageBuffer; public FnFree FreeImageBuffer;
    // optional (depend on the SDK version)
    public FnVoid Initialize; public FnVersion GetSDKVersion; public FnConnected IsDeviceConnected; public FnSetUInt SetGrabStrategy;
    public FnGetInt32 GetNodeInterfaceType, GetNodeAccessMode; public FnConvert ConvertPixelType;

    public void Bind(IntPtr lib, List<string> missing)
    {
        T F<T>(string name) where T : Delegate
        {
            if (NativeLibrary.TryGetExport(lib, name, out var p)) return Marshal.GetDelegateForFunctionPointer<T>(p);
            missing.Add(name);
            return null;
        }
        EnumDevices = F<FnEnum>("MV_CC_EnumDevices"); CreateHandle = F<FnCreate>("MV_CC_CreateHandle"); DestroyHandle = F<FnHandle>("MV_CC_DestroyHandle");
        OpenDevice = F<FnOpen>("MV_CC_OpenDevice"); CloseDevice = F<FnHandle>("MV_CC_CloseDevice");
        StartGrabbing = F<FnHandle>("MV_CC_StartGrabbing"); StopGrabbing = F<FnHandle>("MV_CC_StopGrabbing");
        GetImageBuffer = F<FnFrame>("MV_CC_GetImageBuffer"); FreeImageBuffer = F<FnFree>("MV_CC_FreeImageBuffer");
        GetFloatValue = F<FnGetStruct>("MV_CC_GetFloatValue"); SetFloatValue = F<FnSetFloat>("MV_CC_SetFloatValue");
        GetEnumValue = F<FnGetStruct>("MV_CC_GetEnumValue"); SetEnumValueByString = F<FnSetString>("MV_CC_SetEnumValueByString");
        GetBoolValue = F<FnGetBool>("MV_CC_GetBoolValue"); SetBoolValue = F<FnSetBool>("MV_CC_SetBoolValue");
        GetStringValue = F<FnGetStruct>("MV_CC_GetStringValue"); SetStringValue = F<FnSetString>("MV_CC_SetStringValue");
        SetCommandValue = F<FnKey>("MV_CC_SetCommandValue");
        FeatureSave = F<FnKey>("MV_CC_FeatureSave"); FeatureLoad = F<FnKey>("MV_CC_FeatureLoad");
        int required = missing.Count;
        GetIntValueEx = F<FnGetStruct>("MV_CC_GetIntValueEx"); SetIntValueEx = F<FnSetInt64>("MV_CC_SetIntValueEx");
        GetIntValue = F<FnGetStruct>("MV_CC_GetIntValue"); SetIntValue = F<FnSetInt>("MV_CC_SetIntValue");
        if ((GetIntValueEx == null || SetIntValueEx == null) && (GetIntValue == null || SetIntValue == null)) { missing.Insert(0, "MV_CC_GetIntValue(Ex)/MV_CC_SetIntValue(Ex)"); required++; }
        if (GetIntValueEx == null || SetIntValueEx == null) { GetIntValueEx = null; SetIntValueEx = null; }
        GetEnumEntrySymbolic = F<FnGetStruct>("MV_CC_GetEnumEntrySymbolic");
        GetOptimalPacketSize = F<FnHandle>("MV_CC_GetOptimalPacketSize");
        Initialize = F<FnVoid>("MV_CC_Initialize"); GetSDKVersion = F<FnVersion>("MV_CC_GetSDKVersion");
        IsDeviceConnected = F<FnConnected>("MV_CC_IsDeviceConnected"); SetGrabStrategy = F<FnSetUInt>("MV_CC_SetGrabStrategy");
        GetNodeInterfaceType = F<FnGetInt32>("MV_XML_GetNodeInterfaceType"); GetNodeAccessMode = F<FnGetInt32>("MV_XML_GetNodeAccessMode");
        ConvertPixelType = F<FnConvert>("MV_CC_ConvertPixelType");
        if (required > 0)
            throw new Exception($"MvCameraControl.dll is too old or not the Hikrobot MVS runtime (missing {string.Join(", ", missing.Take(required))}). Install a current MVS version (3.x or newer).");
    }

    public static void Zero(IntPtr p, int n) { for (int i = 0; i < n; i += 8) Marshal.WriteInt64(p, i, 0); }

    public static string Str(IntPtr p, int offset, int max)
    {
        var b = new byte[max];
        Marshal.Copy(p + offset, b, 0, max);
        int n = Array.IndexOf(b, (byte)0); if (n < 0) n = max;
        return Encoding.UTF8.GetString(b, 0, n).Trim();
    }

    /// <summary>MV_CC_DEVICE_INFO: 32-byte header (versions, MAC, nTLayerType at 12), then the GigE or USB3 info union.</summary>
    public static CameraInfo ReadDeviceInfo(IntPtr p)
    {
        uint layer = (uint)Marshal.ReadInt32(p, 12);
        const int u = 32;
        var c = new CameraInfo();
        if (layer == GigE)
        {
            uint ip = (uint)Marshal.ReadInt32(p, u + 8);
            c.Interface = "GigE Vision"; c.Vendor = Str(p, u + 20, 32); c.Model = Str(p, u + 52, 32); c.Serial = Str(p, u + 164, 16); c.FriendlyName = Str(p, u + 180, 16);
            c.Props["DeviceVersion"] = Str(p, u + 84, 32);
            c.Props["IpAddress"] = $"{ip >> 24}.{(ip >> 16) & 0xFF}.{(ip >> 8) & 0xFF}.{ip & 0xFF}";
        }
        else if (layer == Usb)
        {
            c.Interface = "USB3 Vision"; c.Vendor = Str(p, u + 76, 64); c.Model = Str(p, u + 140, 64); c.Serial = Str(p, u + 396, 64); c.FriendlyName = Str(p, u + 460, 64);
            c.Props["DeviceVersion"] = Str(p, u + 268, 64);
            if (c.Vendor == "") c.Vendor = Str(p, u + 332, 64);
        }
        else c.Interface = $"layer 0x{layer:X}";
        if (c.Vendor == "") c.Vendor = "Hikrobot";
        c.Props["VendorName"] = c.Vendor; c.Props["ModelName"] = c.Model; c.Props["SerialNumber"] = c.Serial;
        return c;
    }

    private static readonly Dictionary<uint, string> Pixels = new()
    {
        [0x01080001] = "Mono8", [0x01100003] = "Mono10", [0x010C0004] = "Mono10Packed", [0x01100005] = "Mono12", [0x010C0006] = "Mono12Packed",
        [0x01080008] = "BayerGR8", [0x01080009] = "BayerRG8", [0x0108000A] = "BayerGB8", [0x0108000B] = "BayerBG8",
        [0x0110000C] = "BayerGR10", [0x0110000D] = "BayerRG10", [0x0110000E] = "BayerGB10", [0x0110000F] = "BayerBG10",
        [0x01100010] = "BayerGR12", [0x01100011] = "BayerRG12", [0x01100012] = "BayerGB12", [0x01100013] = "BayerBG12",
        [0x010C0026] = "BayerGR10Packed", [0x010C0027] = "BayerRG10Packed", [0x010C0028] = "BayerGB10Packed", [0x010C0029] = "BayerBG10Packed",
        [0x010C002A] = "BayerGR12Packed", [0x010C002B] = "BayerRG12Packed", [0x010C002C] = "BayerGB12Packed", [0x010C002D] = "BayerBG12Packed",
        [0x02180014] = "RGB8Packed", [0x02180015] = "BGR8Packed", [0x0210001F] = "YUV422Packed", [0x02100032] = "YUV422_YUYV_Packed",
    };
    public static string PixelName(uint v) => Pixels.TryGetValue(v, out var n) ? n : $"0x{v:X8}";

    /// <summary>Fallback names for older SDKs without MV_CC_GetEnumEntrySymbolic (values from the Hikrobot camera XML).</summary>
    public static string KnownSymbol(string node, uint v) => node switch
    {
        "PixelFormat" => Pixels.TryGetValue(v, out var n) ? n : null,
        "ExposureAuto" or "GainAuto" or "BalanceWhiteAuto" => v switch { 0 => "Off", 1 => "Once", 2 => "Continuous", _ => null },
        "TriggerMode" => v switch { 0 => "Off", 1 => "On", _ => null },
        "TriggerSelector" => v switch { 0 => "AcquisitionStart", 6 => "FrameBurstStart", _ => null },
        "TriggerSource" => v switch { 0 => "Line0", 1 => "Line1", 2 => "Line2", 3 => "Line3", 4 => "Counter0", 7 => "Software", 8 => "FrequencyConverter", _ => null },
        "TriggerActivation" => v switch { 0 => "RisingEdge", 1 => "FallingEdge", 2 => "LevelHigh", 3 => "LevelLow", _ => null },
        "BalanceRatioSelector" => v switch { 0 => "Red", 1 => "Green", 2 => "Blue", _ => null },
        "UserSetSelector" or "UserSetDefault" => v switch { 0 => "Default", 1 => "UserSet1", 2 => "UserSet2", 3 => "UserSet3", _ => null },
        _ => null,
    };

    private static readonly Dictionary<uint, string> Errors = new()
    {
        [0x80000000] = "invalid handle", [0x80000001] = "not supported", [0x80000003] = "wrong call order", [0x80000004] = "invalid parameter",
        [0x80000006] = "out of memory", [0x80000007] = "no data (timeout)", [0x80000008] = "precondition not met", [0x8000000C] = "cannot load library",
        [0x80000102] = "value out of range", [0x80000106] = "node not accessible now", [0x80000107] = "timeout",
        [0x80000203] = "access denied", [0x80000204] = "device busy", [0x80000206] = "network error", [0x80000221] = "IP address conflict",
        [0x80000302] = "USB device error", [0x80000304] = "insufficient USB bandwidth", [0x80000305] = "USB driver error (reinstall the MVS USB driver)",
    };
    public static string Err(int code) => Errors.TryGetValue(unchecked((uint)code), out var m) ? $"{m} (0x{code:X8})" : $"error 0x{code:X8}";
    public static void Check(int code, string what) { if (code != OK) throw new BridgeException($"{what}: {Err(code)}"); }
}
