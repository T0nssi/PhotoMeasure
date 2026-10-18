using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;
using CameraBridge;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;

// ---------------- PhotoMeasure Camera Bridge ----------------
// Serves the PhotoMeasure web app on http://127.0.0.1:<port> and gives it the camera:
// REST API under /api, WebSocket /ws for live view and events.

var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.5.0";
string cfgPath = Path.Combine(AppContext.BaseDirectory, "bridge.config.json");
for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--config") cfgPath = Path.GetFullPath(args[i + 1]);
var cfg = BridgeConfig.Load(cfgPath);
if (!File.Exists(cfgPath)) { try { cfg.Save(); } catch { } }
bool forceSim = args.Contains("--sim"), diagOnly = args.Contains("--diag");
for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--port" && int.TryParse(args[i + 1], out var p)) cfg.Port = p;
if (args.Contains("--no-browser")) cfg.OpenBrowser = false;

var url = $"http://127.0.0.1:{cfg.Port}/";
var log = new Log(Path.Combine(cfg.Abs(cfg.DataDir), "logs"));

void OpenBrowser()
{
    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception e) { log.Warn("cannot open the browser: " + e.Message); }
}

if (diagOnly)
{
    var pd = new PylonDriver(cfg, log);
    Console.WriteLine(JsonSerializer.Serialize(new { bridge = version, pylon = pd.Diag(), cameras = pd.Available ? pd.Enumerate() : new List<CameraInfo>() }, BridgeConfig.Json));
    return;
}

// already running? -> just open the page
try { using var probe = new TcpListener(IPAddress.Loopback, cfg.Port); probe.Start(); probe.Stop(); }
catch (SocketException)
{
    Console.WriteLine($"Port {cfg.Port} is in use: the Camera Bridge is probably already running. Opening {url}");
    if (cfg.OpenBrowser) OpenBrowser();
    return;
}

log.Info($"PhotoMeasure Camera Bridge {version} starting ({System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription})");
var storage = new Storage(cfg, log);
try { storage.Cleanup(); } catch (Exception e) { log.Warn("cleanup: " + e.Message); }
var hub = new WsHub(log);
var drivers = new List<ICameraDriver> { new PylonDriver(cfg, log) };
if (cfg.Simulator || forceSim) drivers.Add(new SimDriver(cfg.Abs(cfg.SimFolder)));
var cam = new CameraService(drivers, storage, hub, cfg, log);

var appDir = cfg.Abs(cfg.AppDir);
if (!File.Exists(Path.Combine(appDir, "index.html"))) log.Warn($"PhotoMeasure app not found in {appDir} (set \"appDir\" in bridge.config.json)");

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = Array.Empty<string>(), ContentRootPath = AppContext.BaseDirectory });
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(k =>
{
    k.Listen(IPAddress.Loopback, cfg.Port);          // this PC only
    k.Limits.MaxRequestBodySize = 300_000_000;
});
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 300_000_000);
var app = builder.Build();

// CORS: the app may also be opened as a file (file://) and call the bridge
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["Access-Control-Allow-Origin"] = "*";
    h["Access-Control-Allow-Headers"] = "*";
    h["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    h["Access-Control-Allow-Private-Network"] = "true";
    if (HttpMethods.IsOptions(ctx.Request.Method)) { ctx.Response.StatusCode = 204; return; }
    try { await next(); }
    catch (BridgeException e) { if (!ctx.Response.HasStarted) { ctx.Response.StatusCode = e.Status; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); } }
    catch (Exception e) when (ctx.Request.Path.StartsWithSegments("/api"))
    {
        log.Error($"{ctx.Request.Method} {ctx.Request.Path}: {e}");
        if (!ctx.Response.HasStarted) { ctx.Response.StatusCode = 500; await ctx.Response.WriteAsJsonAsync(new { error = e.Message }); }
    }
});

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
if (Directory.Exists(appDir))
{
    var fp = new PhysicalFileProvider(appDir);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fp });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = fp, ServeUnknownFileTypes = true, DefaultContentType = "application/octet-stream",
        OnPrepareResponse = c => c.Context.Response.Headers["Cache-Control"] = "no-cache",
    });
}

