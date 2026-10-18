namespace CameraBridge;

/// <summary>One camera found by a driver.</summary>
public sealed class CameraInfo
{
    public string Id { get; set; } = "";          // driver:serial, unique
    public string Driver { get; set; } = "";
    public string Model { get; set; } = "";
    public string Serial { get; set; } = "";
    public string Vendor { get; set; } = "";
    public string Interface { get; set; } = "";   // USB, GigE, Simulator
    public string FriendlyName { get; set; } = "";
    public string Name { get; set; } = "";        // user name from config
    public Dictionary<string, string> Props { get; set; } = new();
}

/// <summary>A camera setting as shown in the setup panel.</summary>
public sealed class FeatureInfo
{
    public string Name { get; set; } = "";
    public string Group { get; set; } = "";
    public string Label { get; set; } = "";
    public string Type { get; set; } = "";   // float, int, enum, bool, command, string
    public object Value { get; set; }
    public double? Min { get; set; }
    public double? Max { get; set; }
    public double? Inc { get; set; }
    public string Unit { get; set; } = "";
    public string[] Options { get; set; }
    public bool Readable { get; set; }
    public bool Writable { get; set; }
    public string Node { get; set; } = "";   // real node name used on this camera
}

/// <summary>One image from the camera. Rgb is null when the frame was only counted, not converted.</summary>
public sealed class Frame
{
    public int W, H;
    public byte[] Rgb;            // W*H*3, row-major, R G B
    public long Index;            // running number since the camera was opened
    public DateTime Time;
    public string PixelFormat = "";
    public double ConvertMs;      // time to convert the camera buffer to RGB
    public bool Failed;
    public string Error = "";
}

public interface ICameraDriver
{
    string Name { get; }
    bool Available { get; }
    string Error { get; }
    List<CameraInfo> Enumerate();
    ICameraDevice Open(CameraInfo info);
    object Diag();
}

public interface ICameraDevice : IDisposable
{
    CameraInfo Info { get; }
    bool IsConnected { get; }
    bool Acquiring { get; }
    /// <summary>Real node name for a canonical feature name, or null if the camera does not have it.</summary>
    FeatureInfo ReadFeature(FeatureDef def);
    void WriteFeature(FeatureDef def, object value);
    void Execute(string node);
    void StartAcquisition();
    void StopAcquisition();
    /// <summary>Next frame or null on timeout. convert=false: count only (no pixel conversion).
    /// keep=false: the RGB buffer is reused by the next call (live view only); keep=true: a new buffer that may be stored.</summary>
    Frame Retrieve(int timeoutMs, bool convert, bool keep = true);
    void SaveConfig(string path);
    void LoadConfig(string path);
}

/// <summary>Definition of a setting in the setup panel. Alts = node names tried in order (USB, then GigE).</summary>
public sealed record FeatureDef(string Name, string Group, string Label, string[] Alts, string Selector = null, string SelectorValue = null)
{
    public static FeatureDef F(string name, string group, string label, params string[] alts) =>
        new(name, group, label, alts.Length > 0 ? alts : new[] { name });
    public static FeatureDef Sel(string name, string group, string label, string node, string selector, string selValue) =>
        new(name, group, label, new[] { node }, selector, selValue);
}

