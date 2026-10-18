using System.Collections;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Runtime.Versioning;

namespace CameraBridge;

/// <summary>
/// Basler cameras through the pylon .NET API (Basler.Pylon.dll), loaded at run time from the pylon installation.
/// Nothing from Basler is shipped with or compiled into the bridge; install the pylon Software Suite (x64).
/// </summary>
public sealed class PylonDriver : ICameraDriver
{
    private readonly BridgeConfig _cfg;
    private readonly Log _log;
    private Assembly _asm;
    private string _asmPath = "", _error = "";
    private readonly List<string> _tried = new();
    private readonly List<string> _nativeDirs = new();
    private readonly Dictionary<string, object> _infos = new();
    internal Type TCameraFinder, TCamera, TPLCamera, TGrabStrategy, TGrabLoop, TTimeout, TPixelType, TConverter, TParameterPath;
    internal Type[] NameHolders = Array.Empty<Type>();

    public string Name => "pylon";
    public bool Available => _asm != null;
    public string Error => _error;

    public PylonDriver(BridgeConfig cfg, Log log)
    {
        _cfg = cfg; _log = log;
        try { Load(); }
        catch (Exception e) { _error = e.Message; }
        if (Available) _log.Info($"pylon .NET API loaded: {_asmPath} (v{_asm.GetName().Version})");
        else _log.Warn($"pylon .NET API not available: {_error}");
    }

