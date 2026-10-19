using System.Text.Json;
using System.Text.Json.Serialization;

namespace CameraBridge;

/// <summary>Settings in bridge.config.json (next to CameraBridge.dll). Relative paths are relative to that folder.</summary>
public sealed class BridgeConfig
{
    public int Port { get; set; } = 5090;
    /// <summary>Folder of the PhotoMeasure web app that the bridge serves.</summary>
    public string AppDir { get; set; } = "../app";
    /// <summary>Shots, recordings and logs.</summary>
    public string DataDir { get; set; } = "data";
    /// <summary>Also offer a simulated camera (frames from SimFolder). For training and tests.</summary>
    public bool Simulator { get; set; } = false;
    public string SimFolder { get; set; } = "sim";
    /// <summary>Optional full path of Basler.Pylon.dll if it is not found automatically.</summary>
    public string PylonAssembly { get; set; } = "";
    /// <summary>Optional full path of the Hikrobot MVS runtime (MvCameraControl.dll) if it is not found automatically.</summary>
    public string MvsLibrary { get; set; } = "";
    public bool OpenBrowser { get; set; } = true;
    /// <summary>Camera to connect at start (serial number); empty = first camera found.</summary>
    public string DefaultCamera { get; set; } = "";
    public bool AutoConnect { get; set; } = true;
    /// <summary>Grabbed images kept for re-measuring (data/shots), days.</summary>
    public int KeepShotDays { get; set; } = 7;
    public RecordConfig Record { get; set; } = new();
    /// <summary>Friendly names by camera serial number.</summary>
    public Dictionary<string, string> CameraNames { get; set; } = new();

    [JsonIgnore] public string BaseDir { get; set; } = AppContext.BaseDirectory;
    [JsonIgnore] public string FilePath { get; set; } = "";

    public string Abs(string p) => string.IsNullOrWhiteSpace(p) ? BaseDir : Path.GetFullPath(Path.IsPathRooted(p) ? p : Path.Combine(BaseDir, p));

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        PropertyNameCaseInsensitive = true,
    };

    public static BridgeConfig Load(string path)
    {
        BridgeConfig c = null;
        if (File.Exists(path))
        {
            try { c = JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(path), Json); }
            catch (Exception e) { Console.WriteLine($"bridge.config.json is not valid ({e.Message}); using defaults."); }
        }
        c ??= new BridgeConfig();
        c.Record ??= new RecordConfig();
        c.CameraNames ??= new Dictionary<string, string>();
        c.FilePath = path;
        c.BaseDir = Path.GetDirectoryName(path) ?? AppContext.BaseDirectory;
        return c;
    }

    private readonly object _saveLock = new();
    public void Save()
    {
        lock (_saveLock)
        {
            if (File.Exists(FilePath)) File.Copy(FilePath, FilePath + ".bak", true);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Json));
        }
    }
}

public sealed class RecordConfig
{
    /// <summary>Root folder for recorded images; one sub-folder per day. Empty = DataDir/images.</summary>
    public string Folder { get; set; } = "";
    /// <summary>png or bmp (lossless).</summary>
    public string Format { get; set; } = "png";
    /// <summary>Tokens: {program} {serial} {status} {camera} {user} {date} {time} {ms} {n}</summary>
    public string Pattern { get; set; } = "{program}_{serial}_{date}_{time}_{n}";
    /// <summary>off | all | ng : save automatically after each measured grab.</summary>
    public string AutoSave { get; set; } = "off";
    public bool SaveRaw { get; set; } = true;
    public bool SaveResult { get; set; } = true;
    /// <summary>Delete recorded day-folders older than this (0 = keep forever).</summary>
    public int KeepDays { get; set; } = 90;
}

/// <summary>Simple thread-safe log to console and data/logs/bridge-YYYY-MM-DD.log.</summary>
public sealed class Log
{
    private readonly string _dir;
    private readonly object _lock = new();
    private readonly LinkedList<string> _recent = new();
    public Log(string dir) { _dir = dir; try { Directory.CreateDirectory(dir); } catch { } }
    public void Info(string msg) => Write("INFO", msg);
    public void Warn(string msg) => Write("WARN", msg);
    public void Error(string msg) => Write("ERROR", msg);
    private void Write(string level, string msg)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {level,-5} {msg}";
        lock (_lock)
        {
            Console.WriteLine(line);
            _recent.AddLast(line); while (_recent.Count > 200) _recent.RemoveFirst();
            try { File.AppendAllText(Path.Combine(_dir, $"bridge-{DateTime.Now:yyyy-MM-dd}.log"), line + Environment.NewLine); } catch { }
        }
    }
    public string[] Recent(int n) { lock (_lock) return _recent.Skip(Math.Max(0, _recent.Count - n)).ToArray(); }
}

/// <summary>Error with a message meant for the user (HTTP 400).</summary>
public sealed class BridgeException : Exception
{
    public int Status { get; }
    public BridgeException(string msg, int status = 400) : base(msg) { Status = status; }
}
