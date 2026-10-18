// Test double of the Basler pylon .NET API surface used by the Camera Bridge (NOT Basler code).
using System; using System.Collections.Generic; using System.Linq;
namespace Basler.Pylon {
  public enum GrabStrategy { OneByOne, LatestImageOnly, LatestImages, UpcomingImage }
  public enum GrabLoop { ProvidedByStreamGrabber, ProvidedByUser }
  public enum TimeoutHandling { Return, ThrowException }
  public enum PixelType { Undefined, Mono8, BayerRG8, RGB8packed, BGR8packed, BGRA8packed }
  public enum FloatValueCorrection { None, ClipToRange, ClipToRangeAndIncrement }
  public enum IntegerValueCorrection { None, Nearest, Up, Down }
  public static class ParameterPath { public const string CameraDevice = "CameraDevice"; }
  public class FloatName { public string N; public FloatName(string n) { N = n; } }
  public class IntegerName { public string N; public IntegerName(string n) { N = n; } }
  public class EnumName { public string N; public EnumName(string n) { N = n; } }
  public class BooleanName { public string N; public BooleanName(string n) { N = n; } }
  public class CommandName { public string N; public CommandName(string n) { N = n; } }
  public class StringName { public string N; public StringName(string n) { N = n; } }
  public static class PLCamera {
    public sealed class AutoEnum : EnumName { public AutoEnum(string n) : base(n) { } public readonly string Off = "Off", Once = "Once", Continuous = "Continuous"; }
    public static readonly StringName DeviceModelName = new StringName("DeviceModelName"), DeviceSerialNumber = new StringName("DeviceSerialNumber"), DeviceFirmwareVersion = new StringName("DeviceFirmwareVersion");
    public static readonly FloatName DeviceTemperature = new FloatName("DeviceTemperature"), ExposureTime = new FloatName("ExposureTime"), Gain = new FloatName("Gain"), BlackLevel = new FloatName("BlackLevel"), Gamma = new FloatName("Gamma"), BalanceRatio = new FloatName("BalanceRatio"), AcquisitionFrameRate = new FloatName("AcquisitionFrameRate"), ResultingFrameRate = new FloatName("ResultingFrameRate"), TriggerDelay = new FloatName("TriggerDelay"), AutoTargetBrightness = new FloatName("AutoTargetBrightness");
    public static readonly AutoEnum ExposureAuto = new AutoEnum("ExposureAuto"), GainAuto = new AutoEnum("GainAuto"), BalanceWhiteAuto = new AutoEnum("BalanceWhiteAuto");
    public static readonly EnumName PixelFormat = new EnumName("PixelFormat"), BalanceRatioSelector = new EnumName("BalanceRatioSelector"), TriggerSelector = new EnumName("TriggerSelector"), TriggerMode = new EnumName("TriggerMode"), TriggerSource = new EnumName("TriggerSource"), TriggerActivation = new EnumName("TriggerActivation"), LineSelector = new EnumName("LineSelector"), LineSource = new EnumName("LineSource"), UserSetSelector = new EnumName("UserSetSelector"), UserSetDefault = new EnumName("UserSetDefault"), ShutterMode = new EnumName("ShutterMode"), LightSourcePreset = new EnumName("LightSourcePreset");
    public static readonly IntegerName Width = new IntegerName("Width"), Height = new IntegerName("Height"), OffsetX = new IntegerName("OffsetX"), OffsetY = new IntegerName("OffsetY"), DeviceLinkSpeed = new IntegerName("DeviceLinkSpeed");
    public static readonly BooleanName ReverseX = new BooleanName("ReverseX"), ReverseY = new BooleanName("ReverseY"), AcquisitionFrameRateEnable = new BooleanName("AcquisitionFrameRateEnable"), LineInverter = new BooleanName("LineInverter"), CenterX = new BooleanName("CenterX");
    public static readonly CommandName UserSetLoad = new CommandName("UserSetLoad"), UserSetSave = new CommandName("UserSetSave"), TriggerSoftware = new CommandName("TriggerSoftware");
    // a node the fake camera does NOT have
    public static readonly FloatName ExposureTimeAbs = new FloatName("ExposureTimeAbs");
  }
  public interface ICameraInfo : IReadOnlyDictionary<string, string> { }
  internal sealed class CamInfo : Dictionary<string, string>, ICameraInfo { }
  public static class CameraFinder {
    static CameraFinder() { System.Runtime.InteropServices.NativeLibrary.SetDllImportResolver(typeof(CameraFinder).Assembly, (n, a, p) => IntPtr.Zero); } // like pylon 26 (throws if the host set one)
    public static List<ICameraInfo> Enumerate() => new List<ICameraInfo> { new CamInfo { ["ModelName"] = "acA4600-10uc", ["SerialNumber"] = "22446515", ["VendorName"] = "Basler", ["DeviceClass"] = "BaslerUsb", ["FriendlyName"] = "Basler acA4600-10uc (22446515)" } };
  }
  public interface IParameter { bool IsReadable { get; } bool IsWritable { get; } string Name { get; } }
  public interface IFloatParameter : IParameter { double GetValue(); void SetValue(double v); void SetValue(double v, FloatValueCorrection c); double GetMinimum(); double GetMaximum(); bool TrySetValue(double v); }
  public interface IIntegerParameter : IParameter { long GetValue(); void SetValue(long v); void SetValue(long v, IntegerValueCorrection c); long GetMinimum(); long GetMaximum(); long GetIncrement(); }
  public interface IEnumParameter : IParameter { string GetValue(); void SetValue(string v); void SetValue(params string[] v); IEnumerable<string> GetAllValues(); bool CanSetValue(string v); }
  public interface IBooleanParameter : IParameter { bool GetValue(); void SetValue(bool v); }
  public interface ICommandParameter : IParameter { void Execute(); }
  public interface IStringParameter : IParameter { string GetValue(); void SetValue(string v); }
  public interface IParameterCollection {
    IFloatParameter this[FloatName n] { get; } IIntegerParameter this[IntegerName n] { get; } IEnumParameter this[EnumName n] { get; }
    IBooleanParameter this[BooleanName n] { get; } ICommandParameter this[CommandName n] { get; } IStringParameter this[StringName n] { get; }
    bool Contains(FloatName n); bool Contains(IntegerName n); bool Contains(EnumName n); bool Contains(BooleanName n); bool Contains(CommandName n); bool Contains(StringName n);
    void Save(string file, string path); void Load(string file, string path);
  }
  public interface IImage { int Width { get; } int Height { get; } PixelType PixelTypeValue { get; } object PixelData { get; } }
  public interface IGrabResult : IImage, IDisposable { bool GrabSucceeded { get; } string ErrorDescription { get; } long ImageNumber { get; } }
  public interface IStreamGrabber { void Start(); void Start(GrabStrategy s, GrabLoop l); void Stop(); bool IsGrabbing { get; } IGrabResult RetrieveResult(int timeoutMs, TimeoutHandling h); }
  public class PixelDataConverter {
    public PixelType OutputPixelFormat { get; set; }
    public long GetBufferSizeForConversion(IImage img) => img.Width * img.Height * 3;
    public void Convert<T>(T[] buffer, IImage src) {
      if (OutputPixelFormat != PixelType.RGB8packed || !(buffer is byte[] b)) throw new InvalidOperationException("only RGB8packed into byte[] in the fake");
      var raw = (byte[])src.PixelData; int w = src.Width, h = src.Height;
      for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) { int v = raw[y * w + x], d = (y * w + x) * 3; b[d] = b[d + 1] = b[d + 2] = (byte)v; } // fake: gray only
    }
  }
  internal sealed class Node : IFloatParameter, IIntegerParameter, IEnumParameter, IBooleanParameter, ICommandParameter, IStringParameter {
    public FakeCam Cam; public string Name { get; set; } public object V; public double Min, Max; public string[] Opts; public bool Ro; public bool LockedWhileGrabbing;
    public bool IsReadable => true; public bool IsWritable => !Ro && !(LockedWhileGrabbing && Cam.Grabbing);
    void Chk() { if (!IsWritable) throw new InvalidOperationException($"Node {Name} is not writable"); }
    double IFloatParameter.GetValue() => System.Convert.ToDouble(V);
    void IFloatParameter.SetValue(double v) { Chk(); if (v < Min || v > Max) throw new ArgumentOutOfRangeException(Name); V = v; Cam.Changed(Name); }
    void IFloatParameter.SetValue(double v, FloatValueCorrection c) { Chk(); V = Math.Max(Min, Math.Min(Max, v)); Cam.Changed(Name); }
    double IFloatParameter.GetMinimum() => Min; double IFloatParameter.GetMaximum() => Max; bool IFloatParameter.TrySetValue(double v) { V = v; return true; }
    long IIntegerParameter.GetValue() => System.Convert.ToInt64(V);
    void IIntegerParameter.SetValue(long v) { Chk(); if (v % 4 != 0) throw new ArgumentException("increment"); V = v; }
    void IIntegerParameter.SetValue(long v, IntegerValueCorrection c) { Chk(); V = Math.Max((long)Min, Math.Min((long)Max, v / 4 * 4)); }
    long IIntegerParameter.GetMinimum() => (long)Min; long IIntegerParameter.GetMaximum() => (long)Max; long IIntegerParameter.GetIncrement() => 4;
    string IEnumParameter.GetValue() => (string)V;
    void IEnumParameter.SetValue(string v) { Chk(); if (!Opts.Contains(v)) throw new ArgumentException($"{v} not in {Name}"); V = v; Cam.Changed(Name); }
    void IEnumParameter.SetValue(params string[] v) { throw new NotSupportedException("array overload must not be used"); }
    IEnumerable<string> IEnumParameter.GetAllValues() => Opts.Concat(new[] { "NotAvailableValue" });
    bool IEnumParameter.CanSetValue(string v) => Opts.Contains(v);
    bool IBooleanParameter.GetValue() => (bool)V; void IBooleanParameter.SetValue(bool v) { Chk(); V = v; }
    void ICommandParameter.Execute() { Cam.Command(Name); }
    string IStringParameter.GetValue() => (string)V; void IStringParameter.SetValue(string v) { Chk(); V = v; }
  }
  internal sealed class FakeCam : IParameterCollection {
    public bool Grabbing; public Dictionary<string, Node> Nodes = new Dictionary<string, Node>();
    public Dictionary<string, double> Ratio = new Dictionary<string, double> { ["Red"] = 1, ["Green"] = 1, ["Blue"] = 1 };
    public bool SwTrig; public int OnceFrames;
    Node Add(string n, object v, double min = 0, double max = 0, string[] opts = null, bool ro = false, bool lockG = false) { var x = new Node { Cam = this, Name = n, V = v, Min = min, Max = max, Opts = opts, Ro = ro, LockedWhileGrabbing = lockG }; Nodes[n] = x; return x; }
    public FakeCam() {
      string[] auto = { "Off", "Once", "Continuous" };
      Add("DeviceModelName", "acA4600-10uc", ro: true); Add("DeviceSerialNumber", "22446515", ro: true); Add("DeviceFirmwareVersion", "106538-18", ro: true);
      Add("DeviceTemperature", 44.2, -40, 100, ro: true); Add("DeviceLinkSpeed", 400000000L, 0, 1e9, ro: true);
      Add("ExposureAuto", "Off", opts: auto); Add("ExposureTime", 8000.0, 35, 1e6); Add("AutoTargetBrightness", 0.3, 0.2, 0.8);
      Add("GainAuto", "Off", opts: auto); Add("Gain", 0.0, 0, 18); Add("BlackLevel", 0.0, 0, 31); Add("Gamma", 1.0, 0, 3.99);
      Add("PixelFormat", "BayerRG8", opts: new[] { "Mono8", "BayerRG8", "BayerRG12", "RGB8", "BGR8" }, lockG: true);
      Add("BalanceWhiteAuto", "Off", opts: auto); Add("BalanceRatioSelector", "Red", opts: new[] { "Red", "Green", "Blue" }); Add("BalanceRatio", 1.0, 1, 15.98);
      Add("LightSourcePreset", "Off", opts: new[] { "Off", "Daylight5000K" });
      Add("Width", 640L, 16, 640, lockG: true); Add("Height", 480L, 16, 480, lockG: true); Add("OffsetX", 0L, 0, 0); Add("OffsetY", 0L, 0, 0);
      Add("ReverseX", false); Add("ReverseY", false); Add("CenterX", false);
      Add("ShutterMode", "Rolling", opts: new[] { "Rolling", "GlobalResetRelease" });
      Add("AcquisitionFrameRateEnable", false); Add("AcquisitionFrameRate", 10.0, 0.1, 10); Add("ResultingFrameRate", 10.0, 0, 100, ro: true);
      Add("TriggerSelector", "FrameStart", opts: new[] { "FrameStart", "FrameBurstStart" }); Add("TriggerMode", "Off", opts: new[] { "Off", "On" });
      Add("TriggerSource", "Line1", opts: new[] { "Software", "Line1", "Line3" }); Add("TriggerActivation", "RisingEdge", opts: new[] { "RisingEdge", "FallingEdge" }); Add("TriggerDelay", 0.0, 0, 1e6);
      Add("LineSelector", "Line1", opts: new[] { "Line1", "Line2", "Line3" }); Add("LineSource", "ExposureActive", opts: new[] { "ExposureActive", "UserOutput1" }); Add("LineInverter", false);
      Add("UserSetSelector", "Default", opts: new[] { "Default", "UserSet1", "UserSet2" }); Add("UserSetDefault", "Default", opts: new[] { "Default", "UserSet1", "UserSet2" });
      Add("UserSetLoad", null); Add("UserSetSave", null); Add("TriggerSoftware", null);
    }
    public void Changed(string n) {
      if (n == "BalanceRatioSelector") Nodes["BalanceRatio"].V = Ratio[(string)Nodes["BalanceRatioSelector"].V];
      if (n == "BalanceRatio") Ratio[(string)Nodes["BalanceRatioSelector"].V] = System.Convert.ToDouble(Nodes["BalanceRatio"].V);
      if (n == "ExposureAuto" && (string)Nodes[n].V == "Once") OnceFrames = 3;
    }
    public void Command(string n) {
      if (n == "TriggerSoftware") SwTrig = true;
      else if (n.StartsWith("UserSet") && Grabbing) throw new InvalidOperationException("UserSet commands need acquisition stopped");
    }
    Node Get(object o) { var n = (string)o.GetType().GetField("N").GetValue(o); Node x; return Nodes.TryGetValue(n, out x) ? x : null; }
    IFloatParameter IParameterCollection.this[FloatName n] => Get(n) ?? new Node { Cam = this, Name = n.N, Ro = true };
    IIntegerParameter IParameterCollection.this[IntegerName n] => Get(n); IEnumParameter IParameterCollection.this[EnumName n] => Get(n);
    IBooleanParameter IParameterCollection.this[BooleanName n] => Get(n); ICommandParameter IParameterCollection.this[CommandName n] => Get(n); IStringParameter IParameterCollection.this[StringName n] => Get(n);
    bool IParameterCollection.Contains(FloatName n) => Get(n) != null; bool IParameterCollection.Contains(IntegerName n) => Get(n) != null; bool IParameterCollection.Contains(EnumName n) => Get(n) != null;
    bool IParameterCollection.Contains(BooleanName n) => Get(n) != null; bool IParameterCollection.Contains(CommandName n) => Get(n) != null; bool IParameterCollection.Contains(StringName n) => Get(n) != null;
    void IParameterCollection.Save(string f, string p) { if (p != "CameraDevice") throw new ArgumentException(p); System.IO.File.WriteAllLines(f, Nodes.Values.Where(x => x.V != null && !x.Ro).Select(x => x.Name + "\t" + x.V)); }
    void IParameterCollection.Load(string f, string p) { if (Grabbing) throw new InvalidOperationException("load while grabbing"); foreach (var l in System.IO.File.ReadAllLines(f)) { var s = l.Split('\t'); if (Nodes.TryGetValue(s[0], out var x) && x.V is string) x.V = s[1]; } }
  }
  internal sealed class Result : IGrabResult {
    public int Width { get; set; } public int Height { get; set; } public PixelType PixelTypeValue { get; set; } public object PixelData { get; set; }
    public bool GrabSucceeded { get; set; } = true; public string ErrorDescription { get; set; } = ""; public long ImageNumber { get; set; } public bool Disposed; public void Dispose() { Disposed = true; }
  }
  internal sealed class Grabber : IStreamGrabber {
    readonly FakeCam c; long n; DateTime next = DateTime.MinValue; public Grabber(FakeCam c) { this.c = c; }
    public bool IsGrabbing => c.Grabbing;
    public void Start() { c.Grabbing = true; } public void Start(GrabStrategy s, GrabLoop l) { if (l != GrabLoop.ProvidedByUser) throw new ArgumentException("loop"); c.Grabbing = true; }
    public void Stop() { c.Grabbing = false; }
    public IGrabResult RetrieveResult(int timeoutMs, TimeoutHandling h) {
      if (!c.Grabbing) throw new InvalidOperationException("not grabbing");
      if ((string)c.Nodes["TriggerMode"].V == "On") { if (!c.SwTrig) { System.Threading.Thread.Sleep(Math.Min(timeoutMs, 50)); return null; } c.SwTrig = false; }
      var wait = next - DateTime.Now; if (wait > TimeSpan.Zero) System.Threading.Thread.Sleep(wait); next = DateTime.Now.AddMilliseconds(100);
      if (c.OnceFrames > 0 && --c.OnceFrames == 0) { c.Nodes["ExposureAuto"].V = "Off"; c.Nodes["ExposureTime"].V = 12345.0; }
      int w = System.Convert.ToInt32(c.Nodes["Width"].V), hh = System.Convert.ToInt32(c.Nodes["Height"].V); var raw = new byte[w * hh];
      for (int y = 0; y < hh; y++) for (int x = 0; x < w; x++) raw[y * w + x] = (byte)(((x / 40 + y / 40) % 2 == 0) ? 200 : 40);
      var pf = (string)c.Nodes["PixelFormat"].V;
      return new Result { Width = w, Height = hh, PixelTypeValue = pf == "Mono8" ? PixelType.Mono8 : PixelType.BayerRG8, PixelData = raw, ImageNumber = ++n };
    }
  }
  public class Camera : IDisposable {
    readonly FakeCam c = new FakeCam(); readonly Grabber g; bool open;
    public Camera(ICameraInfo info) { if (info == null) throw new ArgumentNullException(); g = new Grabber(c); }
    public void Open() { open = true; } public void Open(int timeout, TimeoutHandling h) { open = true; }
    public void Close() { open = false; }
    public bool IsOpen => open; public bool IsConnected => true;
    public IParameterCollection Parameters => c; public IStreamGrabber StreamGrabber => g;
    public void Dispose() { open = false; }
  }
}