    // ---------------- finding and loading Basler.Pylon.dll ----------------
    private IEnumerable<string> Roots()
    {
        foreach (var v in new[] { "PYLON_DEV_DIR", "PYLON_ROOT", "PYLON_DIR" })
        {
            var p = Environment.GetEnvironmentVariable(v);
            if (!string.IsNullOrWhiteSpace(p) && Directory.Exists(p)) yield return p;
        }
        foreach (var pf in new[] { Environment.GetEnvironmentVariable("ProgramW6432"), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
        {
            if (string.IsNullOrWhiteSpace(pf)) continue;
            var b = Path.Combine(pf, "Basler");
            if (Directory.Exists(b)) yield return b;
        }
        if (OperatingSystem.IsLinux() && Directory.Exists("/opt/pylon")) yield return "/opt/pylon";
    }

    private static IEnumerable<string> FindFiles(string root, string name)
    {
        var stack = new Stack<(string dir, int depth)>(); stack.Push((root, 0));
        while (stack.Count > 0)
        {
            var (d, depth) = stack.Pop();
            string[] files = Array.Empty<string>(), dirs = Array.Empty<string>();
            try { files = Directory.GetFiles(d, name); dirs = depth < 7 ? Directory.GetDirectories(d) : Array.Empty<string>(); } catch { }
            foreach (var f in files) yield return f;
            foreach (var s in dirs) stack.Push((s, depth + 1));
        }
    }

    private static int Rank(string p)
    {
        var s = p.Replace('\\', '/').ToLowerInvariant(); int r = 0;
        if (s.Contains("/x64/") || s.Contains("64")) r += 2;
        if (s.Contains("/x86/") || s.Contains("win32")) r -= 6;
        if (s.Contains("netstandard") || s.Contains("netcore") || s.Contains("/net6") || s.Contains("/net7") || s.Contains("/net8") || s.Contains("/net9") || s.Contains("/net10") || s.Contains("dotnetcore")) r += 4;
        if (s.Contains("/net4") || s.Contains("framework")) r -= 1;
        return r;
    }

    private void Load()
    {
        var cands = new List<string>();
        if (!string.IsNullOrWhiteSpace(_cfg.PylonAssembly)) cands.Add(_cfg.Abs(_cfg.PylonAssembly));
        var roots = Roots().Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var r in roots) cands.AddRange(FindFiles(r, "Basler.Pylon.dll").OrderByDescending(Rank));
        cands = cands.Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (cands.Count == 0) throw new Exception("Basler.Pylon.dll not found. Install the Basler pylon Software Suite (x64) with the .NET API (Developer profile), or set \"pylonAssembly\" in bridge.config.json.");

        // native pylon DLLs: <pylon>/Runtime/x64, <pylon>/bin, ...
        foreach (var r in roots)
            foreach (var dll in FindFiles(r, "PylonBase*.dll").Concat(FindFiles(r, "PylonC*.dll")).Concat(FindFiles(r, "libpylonbase*.so*")))
            {
                var d = Path.GetDirectoryName(dll);
                if (Rank(d + "/") >= 0 && !_nativeDirs.Contains(d)) _nativeDirs.Add(d);
            }
        if (_nativeDirs.Count > 0)
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? "";
            Environment.SetEnvironmentVariable("PATH", string.Join(Path.PathSeparator, _nativeDirs) + Path.PathSeparator + path);
        }
        PreloadNative();

        foreach (var c in cands)
        {
            if (AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetName().Name == "Basler.Pylon"))
            {
                _tried.Add($"SKIP {c}: another Basler.Pylon.dll is already loaded in this process (only one version can be used)");
                continue;
            }
            try
            {
                var dir = Path.GetDirectoryName(c);
                AssemblyLoadContext.Default.Resolving += (ctx, an) =>
                {
                    var f = Path.Combine(dir, an.Name + ".dll");
                    return File.Exists(f) ? ctx.LoadFromAssemblyPath(f) : null;
                };
                var asm = AssemblyLoadContext.Default.LoadFromAssemblyPath(c);
                // which .NET assemblies does it need, and can they be found here?
                foreach (var r in asm.GetReferencedAssemblies())
                {
                    string st;
                    try { Assembly.Load(r); st = "ok"; } catch (Exception re) { st = "MISSING (" + re.GetType().Name + ")"; }
                    _refs.Add($"{r.Name} {r.Version}: {st}");
                }
                // Do NOT call NativeLibrary.SetDllImportResolver on Basler.Pylon: pylon 26 registers its own resolver
                // while it initializes, and only one resolver per assembly is allowed. Native DLLs are found via PATH /
                // SetDllDirectory and the preloaded pylon runtime (PreloadNative).
                var cam = asm.GetType("Basler.Pylon.Camera") ?? throw new Exception("type Basler.Pylon.Camera missing");
                TCameraFinder = asm.GetType("Basler.Pylon.CameraFinder") ?? throw new Exception("type Basler.Pylon.CameraFinder missing");
                TCamera = cam;
                TPLCamera = asm.GetType("Basler.Pylon.PLCamera");
                NameHolders = new[] { "Basler.Pylon.PLCamera", "Basler.Pylon.PLUsbCamera", "Basler.Pylon.PLGigECamera", "Basler.Pylon.PLCameraInstance" }
                    .Select(asm.GetType).Where(t => t != null).ToArray();
                TGrabStrategy = asm.GetType("Basler.Pylon.GrabStrategy");
                TGrabLoop = asm.GetType("Basler.Pylon.GrabLoop");
                TTimeout = asm.GetType("Basler.Pylon.TimeoutHandling");
                TPixelType = asm.GetType("Basler.Pylon.PixelType");
                TConverter = asm.GetType("Basler.Pylon.PixelDataConverter");
                TParameterPath = asm.GetType("Basler.Pylon.ParameterPath");
                if (TTimeout == null) throw new Exception("type Basler.Pylon.TimeoutHandling missing");
                // first real call: makes sure the native part loads
                R.CallStatic(TCameraFinder, "Enumerate");
                _asm = asm; _asmPath = c;
                _tried.Add($"OK   {c}");
                return;
            }
            catch (Exception e)
            {
                var chain = Chain(e);
                _tried.Add($"FAIL {c}: {chain}");
                if (_detail == "") _detail = Inner(e).ToString();
                _log.Warn($"pylon: cannot use {c}: {chain}");
                _log.Warn("pylon: details: " + Inner(e));
            }
        }
        throw new Exception("Basler.Pylon.dll was found but could not be loaded into .NET 8 (see diagnostics). Install a pylon version whose .NET API supports .NET 6+ (.NET Standard 2.0).");
    }

    private string _detail = "";
    private readonly List<string> _preloaded = new();
    private readonly List<string> _refs = new();

    private static Exception Inner(Exception e) => e is TargetInvocationException t && t.InnerException != null ? t.InnerException : e;

    /// <summary>All nested exceptions in one line: "Type: message <- InnerType: message ...".</summary>
    private static string Chain(Exception e)
    {
        var parts = new List<string>();
        for (var x = Inner(e); x != null; x = x.InnerException)
        {
            var m = $"{x.GetType().Name}: {x.Message}";
            if (x is FileNotFoundException f && !string.IsNullOrEmpty(f.FileName)) m += $" [file: {f.FileName}]";
            if (x is FileLoadException fl && !string.IsNullOrEmpty(fl.FileName)) m += $" [file: {fl.FileName}]";
            if (x.HResult != 0) m += $" (0x{x.HResult:X8})";
            parts.Add(m);
            if (parts.Count > 8) break;
        }
        return string.Join("  <-  ", parts);
    }

    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetDllDirectory(string path);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);

    /// <summary>Windows: make pylon's native runtime findable and load PylonBase / GenApi before the .NET API needs them
    /// (the C++/CLI part of Basler.Pylon.dll loads them while it initializes).</summary>
    private void PreloadNative()
    {
        if (!OperatingSystem.IsWindows() || _nativeDirs.Count == 0) return;
        try { SetDllDirectory(_nativeDirs[0]); } catch { }
        foreach (var d in _nativeDirs)
            foreach (var pat in new[] { "GCBase*.dll", "GenApi*.dll", "PylonBase*.dll", "PylonUtility*.dll" })
                foreach (var f in Directory.GetFiles(d, pat))
                {
                    var h = LoadLibraryEx(f, IntPtr.Zero, 0x00000008 /* LOAD_WITH_ALTERED_SEARCH_PATH */);
                    _preloaded.Add($"{(h != IntPtr.Zero ? "ok  " : $"FAIL(err {Marshal.GetLastWin32Error()}) ")}{Path.GetFileName(f)}");
                }
    }

    private static object Folder(string dir)
    {
        try { return Directory.Exists(dir) ? Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(x => x).Take(200).ToArray() : new[] { "(missing)" }; }
        catch (Exception e) { return new[] { e.Message }; }
    }

    public object Diag()
    {
        string fw = "", fileVer = "";
        try { fw = _asm?.GetCustomAttribute<TargetFrameworkAttribute>()?.FrameworkName ?? ""; } catch { }
        try { if (_asmPath != "") fileVer = FileVersionInfo.GetVersionInfo(_asmPath).FileVersion ?? ""; } catch { }
        return new
        {
            driver = Name, available = Available, error = _error, assembly = _asmPath, version = _asm?.GetName().Version?.ToString(), fileVersion = fileVer,
            targetFramework = fw, nativeDirs = _nativeDirs, tried = _tried, references = _refs, preloaded = _preloaded, detail = _detail,
            env = new[] { "PYLON_DEV_DIR", "PYLON_ROOT", "PYLON_CAMEMU", "GENICAM_GENTL64_PATH" }.ToDictionary(k => k, k => Environment.GetEnvironmentVariable(k) ?? ""),
            pathBasler = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator).Where(x => x.Contains("Basler", StringComparison.OrdinalIgnoreCase)).Distinct().ToArray(),
            assemblyFolder = _tried.Select(t => System.Text.RegularExpressions.Regex.Match(t, @"^\w+\s+(.+?Basler\.Pylon\.dll)").Groups[1].Value).Where(x => x != "").Select(Path.GetDirectoryName).Distinct().ToDictionary(x => x, x => Folder(x)),
            runtimeFolder = _nativeDirs.ToDictionary(x => x, x => Folder(x)),
            types = new { camera = TCamera != null, finder = TCameraFinder != null, plCamera = TPLCamera != null, converter = TConverter != null, parameterPath = TParameterPath != null },
            runtime = RuntimeInformation.FrameworkDescription, os = RuntimeInformation.OSDescription, arch = RuntimeInformation.ProcessArchitecture.ToString(),
        };
    }

    // ---------------- cameras ----------------
    internal static Dictionary<string, string> ReadInfo(object info)
    {
        var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (info is IEnumerable<KeyValuePair<string, string>> kv) { foreach (var p in kv) d[p.Key] = p.Value; return d; }
        if (info is IDictionary dict) { foreach (DictionaryEntry e in dict) d[e.Key?.ToString() ?? ""] = e.Value?.ToString() ?? ""; return d; }
        foreach (var k in new[] { "ModelName", "SerialNumber", "VendorName", "DeviceClass", "FriendlyName", "FullName", "UserDefinedName", "DeviceType" })
            try { var v = R.Index(info, k); if (v != null) d[k] = v.ToString(); } catch { }
        return d;
    }

    public List<CameraInfo> Enumerate()
    {
        if (!Available) return new List<CameraInfo>();
        var list = new List<CameraInfo>();
        var res = R.CallStatic(TCameraFinder, "Enumerate") as IEnumerable;
        lock (_infos)
        {
            _infos.Clear();
            foreach (var info in res ?? Array.Empty<object>())
            {
                var p = ReadInfo(info);
                p.TryGetValue("SerialNumber", out var sn); p.TryGetValue("ModelName", out var model);
                p.TryGetValue("DeviceClass", out var cls); p.TryGetValue("VendorName", out var vendor); p.TryGetValue("FriendlyName", out var fn);
                var id = "pylon:" + (string.IsNullOrEmpty(sn) ? (p.TryGetValue("FullName", out var full) ? full : Guid.NewGuid().ToString("N")) : sn);
                _infos[id] = info;
                list.Add(new CameraInfo
                {
                    Id = id, Driver = Name, Model = model ?? "", Serial = sn ?? "", Vendor = vendor ?? "Basler", FriendlyName = fn ?? "",
                    Interface = cls?.Contains("Usb", StringComparison.OrdinalIgnoreCase) == true ? "USB3 Vision" : cls?.Contains("GigE", StringComparison.OrdinalIgnoreCase) == true ? "GigE Vision" : cls ?? "",
                    Props = p,
                });
            }
        }
        return list;
    }

    public ICameraDevice Open(CameraInfo info)
    {
        object ci;
        lock (_infos) _infos.TryGetValue(info.Id, out ci);
        if (ci == null) { Enumerate(); lock (_infos) _infos.TryGetValue(info.Id, out ci); }
        if (ci == null) throw new BridgeException($"camera {info.Id} not found");
        object cam;
        try { cam = Activator.CreateInstance(TCamera, ci); }
        catch (Exception e) { throw new BridgeException("cannot create pylon camera: " + (e.InnerException?.Message ?? e.Message)); }
        try { R.Call(cam, "Open"); }
        catch (Exception e) { (cam as IDisposable)?.Dispose(); throw new BridgeException("cannot open camera (is it used by pylon Viewer or another program?): " + e.Message); }
        return new PylonDevice(this, cam, info, _log);
    }
}

