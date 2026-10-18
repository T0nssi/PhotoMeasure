using System.IO.Compression;

namespace CameraBridge;

/// <summary>Small image helpers without external libraries: PNG/BMP writing, BMP/PPM reading,
/// Bayer demosaicing, downsampling and live statistics.</summary>
public static class ImageCodec
{
    // ---------------- PNG (RGB 8-bit) ----------------
    private static readonly uint[] CrcTable = MakeCrc();
    private static uint[] MakeCrc()
    {
        var t = new uint[256];
        for (uint n = 0; n < 256; n++) { uint c = n; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; t[n] = c; }
        return t;
    }
    private static uint Crc(uint crc, ReadOnlySpan<byte> b) { crc ^= 0xFFFFFFFF; foreach (var x in b) crc = CrcTable[(crc ^ x) & 0xFF] ^ (crc >> 8); return crc ^ 0xFFFFFFFF; }
    private static void BE(Span<byte> s, uint v) { s[0] = (byte)(v >> 24); s[1] = (byte)(v >> 16); s[2] = (byte)(v >> 8); s[3] = (byte)v; }
    private static void Chunk(Stream o, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> h = stackalloc byte[8]; BE(h, (uint)data.Length);
        for (int i = 0; i < 4; i++) h[4 + i] = (byte)type[i];
        o.Write(h);
        o.Write(data);
        uint c = Crc(0, h.Slice(4, 4)); c = Crc2(c, data);
        Span<byte> cb = stackalloc byte[4]; BE(cb, c); o.Write(cb);
    }
    // continue CRC over more data
    private static uint Crc2(uint crc, ReadOnlySpan<byte> b) { crc ^= 0xFFFFFFFF; foreach (var x in b) crc = CrcTable[(crc ^ x) & 0xFF] ^ (crc >> 8); return crc ^ 0xFFFFFFFF; }

    public static void WritePng(Stream o, byte[] rgb, int w, int h, int channels = 3)
    {
        o.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        var ihdr = new byte[13]; BE(ihdr, (uint)w); BE(ihdr.AsSpan(4), (uint)h);
        ihdr[8] = 8; ihdr[9] = (byte)(channels == 1 ? 0 : 2); ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
        Chunk(o, "IHDR", ihdr);
        int stride = w * channels;
        using var ms = new MemoryStream(stride * h / 2 + 1024);
        using (var z = new ZLibStream(ms, CompressionLevel.Fastest, true))
        {
            var line = new byte[stride + 1];
            line[0] = 1; // filter: Sub
            for (int y = 0; y < h; y++)
            {
                int o0 = y * stride;
                for (int i = 0; i < channels; i++) line[1 + i] = rgb[o0 + i];
                for (int i = channels; i < stride; i++) line[1 + i] = (byte)(rgb[o0 + i] - rgb[o0 + i - channels]);
                z.Write(line, 0, line.Length);
            }
        }
        var data = ms.GetBuffer().AsSpan(0, (int)ms.Length);
        const int max = 1 << 20; // IDAT chunks of 1 MB
        for (int p = 0; p < data.Length; p += max) Chunk(o, "IDAT", data.Slice(p, Math.Min(max, data.Length - p)));
        Chunk(o, "IEND", ReadOnlySpan<byte>.Empty);
    }
    public static byte[] Png(byte[] rgb, int w, int h) { using var ms = new MemoryStream(); WritePng(ms, rgb, w, h); return ms.ToArray(); }