public static class Features
{
    /// <summary>Settings offered in the Camera tab. Only those the connected camera has are shown.</summary>
    public static readonly FeatureDef[] All =
    {
        // Device information (read-only)
        FeatureDef.F("DeviceModelName", "Device", "Model"),
        FeatureDef.F("DeviceSerialNumber", "Device", "Serial number", "DeviceSerialNumber", "DeviceID"),
        FeatureDef.F("DeviceFirmwareVersion", "Device", "Firmware"),
        FeatureDef.F("DeviceTemperature", "Device", "Temperature (°C)", "DeviceTemperature", "TemperatureAbs"),
        FeatureDef.F("DeviceLinkSpeed", "Device", "Link speed (byte/s)"),
        FeatureDef.F("BslUSBSpeedMode", "Device", "USB speed"),
        // Exposure
        FeatureDef.F("ExposureAuto", "Exposure", "Exposure auto"),
        FeatureDef.F("ExposureTime", "Exposure", "Exposure time (µs)", "ExposureTime", "ExposureTimeAbs"),
        FeatureDef.F("AutoTargetBrightness", "Exposure", "Auto target brightness", "AutoTargetBrightness", "AutoTargetValue"),
        // Gain / level
        FeatureDef.F("GainAuto", "Gain", "Gain auto"),
        FeatureDef.F("Gain", "Gain", "Gain (dB)", "Gain", "GainRaw"),
        FeatureDef.F("BlackLevel", "Gain", "Black level", "BlackLevel", "BlackLevelRaw"),
        FeatureDef.F("GammaEnable", "Gain", "Gamma on"),
        FeatureDef.F("Gamma", "Gain", "Gamma"),
        // Colour
        FeatureDef.F("PixelFormat", "Colour", "Pixel format"),
        FeatureDef.F("BalanceWhiteAuto", "Colour", "White balance auto"),
        FeatureDef.Sel("BalanceRatio:Red", "Colour", "White balance red", "BalanceRatio", "BalanceRatioSelector", "Red"),
        FeatureDef.Sel("BalanceRatio:Green", "Colour", "White balance green", "BalanceRatio", "BalanceRatioSelector", "Green"),
        FeatureDef.Sel("BalanceRatio:Blue", "Colour", "White balance blue", "BalanceRatio", "BalanceRatioSelector", "Blue"),
        FeatureDef.F("LightSourcePreset", "Colour", "Light source preset"),
        // Image area
        FeatureDef.F("Width", "Image area", "Width (px)"),
        FeatureDef.F("Height", "Image area", "Height (px)"),
        FeatureDef.F("OffsetX", "Image area", "Offset X (px)"),
        FeatureDef.F("OffsetY", "Image area", "Offset Y (px)"),
        FeatureDef.F("CenterX", "Image area", "Center X"),
        FeatureDef.F("CenterY", "Image area", "Center Y"),
        FeatureDef.F("ReverseX", "Image area", "Mirror X (ReverseX)"),
        FeatureDef.F("ReverseY", "Image area", "Mirror Y (ReverseY)"),
        FeatureDef.F("BinningHorizontal", "Image area", "Binning horizontal"),
        FeatureDef.F("BinningVertical", "Image area", "Binning vertical"),
        FeatureDef.F("DecimationHorizontal", "Image area", "Decimation horizontal"),
        FeatureDef.F("DecimationVertical", "Image area", "Decimation vertical"),
        // Timing / trigger
        FeatureDef.F("ShutterMode", "Timing", "Shutter mode"),
        FeatureDef.F("AcquisitionFrameRateEnable", "Timing", "Limit frame rate"),
        FeatureDef.F("AcquisitionFrameRate", "Timing", "Frame rate limit (fps)", "AcquisitionFrameRate", "AcquisitionFrameRateAbs"),
        FeatureDef.F("ResultingFrameRate", "Timing", "Resulting frame rate (fps)", "ResultingFrameRate", "ResultingFrameRateAbs"),
        FeatureDef.Sel("TriggerMode", "Timing", "Trigger mode", "TriggerMode", "TriggerSelector", "FrameStart"),
        FeatureDef.Sel("TriggerSource", "Timing", "Trigger source", "TriggerSource", "TriggerSelector", "FrameStart"),
        FeatureDef.Sel("TriggerActivation", "Timing", "Trigger edge", "TriggerActivation", "TriggerSelector", "FrameStart"),
        FeatureDef.Sel("TriggerDelay", "Timing", "Trigger delay (µs)", "TriggerDelay", "TriggerSelector", "FrameStart"),
        // Output to a light controller
        FeatureDef.Sel("LineSource:Line2", "Output", "Line2 output signal", "LineSource", "LineSelector", "Line2"),
        FeatureDef.Sel("LineInverter:Line2", "Output", "Line2 inverted", "LineInverter", "LineSelector", "Line2"),
        // User sets
        FeatureDef.F("UserSetSelector", "User set", "User set"),
        FeatureDef.F("UserSetDefault", "User set", "Start-up set", "UserSetDefault", "UserSetDefaultSelector"),
    };

    public static FeatureDef Get(string name) =>
        All.FirstOrDefault(d => d.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
        ?? throw new BridgeException($"unknown setting {name}");

    /// <summary>Settings that are stored in a program's camera profile, in the order they must be written.</summary>
    public static readonly string[] ProfileOrder =
    {
        "PixelFormat", "BinningHorizontal", "BinningVertical", "DecimationHorizontal", "DecimationVertical",
        "ReverseX", "ReverseY", "Width", "Height", "OffsetX", "OffsetY", "CenterX", "CenterY", "ShutterMode",
        "AcquisitionFrameRateEnable", "AcquisitionFrameRate",
        "ExposureAuto", "ExposureTime", "GainAuto", "Gain", "BlackLevel", "GammaEnable", "Gamma",
        "BalanceWhiteAuto", "LightSourcePreset", "BalanceRatio:Red", "BalanceRatio:Green", "BalanceRatio:Blue",
        "TriggerMode", "TriggerSource", "TriggerActivation", "TriggerDelay", "LineSource:Line2", "LineInverter:Line2",
    };
}