internal sealed class PylonDevice : ICameraDevice
{
    private readonly PylonDriver _d;
    private readonly object _cam, _params;
    private readonly Log _log;
    private object _sg, _converter;
    private int _convMode; // 0 untested, 1 pylon converter, 2 own conversion
    private long _index;
    private readonly Dictionary<string, object> _names = new();
    private readonly Dictionary<string, (MethodInfo m, object corr)> _setters = new();

    public CameraInfo Info { get; }
    public bool Acquiring { get; private set; }

    public PylonDevice(PylonDriver d, object cam, CameraInfo info, Log log)
    {
        _d = d; _cam = cam; Info = info; _log = log;
        _params = R.Get(cam, "Parameters");
        _sg = R.Get(cam, "StreamGrabber");
    }

    public bool IsConnected
    {
        get { try { return !R.TryGet(_cam, "IsConnected", out var v) || v is not bool b || b; } catch { return false; } }
    }

    // ---------------- parameters ----------------
    private object NameObj(string node)
    {
        lock (_names)
        {
            if (_names.TryGetValue(node, out var o)) return o;
            foreach (var t in _d.NameHolders) { o = R.StaticMember(t, node); if (o != null) break; }
            _names[node] = o;
            return o;
        }
    }

    private static string KindOf(object nameObj)
    {
        for (var t = nameObj.GetType(); t != null; t = t.BaseType)
        {
            var n = t.Name;
            if (n.StartsWith("Float")) return "float";
            if (n.StartsWith("Integer")) return "int";
            if (n.StartsWith("Enum")) return "enum";
            if (n.StartsWith("Boolean")) return "bool";
            if (n.StartsWith("Command")) return "command";
            if (n.StartsWith("String")) return "string";
        }
        return "";
    }