var J = BridgeConfig.Json;
async Task<T> Body<T>(HttpRequest r) where T : new()
{
    if (r.ContentLength == 0) return new T();
    try { return await JsonSerializer.DeserializeAsync<T>(r.Body, J) ?? new T(); }
    catch (JsonException e) { throw new BridgeException("bad JSON: " + e.Message); }
}
async Task<byte[]> Raw(HttpRequest r) { using var ms = new MemoryStream(); await r.Body.CopyToAsync(ms); return ms.ToArray(); }

object Status() => new
{
    app = "PhotoMeasure Camera Bridge", version, time = DateTime.Now.ToString("o"), url,
    runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
    drivers = drivers.Select(d => new { d.Name, d.Available, d.Error }),
    camera = cam.Status(),
    record = new { cfg.Record.Format, cfg.Record.Pattern, cfg.Record.AutoSave, cfg.Record.SaveRaw, cfg.Record.SaveResult, cfg.Record.KeepDays, root = storage.RecordRoot },
    keepShotDays = cfg.KeepShotDays, disk = storage.Disk(), clients = hub.Count,
};

// ---------------- API ----------------
app.MapGet("/api/status", () => Results.Json(Status(), J));
app.MapGet("/api/diag", () => Results.Json(new { bridge = version, config = cfgPath, drivers = drivers.Select(d => d.Diag()), log = log.Recent(80) }, J));

app.MapGet("/api/cameras", () => Results.Json(cam.ListCameras(), J));
app.MapPost("/api/cameras/open", async (HttpRequest r) => { var b = await Body<Dictionary<string, string>>(r); b.TryGetValue("id", out var id); return Results.Json(cam.Open(id), J); });
app.MapPost("/api/cameras/close", () => { cam.Close(); return Results.Json(cam.Status(), J); });
app.MapPost("/api/cameras/name", async (HttpRequest r) =>
{
    var b = await Body<Dictionary<string, string>>(r);
    if (!b.TryGetValue("serial", out var sn) || string.IsNullOrWhiteSpace(sn)) throw new BridgeException("serial missing");
    b.TryGetValue("name", out var name);
    if (string.IsNullOrWhiteSpace(name)) cfg.CameraNames.Remove(sn); else cfg.CameraNames[sn] = name.Trim();
    if (cam.Current?.Serial == sn) cam.Current.Name = name?.Trim() ?? "";
    cfg.Save();
    return Results.Json(new { ok = true }, J);
});

app.MapGet("/api/camera/features", () => Results.Json(cam.GetFeatures(), J));
app.MapPut("/api/camera/features", async (HttpRequest r) => Results.Json(cam.SetFeatures(await Body<Dictionary<string, JsonElement>>(r)), J));
app.MapPost("/api/camera/auto", async (HttpRequest r) => { var b = await Body<Dictionary<string, string>>(r); return Results.Json(await cam.AutoOnce(b.GetValueOrDefault("what", "")), J); });
app.MapPost("/api/camera/command", async (HttpRequest r) => { var b = await Body<Dictionary<string, string>>(r); return Results.Json(cam.Command(b.GetValueOrDefault("name", "")), J); });
app.MapPost("/api/camera/userset", async (HttpRequest r) => { var b = await Body<Dictionary<string, string>>(r); return Results.Json(cam.UserSet(b.GetValueOrDefault("action", ""), b.GetValueOrDefault("set", "")), J); });
app.MapGet("/api/camera/config", () =>
{
    var data = cam.SaveConfig();
    var name = $"{(cam.Current?.Model ?? "camera").Replace(' ', '_')}_{cam.Current?.Serial}_{DateTime.Now:yyyyMMdd_HHmm}.pfs";
    return Results.File(data, "application/octet-stream", name);
});
app.MapPost("/api/camera/config", async (HttpRequest r) => Results.Json(cam.LoadConfig(await Raw(r)), J));

