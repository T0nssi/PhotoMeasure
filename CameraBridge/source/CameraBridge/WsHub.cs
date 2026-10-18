using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CameraBridge;

/// <summary>WebSocket clients (browser tabs). Text = JSON events, binary = live frames:
/// 24-byte header "PMLV", width, height, frame index, channels (3), flags; then RGB bytes.</summary>
public sealed class WsHub
{
    private sealed class Client
    {
        public WebSocket Ws;
        public readonly SemaphoreSlim Lock = new(1, 1);
        public volatile bool Live;
        public int MaxDim = 1024;
        public double Fps = 8;
        public DateTime LastLive = DateTime.MinValue;
        public volatile bool Sending;
    }

    private readonly List<Client> _clients = new();
    private readonly Log _log;
    private static readonly JsonSerializerOptions J = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    public Action<bool> LiveChanged;

    public WsHub(Log log) { _log = log; }

    public bool AnyLive { get { lock (_clients) return _clients.Any(c => c.Live); } }
    public int Count { get { lock (_clients) return _clients.Count; } }
    /// <summary>Highest live frame rate any client asked for.</summary>
    public double LiveFps { get { lock (_clients) return _clients.Where(c => c.Live).Select(c => c.Fps).DefaultIfEmpty(0).Max(); } }

    public async Task Handle(WebSocket ws, Func<object> hello)
    {
        var c = new Client { Ws = ws };
        lock (_clients) _clients.Add(c);
        try
        {
            await SendText(c, JsonSerializer.Serialize(hello(), J));
            var buf = new byte[8192];
            while (ws.State == WebSocketState.Open)
            {
                var sb = new StringBuilder(); WebSocketReceiveResult r;
                do
                {
                    r = await ws.ReceiveAsync(buf, CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                } while (!r.EndOfMessage);
                if (r.MessageType == WebSocketMessageType.Close) break;
                try
                {
                    using var doc = JsonDocument.Parse(sb.ToString());
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var t) && t.GetString() == "live")
                    {
                        bool was = AnyLive;
                        c.Live = root.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True;
                        if (root.TryGetProperty("maxDim", out var md) && md.TryGetInt32(out var m)) c.MaxDim = Math.Clamp(m, 160, 4096);
                        if (root.TryGetProperty("fps", out var fp) && fp.TryGetDouble(out var f)) c.Fps = Math.Clamp(f, 0.5, 30);
                        if (was != AnyLive) LiveChanged?.Invoke(AnyLive);
                    }
                }
                catch (JsonException) { }
            }
        }
        catch (WebSocketException) { }
        catch (Exception e) { _log.Warn("websocket: " + e.Message); }
        finally
        {
            bool was = AnyLive;
            lock (_clients) _clients.Remove(c);
            if (was != AnyLive) LiveChanged?.Invoke(AnyLive);
            try { if (ws.State == WebSocketState.Open) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
        }
    }

    private static async Task SendText(Client c, string s)
    {
        await c.Lock.WaitAsync();
        try { if (c.Ws.State == WebSocketState.Open) await c.Ws.SendAsync(Encoding.UTF8.GetBytes(s), WebSocketMessageType.Text, true, CancellationToken.None); }
        catch { }
        finally { c.Lock.Release(); }
    }

    public void Broadcast(object msg)
    {
        var s = JsonSerializer.Serialize(msg, J);
        List<Client> list; lock (_clients) list = _clients.ToList();
        foreach (var c in list) _ = SendText(c, s);
    }

    /// <summary>True when at least one client is due for a new live frame.</summary>
    public bool LiveDue()
    {
        var now = DateTime.Now;
        lock (_clients) return _clients.Any(c => c.Live && !c.Sending && (now - c.LastLive).TotalMilliseconds >= 1000 / c.Fps);
    }

    /// <summary>Sends the frame (downsampled per client) to clients that are due. Slow clients skip frames.</summary>
    public void SendLive(Frame f)
    {
        var now = DateTime.Now;
        List<Client> due; lock (_clients) due = _clients.Where(c => c.Live && !c.Sending && (now - c.LastLive).TotalMilliseconds >= 1000 / c.Fps).ToList();
        if (due.Count == 0 || f.Rgb == null) return;
        var cache = new Dictionary<int, byte[]>();
        foreach (var c in due)
        {
            if (!cache.TryGetValue(c.MaxDim, out var msg))
            {
                var (rgb, w, h) = ImageCodec.Downsample(f.Rgb, f.W, f.H, c.MaxDim);
                msg = new byte[24 + rgb.Length];
                Encoding.ASCII.GetBytes("PMLV").CopyTo(msg, 0);
                BitConverter.TryWriteBytes(msg.AsSpan(4), w); BitConverter.TryWriteBytes(msg.AsSpan(8), h);
                BitConverter.TryWriteBytes(msg.AsSpan(12), (int)(f.Index & 0x7fffffff)); BitConverter.TryWriteBytes(msg.AsSpan(16), 3);
                BitConverter.TryWriteBytes(msg.AsSpan(20), f.W);   // full width, so the page knows the scale
                Buffer.BlockCopy(rgb, 0, msg, 24, rgb.Length);
                cache[c.MaxDim] = msg;
            }
            c.LastLive = now; c.Sending = true;
            var m = msg;
            _ = Task.Run(async () =>
            {
                await c.Lock.WaitAsync();
                try { if (c.Ws.State == WebSocketState.Open) await c.Ws.SendAsync(m, WebSocketMessageType.Binary, true, CancellationToken.None); }
                catch { }
                finally { c.Lock.Release(); c.Sending = false; }
            });
        }
    }
}