    /// <summary>A parameter object together with its declared interface (IFloatParameter, IEnumParameter, ...).</summary>
    private sealed class Prm
    {
        public object O; public Type T;
        public object Call(string m, params object[] a) => R.CallOn(T, O, m, a);
        public bool Has(string m, int argc) => R.HasOn(T, m, argc);
    }

    private Prm Param(string node, out string kind)
    {
        kind = "";
        var n = NameObj(node);
        if (n == null) return null;
        kind = KindOf(n);
        try
        {
            if (R.Has(_params, "Contains", 1)) { var c = R.Call(_params, "Contains", n); if (c is bool b && !b) return null; }
        }
        catch { }
        try { var o = R.Index(_params, n, out var t); return o == null ? null : new Prm { O = o, T = t }; } catch { return null; }
    }

    private static bool Flag(Prm p, string name) { try { return R.GetOn(p.T, p.O, name) is bool b && b; } catch { return false; } }

    private void Select(FeatureDef def)
    {
        if (def.Selector == null) return;
        var s = Param(def.Selector, out _);
        if (s == null || !Flag(s, "IsWritable")) return;
        try { if (!string.Equals(s.Call("GetValue")?.ToString(), def.SelectorValue, StringComparison.OrdinalIgnoreCase)) s.Call("SetValue", def.SelectorValue); } catch { }
    }