    // ---------------- BMP (24-bit) ----------------
    public static byte[] Bmp(byte[] rgb, int w, int h)
    {
        int stride = (w * 3 + 3) & ~3, size = 54 + stride * h;
        var b = new byte[size];
        b[0] = (byte)'B'; b[1] = (byte)'M';
        BitConverter.TryWriteBytes(b.AsSpan(2), size);
        BitConverter.TryWriteBytes(b.AsSpan(10), 54);
        BitConverter.TryWriteBytes(b.AsSpan(14), 40);
        BitConverter.TryWriteBytes(b.AsSpan(18), w);
        BitConverter.TryWriteBytes(b.AsSpan(22), h);   // positive = bottom-up
        BitConverter.TryWriteBytes(b.AsSpan(26), (short)1);
        BitConverter.TryWriteBytes(b.AsSpan(28), (short)24);
        BitConverter.TryWriteBytes(b.AsSpan(34), stride * h);
        BitConverter.TryWriteBytes(b.AsSpan(38), 3780); BitConverter.TryWriteBytes(b.AsSpan(42), 3780);
        Parallel.For(0, h, y =>
        {
            int src = y * w * 3, dst = 54 + (h - 1 - y) * stride;
            for (int x = 0; x < w; x++, src += 3, dst += 3) { b[dst] = rgb[src + 2]; b[dst + 1] = rgb[src + 1]; b[dst + 2] = rgb[src]; }
        });
        return b;
    }

    /// <summary>Reads uncompressed 24/32-bit BMP or binary PPM (P6) into RGB. Returns null if not supported.</summary>
    public static (byte[] rgb, int w, int h)? ReadSimple(byte[] f)
    {
        if (f.Length > 33 && f[0] == 137 && f[1] == 'P' && f[2] == 'N' && f[3] == 'G') return ReadPng(f);
        if (f.Length > 54 && f[0] == 'B' && f[1] == 'M')
        {
            int off = BitConverter.ToInt32(f, 10), w = BitConverter.ToInt32(f, 18), hh = BitConverter.ToInt32(f, 22);
            int bpp = BitConverter.ToInt16(f, 28), comp = BitConverter.ToInt32(f, 30);
            if ((bpp != 24 && bpp != 32) || (comp != 0 && comp != 3)) return null;
            bool bottomUp = hh > 0; int h = Math.Abs(hh), bytes = bpp / 8, stride = (w * bytes + 3) & ~3;
            var rgb = new byte[w * h * 3];
            for (int y = 0; y < h; y++)
            {
                int src = off + (bottomUp ? h - 1 - y : y) * stride, dst = y * w * 3;
                for (int x = 0; x < w; x++, src += bytes, dst += 3) { rgb[dst] = f[src + 2]; rgb[dst + 1] = f[src + 1]; rgb[dst + 2] = f[src]; }
            }
            return (rgb, w, h);
        }
        if (f.Length > 10 && f[0] == 'P' && f[1] == '6')
        {
            int p = 2; int Next()
            {
                while (p < f.Length && (char.IsWhiteSpace((char)f[p]) || f[p] == '#')) { if (f[p] == '#') while (p < f.Length && f[p] != '\n') p++; else p++; }
                int v = 0; while (p < f.Length && f[p] >= '0' && f[p] <= '9') v = v * 10 + (f[p++] - '0'); return v;
            }
            int w = Next(), h = Next(), mx = Next(); p++;
            if (mx != 255 || f.Length - p < w * h * 3) return null;
            var rgb = new byte[w * h * 3]; Buffer.BlockCopy(f, p, rgb, 0, rgb.Length);
            return (rgb, w, h);
        }
        return null;
    }