app.MapPost("/api/grab", async () => { var s = await cam.Grab(); return Results.Json(s.ToJson(), J); });
app.MapPost("/api/timing", async (HttpRequest r) => { var b = await Body<TimingRow>(r); var p = storage.AppendTiming(b?.cols, b?.vals); return Results.Json(new { ok = true, file = p }, J); });
app.MapGet("/api/shots/{id}", async (string id) => { var (data, type) = await storage.ShotBytes(id); return Results.File(data, type, $"{id}{(type == "image/bmp" ? ".bmp" : ".png")}"); });

app.MapPost("/api/record", async (HttpRequest r) => Results.Json(await cam.Record(await Body<CameraService.RecordRequest>(r)), J));
app.MapPost("/api/record/stop", () => { cam.StopRecord(); return Results.Json(new { ok = true }, J); });
app.MapPost("/api/record/upload", async (HttpRequest r) =>
{
    var name = r.Query["name"].ToString();
    var path = storage.SaveUpload(await Raw(r), name, DateTime.Now);
    log.Info($"recorded {path}");
    return Results.Json(new { files = new[] { path } }, J);
});
app.MapGet("/api/record/list", (string day) => Results.Json(storage.List(day), J));
app.MapGet("/api/files/{day}/{name}", (string day, string name) =>
{
    var path = storage.RecordFile(day, Uri.UnescapeDataString(name));
    var ext = Path.GetExtension(path).ToLowerInvariant();
    return Results.File(path, ext == ".png" ? "image/png" : ext == ".bmp" ? "image/bmp" : "image/jpeg");
});

app.MapGet("/api/settings", () => Results.Json(new { record = cfg.Record, root = storage.RecordRoot, keepShotDays = cfg.KeepShotDays, defaultCamera = cfg.DefaultCamera, autoConnect = cfg.AutoConnect }, J));
app.MapPut("/api/settings", async (HttpRequest r) =>
{
    using var doc = await JsonDocument.ParseAsync(r.Body);
    var root = doc.RootElement;
    if (root.TryGetProperty("record", out var rec))
    {
        var n = rec.Deserialize<RecordConfig>(J) ?? new RecordConfig();
        n.Format = n.Format?.ToLowerInvariant() == "bmp" ? "bmp" : "png";
        n.AutoSave = n.AutoSave is "all" or "ng" ? n.AutoSave : "off";
        if (!string.IsNullOrWhiteSpace(n.Folder))
        {
            try { Directory.CreateDirectory(cfg.Abs(n.Folder)); } catch (Exception e) { throw new BridgeException($"cannot use folder {n.Folder}: {e.Message}"); }
        }
        cfg.Record = n;
    }
    if (root.TryGetProperty("keepShotDays", out var k) && k.TryGetInt32(out var kd)) cfg.KeepShotDays = Math.Clamp(kd, 1, 365);
    if (root.TryGetProperty("defaultCamera", out var dc)) cfg.DefaultCamera = dc.GetString() ?? "";
    if (root.TryGetProperty("autoConnect", out var ac) && ac.ValueKind is JsonValueKind.True or JsonValueKind.False) cfg.AutoConnect = ac.GetBoolean();
    cfg.Save();
    log.Info("settings saved");
    return Results.Json(new { ok = true, record = cfg.Record, root = storage.RecordRoot }, J);
});

app.Map("/ws", async (HttpContext ctx) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    await hub.Handle(ws, () => new { type = "hello", status = Status() });
});

app.Lifetime.ApplicationStopping.Register(() => { try { cam.Close(); } catch { } });

Console.WriteLine();
Console.WriteLine($"  PhotoMeasure Camera Bridge {version}");
Console.WriteLine($"  Open  {url}  in Chrome or Edge.  Close this window to stop the bridge.");
Console.WriteLine();
if (cfg.OpenBrowser) _ = Task.Run(async () => { await Task.Delay(800); OpenBrowser(); });
app.Run();