    private Prm Resolve(FeatureDef def, out string node, out string kind)
    {
        node = null; kind = "";
        foreach (var n in def.Alts)
        {
            var p = Param(n, out var k);
            if (p == null) continue;
            Select(def);
            if (k != "command" && !Flag(p, "IsReadable") && !Flag(p, "IsWritable")) continue;
            node = n; kind = k; return p;
        }
        return null;
    }

    private static double? Num(Prm p, string m) { try { var v = p.Call(m); return v == null ? null : Convert.ToDouble(v); } catch { return null; } }

    public FeatureInfo ReadFeature(FeatureDef def)
    {
        var p = Resolve(def, out var node, out var kind);
        if (p == null) return null;
        var f = new FeatureInfo { Name = def.Name, Group = def.Group, Label = def.Label, Type = kind, Node = node, Readable = Flag(p, "IsReadable"), Writable = Flag(p, "IsWritable") };
        try
        {
            switch (kind)
            {
                case "float":
                case "int":
                    if (f.Readable) f.Value = Convert.ToDouble(p.Call("GetValue"));
                    f.Min = Num(p, "GetMinimum"); f.Max = Num(p, "GetMaximum"); f.Inc = p.Has("GetIncrement", 0) ? Num(p, "GetIncrement") : null;
                    if (kind == "int" && f.Value is double dv) f.Value = (long)dv;
                    break;
                case "enum":
                    if (f.Readable) f.Value = p.Call("GetValue")?.ToString();
                    try
                    {
                        var all = (p.Call("GetAllValues") as IEnumerable)?.Cast<object>().Select(x => x.ToString()).ToList() ?? new List<string>();
                        if (f.Writable && p.Has("CanSetValue", 1)) all = all.Where(v => { try { return p.Call("CanSetValue", v) is bool b && b; } catch { return true; } }).ToList();
                        if (f.Value is string cur && !all.Contains(cur)) all.Insert(0, cur);
                        f.Options = all.ToArray();
                    }
                    catch { f.Options = f.Value is string s ? new[] { s } : Array.Empty<string>(); }
                    break;
                case "bool":
                    if (f.Readable) f.Value = p.Call("GetValue");
                    break;
                case "string":
                    if (f.Readable) f.Value = p.Call("GetValue")?.ToString();
                    break;
            }
        }
        catch (Exception e) { f.Value ??= null; _log.Warn($"read {node}: {e.Message}"); }
        return f;
    }