    private static int BE32(byte[] b, int o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

    /// <summary>8-bit non-interlaced PNG (gray, RGB, gray+alpha, RGBA) to RGB.</summary>
    public static (byte[] rgb, int w, int h)? ReadPng(byte[] f)
    {
        int p = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0;
        using var idat = new MemoryStream();
        while (p + 8 <= f.Length)
        {
            int len = BE32(f, p); string type = System.Text.Encoding.ASCII.GetString(f, p + 4, 4);
            if (type == "IHDR") { w = BE32(f, p + 8); h = BE32(f, p + 12); depth = f[p + 16]; ctype = f[p + 17]; inter = f[p + 20]; }
            else if (type == "IDAT") idat.Write(f, p + 8, len);
            else if (type == "IEND") break;
            p += 12 + len;
        }
        int ch = ctype switch { 0 => 1, 2 => 3, 4 => 2, 6 => 4, _ => 0 };
        if (depth != 8 || ch == 0 || inter != 0 || w <= 0 || h <= 0) return null;
        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        int stride = w * ch; var cur = new byte[stride]; var prev = new byte[stride]; var rgb = new byte[w * h * 3];
        for (int y = 0; y < h; y++)
        {
            int ft = z.ReadByte(); if (ft < 0) return null;
            int got = 0; while (got < stride) { int n = z.Read(cur, got, stride - got); if (n <= 0) return null; got += n; }
            for (int i = 0; i < stride; i++)
            {
                int a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
                int add = ft switch
                {
                    1 => a, 2 => b, 3 => (a + b) >> 1,
                    4 => Paeth(a, b, c),
                    _ => 0,
                };
                cur[i] = (byte)(cur[i] + add);
            }
            for (int x = 0, d = y * w * 3; x < w; x++, d += 3)
            {
                int s = x * ch;
                if (ch < 3) { rgb[d] = rgb[d + 1] = rgb[d + 2] = cur[s]; }
                else { rgb[d] = cur[s]; rgb[d + 1] = cur[s + 1]; rgb[d + 2] = cur[s + 2]; }
            }
            (prev, cur) = (cur, prev);
        }
        return (rgb, w, h);
    }
    private static int Paeth(int a, int b, int c) { int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

    // ---------------- pixel format conversion (fallback when the pylon converter is not usable) ----------------
    /// <summary>Converts 8-bit Mono / Bayer / RGB / BGR raw data into RGB. Returns null for other formats.</summary>
    public static byte[] ToRgb(byte[] raw, int w, int h, string fmt, byte[] dest = null)
    {
        fmt = (fmt ?? "").Replace("PixelType_", "").Replace("PixelType.", "");
        var rgb = dest != null && dest.Length == w * h * 3 ? dest : new byte[w * h * 3];
        if (fmt.StartsWith("Mono8", StringComparison.OrdinalIgnoreCase))
        {
            if (raw.Length < w * h) return null;
            Parallel.For(0, h, y => { int s = y * w, d = s * 3; for (int x = 0; x < w; x++, d += 3) rgb[d] = rgb[d + 1] = rgb[d + 2] = raw[s + x]; });
            return rgb;
        }
        if (fmt.StartsWith("RGB8", StringComparison.OrdinalIgnoreCase)) { if (raw.Length < rgb.Length) return null; Buffer.BlockCopy(raw, 0, rgb, 0, rgb.Length); return rgb; }
        if (fmt.StartsWith("BGR8", StringComparison.OrdinalIgnoreCase))
        {
            if (raw.Length < rgb.Length) return null;
            Parallel.For(0, h, y => { int s = y * w * 3; for (int x = 0; x < w; x++, s += 3) { rgb[s] = raw[s + 2]; rgb[s + 1] = raw[s + 1]; rgb[s + 2] = raw[s]; } });
            return rgb;
        }
        string pat = fmt.StartsWith("BayerRG8", StringComparison.OrdinalIgnoreCase) ? "RGGB"
                   : fmt.StartsWith("BayerBG8", StringComparison.OrdinalIgnoreCase) ? "BGGR"
                   : fmt.StartsWith("BayerGR8", StringComparison.OrdinalIgnoreCase) ? "GRBG"
                   : fmt.StartsWith("BayerGB8", StringComparison.OrdinalIgnoreCase) ? "GBRG" : null;
        if (pat == null || raw.Length < w * h) return null;
        Demosaic(raw, w, h, pat, rgb);
        return rgb;
    }

    /// <summary>Bilinear Bayer demosaicing. pat = colours of the 2x2 cell (row 0: [0],[1]; row 1: [2],[3]).</summary>
    public static void Demosaic(byte[] raw, int w, int h, string pat, byte[] rgb)
    {
        int C(int x, int y) { char c = pat[((y & 1) << 1) | (x & 1)]; return c == 'R' ? 0 : c == 'G' ? 1 : 2; }
        int P(int x, int y) { x = x < 0 ? 1 : x >= w ? w - 2 : x; y = y < 0 ? 1 : y >= h ? h - 2 : y; return raw[y * w + x]; }
        Parallel.For(0, h, y =>
        {
            for (int x = 0; x < w; x++)
            {
                int c = C(x, y), d = (y * w + x) * 3, v = raw[y * w + x];
                int cross = (P(x - 1, y) + P(x + 1, y) + P(x, y - 1) + P(x, y + 1) + 2) >> 2;
                int diag = (P(x - 1, y - 1) + P(x + 1, y - 1) + P(x - 1, y + 1) + P(x + 1, y + 1) + 2) >> 2;
                int horiz = (P(x - 1, y) + P(x + 1, y) + 1) >> 1, vert = (P(x, y - 1) + P(x, y + 1) + 1) >> 1;
                if (c == 1)
                {
                    // green pixel: the colour left/right is the one in this row
                    int rowOther = C(x + 1, y); // 0 or 2
                    rgb[d + 1] = (byte)v;
                    rgb[d + rowOther] = (byte)horiz;
                    rgb[d + (2 - rowOther)] = (byte)vert;
                }
                else
                {
                    rgb[d + c] = (byte)v; rgb[d + 1] = (byte)cross; rgb[d + (2 - c)] = (byte)diag;
                }
            }
        });
    }

    // ---------------- live view helpers ----------------
    /// <summary>Box-filter downsample so the longest side is at most maxDim (integer factor).</summary>
    public static (byte[] rgb, int w, int h) Downsample(byte[] rgb, int w, int h, int maxDim)
    {
        int f = Math.Max(1, (int)Math.Ceiling(Math.Max(w, h) / (double)Math.Max(64, maxDim)));
        if (f == 1) return (rgb, w, h);
        int ow = w / f, oh = h / f; var o = new byte[ow * oh * 3]; int n = f * f;
        Parallel.For(0, oh, oy =>
        {
            for (int ox = 0; ox < ow; ox++)
            {
                int r = 0, g = 0, b = 0;
                for (int yy = 0; yy < f; yy++) { int s = ((oy * f + yy) * w + ox * f) * 3; for (int xx = 0; xx < f; xx++, s += 3) { r += rgb[s]; g += rgb[s + 1]; b += rgb[s + 2]; } }
                int d = (oy * ow + ox) * 3; o[d] = (byte)(r / n); o[d + 1] = (byte)(g / n); o[d + 2] = (byte)(b / n);
            }
        });
        return (o, ow, oh);
    }

    /// <summary>64-bin luminance histogram, % of saturated pixels and mean, from a (small) RGB image.</summary>
    public static (int[] hist, double satPct, double mean) Histogram(byte[] rgb, int w, int h)
    {
        var hist = new int[64]; long sat = 0, sum = 0; int n = w * h;
        for (int i = 0, s = 0; i < n; i++, s += 3)
        {
            int r = rgb[s], g = rgb[s + 1], b = rgb[s + 2];
            int y = (r * 77 + g * 150 + b * 29) >> 8; hist[y >> 2]++; sum += y;
            if (r >= 250 || g >= 250 || b >= 250) sat++;
        }
        return (hist, n > 0 ? 100.0 * sat / n : 0, n > 0 ? (double)sum / n : 0);
    }

    /// <summary>Sharpness of the image centre (mean squared Laplacian of green, 512x512 crop of the full image). Bigger = sharper.</summary>
    public static double Focus(byte[] rgb, int w, int h)
    {
        int cw = Math.Min(512, w - 2), ch = Math.Min(512, h - 2); if (cw < 8 || ch < 8) return 0;
        int x0 = (w - cw) / 2, y0 = (h - ch) / 2; double acc = 0;
        for (int y = y0 + 1; y < y0 + ch - 1; y++)
            for (int x = x0 + 1; x < x0 + cw - 1; x++)
            {
                int c = (y * w + x) * 3 + 1;
                int lap = 4 * rgb[c] - rgb[c - 3] - rgb[c + 3] - rgb[c - w * 3] - rgb[c + w * 3];
                acc += lap * lap;
            }
        return acc / ((cw - 2) * (ch - 2));
    }
}