    public void WriteFeature(FeatureDef def, object value)
    {
        var p = Resolve(def, out var node, out var kind) ?? throw new BridgeException($"{def.Name} is not available on this camera");
        if (!Flag(p, "IsWritable")) throw new BridgeException($"{def.Name} cannot be changed now", 409);
        switch (kind)
        {
            case "float": SetNum(p, Convert.ToDouble(value), "ClipToRange"); break;
            case "int": SetNum(p, Math.Round(Convert.ToDouble(value)), "Nearest"); break;
            case "enum": p.Call("SetValue", value?.ToString() ?? ""); break;
            case "bool": p.Call("SetValue", value is bool b ? b : Convert.ToBoolean(value)); break;
            case "command": p.Call("Execute"); break;
            case "string": p.Call("SetValue", value?.ToString() ?? ""); break;
            default: throw new BridgeException($"{def.Name}: unsupported type");
        }
    }

    /// <summary>SetValue(value, correction) when available (avoids errors for values off the increment), else SetValue(value).</summary>
    private void SetNum(Prm p, double v, string correction)
    {
        var t = p.T; var key = t.FullName + correction;
        (MethodInfo m, object corr) s;
        lock (_setters)
        {
            if (!_setters.TryGetValue(key, out s))
            {
                foreach (var m in R.MethodsOn(t, "SetValue"))
                    {
                        var ps = m.GetParameters();
                        if (ps.Length == 2 && ps[1].ParameterType.IsEnum && (ps[0].ParameterType == typeof(double) || ps[0].ParameterType == typeof(long)))
                        {
                            try { s = (m, Enum.Parse(ps[1].ParameterType, correction, true)); } catch { continue; }
                            break;
                        }
                    }
                _setters[key] = s;
            }
        }
        if (s.m != null)
        {
            var pt = s.m.GetParameters()[0].ParameterType;
            try { s.m.Invoke(p.O, new[] { pt == typeof(long) ? (object)(long)Math.Round(v) : v, s.corr }); return; }
            catch (TargetInvocationException e) when (e.InnerException != null) { throw e.InnerException; }
        }
        p.Call("SetValue", v);
    }

    public void Execute(string node)
    {
        var p = Param(node, out var kind) ?? throw new BridgeException($"{node} is not available on this camera");
        if (kind != "command") throw new BridgeException($"{node} is not a command");
        p.Call("Execute");
    }

    // ---------------- grabbing ----------------
    public void StartAcquisition()
    {
        if (Acquiring) return;
        try { R.Call(_sg, "Start", R.EnumValue(_d.TGrabStrategy, "LatestImages"), R.EnumValue(_d.TGrabLoop, "ProvidedByUser")); }
        catch (MissingMethodException) { R.Call(_sg, "Start"); }
        catch (ArgumentException) { R.Call(_sg, "Start"); }
        Acquiring = true;
    }

    public void StopAcquisition()
    {
        if (!Acquiring) return;
        try { R.Call(_sg, "Stop"); } catch (Exception e) { _log.Warn("stop grabbing: " + e.Message); }
        Acquiring = false;
    }

    private byte[] _live;
    public Frame Retrieve(int timeoutMs, bool convert, bool keep = true)
    {
        if (!Acquiring) { Thread.Sleep(Math.Min(timeoutMs, 50)); return null; }
        var gr = R.Call(_sg, "RetrieveResult", timeoutMs, R.EnumValue(_d.TTimeout, "Return"));
        if (gr == null) return null;
        try
        {
            if (!(R.Get(gr, "GrabSucceeded") is bool ok && ok))
            {
                R.TryGet(gr, "ErrorDescription", out var err);
                return new Frame { Failed = true, Error = err?.ToString() ?? "grab failed", Index = ++_index, Time = DateTime.Now };
            }
            int w = Convert.ToInt32(R.Get(gr, "Width")), h = Convert.ToInt32(R.Get(gr, "Height"));
            R.TryGet(gr, "PixelTypeValue", out var pt);
            var f = new Frame { W = w, H = h, Index = ++_index, Time = DateTime.Now, PixelFormat = pt?.ToString() ?? "" };
            if (convert)
            {
                byte[] dest;
                if (keep) dest = new byte[w * h * 3];
                else { if (_live == null || _live.Length != w * h * 3) _live = new byte[w * h * 3]; dest = _live; }
                var sw = System.Diagnostics.Stopwatch.StartNew();
                f.Rgb = ToRgb(gr, w, h, f.PixelFormat, dest);
                f.ConvertMs = sw.Elapsed.TotalMilliseconds;
            }
            return f;
        }
        finally { (gr as IDisposable)?.Dispose(); }
    }

    private byte[] ToRgb(object gr, int w, int h, string fmt, byte[] buf)
    {
        if (_convMode != 2 && _d.TConverter != null && _d.TPixelType != null)
        {
            try
            {
                _converter ??= Activator.CreateInstance(_d.TConverter);
                R.Set(_converter, "OutputPixelFormat", R.EnumValue(_d.TPixelType, "RGB8packed"));
                R.Call(_converter, "Convert", buf, gr);
                if (_convMode == 0) _log.Info("pylon PixelDataConverter used for colour conversion");
                _convMode = 1;
                return buf;
            }
            catch (Exception e)
            {
                if (_convMode == 1) throw;
                _log.Warn("pylon PixelDataConverter not usable (" + e.Message + "); using built-in conversion");
                _convMode = 2;
            }
        }
        var raw = R.Get(gr, "PixelData") as byte[] ?? throw new BridgeException($"pixel data of format {fmt} not supported; set PixelFormat to Mono8, BayerRG8 or RGB8");
        return ImageCodec.ToRgb(raw, w, h, fmt, buf) ?? throw new BridgeException($"pixel format {fmt} not supported by the built-in conversion; choose an 8-bit format (Mono8, Bayer..8, RGB8)");
    }

    public void SaveConfig(string path)
    {
        var pp = _d.TParameterPath != null ? R.StaticMember(_d.TParameterPath, "CameraDevice") : "CameraDevice";
        R.Call(_params, "Save", path, pp?.ToString() ?? "CameraDevice");
    }

    public void LoadConfig(string path)
    {
        var pp = _d.TParameterPath != null ? R.StaticMember(_d.TParameterPath, "CameraDevice") : "CameraDevice";
        R.Call(_params, "Load", path, pp?.ToString() ?? "CameraDevice");
    }

    public void Dispose()
    {
        try { StopAcquisition(); } catch { }
        try { R.Call(_cam, "Close"); } catch { }
        try { (_cam as IDisposable)?.Dispose(); } catch { }
    }
}
