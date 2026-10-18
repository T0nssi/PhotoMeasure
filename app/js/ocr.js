// OCR of marked text (offline). Tesseract.js runs in a Web Worker started from in-memory blobs, so it works
// when index.html is opened from a folder (file://). The 8 MB OCR pack is loaded only when OCR is first used.
"use strict";
window.PM = window.PM || {};
PM.ocr = (() => {
  let ready = null;
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("cannot load " + src)); document.head.appendChild(s); });

  /** Start the OCR engine once (lazy). */
  function ensure() {
    if (ready) return ready;
    ready = (async () => {
      if (!window.Tesseract) await loadScript("lib/tesseract.min.js");
      if (!window.PM_OCR_PACK) await loadScript("lib/ocr-pack.js");
      const P = window.PM_OCR_PACK;
      const url = (txt, type) => URL.createObjectURL(new Blob([txt], { type }));
      // One worker script = engine core + language data + worker. A worker started from a file:// page cannot
      // import other blobs or fetch files, so the core is pre-loaded, importScripts is a no-op and fetch of the
      // language file is answered from memory.
      const prelude = ";self.importScripts=function(){};" +
        "self.__eng=" + JSON.stringify(P.eng) + ";" +
        "self.__fetch=self.fetch;self.fetch=function(u,o){if(!/traineddata/.test(String(u)))return self.__fetch(u,o);" +
        "var b=atob(self.__eng),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);" +
        "return Promise.resolve(new Response(a,{status:200}));};\n";
      const workerPath = url(P.core + "\n" + prelude + P.worker, "application/javascript");
      const worker = await Tesseract.createWorker("eng", 1, { workerPath, corePath: "inline/tesseract-core-lstm.wasm.js", langPath: "inline", workerBlobURL: false, cacheMethod: "none", gzip: true, logger: m => window.PM_OCR_LOG && console.log("ocr", JSON.stringify(m)), errorHandler: e => console.warn("ocr", String(e)) });
      return worker;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  /**
   * Cut the text area out of the photo, straighten it and scale it so the text is ~48 px high.
   * box = {cx, cy, w, h, angle} in photo px (angle in radians).
   */
  function crop(photo, box, opt = {}) {
    const k = Math.max(0.5, Math.min(8, (opt.textPx || 48) / Math.max(4, box.h * 0.8)));
    const w = Math.max(4, Math.round(box.w * k)), h = Math.max(4, Math.round(box.h * k));
    const a = document.createElement("canvas"); a.width = w; a.height = h;
    const x = a.getContext("2d", { willReadFrequently: true });
    x.translate(w / 2, h / 2); x.rotate(-box.angle); x.scale(k, k); x.drawImage(photo.canvas, -box.cx, -box.cy);
    const c = a;
    return c;
  }
  /**
   * Prepare a crop for Tesseract (dark text on white): optional inversion, flat-field correction (divide by
   * the local background so uneven light disappears), optional Otsu threshold, white padding.
   */
  function prep(src, mode) {
    const W = src.width, H = src.height, n = W * H;
    const d0 = src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data, g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (d0[j] * 77 + d0[j + 1] * 150 + d0[j + 2] * 29) >> 8; g[i] = mode.inv ? 255 - v : v; }
    // local background = brighter local mean (text is the dark minority); integral image box filter
    const R = Math.max(6, Math.round(H * 0.6)), I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    const out = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ya = Math.max(0, y - R), yb = Math.min(H, y + R + 1), xa = Math.max(0, x - R), xb = Math.min(W, x + R + 1);
      const mean = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
      out[y * W + x] = Math.max(0, Math.min(255, 255 * g[y * W + x] / Math.max(8, mean * 1.08)));
    }
    // contrast stretch 2 % .. 98 %
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[out[i]]++;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const sc = 255 / Math.max(8, hi - lo);
    for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, (out[i] - lo) * sc));
    if (mode.bin) { // Otsu on the flattened image
      const h2 = new Float64Array(256); for (let i = 0; i < n; i++) h2[out[i]]++;
      let sum = 0; for (let v = 0; v < 256; v++) sum += v * h2[v];
      let sB = 0, wB = 0, best = 0, thr = 128;
      for (let v = 0; v < 256; v++) { wB += h2[v]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += v * h2[v]; const mB = sB / wB, mF = (sum - sB) / wF, bb = wB * wF * (mB - mF) ** 2; if (bb > best) { best = bb; thr = v; } }
      for (let i = 0; i < n; i++) out[i] = out[i] > thr ? 255 : 0;
    }
    const pad = Math.round(0.3 * H) + 10, c = document.createElement("canvas"); c.width = W + 2 * pad; c.height = H + 2 * pad;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    const id = x.createImageData(W, H);
    for (let i = 0, j = 0; i < n; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = out[i]; id.data[j + 3] = 255; }
    x.putImageData(id, pad, pad);
    return c;
  }

  // ---- character format: A = letter, 9 = digit, X = letter or digit, ? = any, other = that character ----
  const TO_LETTER = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "7": "Z", "8": "B", "4": "A" };
  const TO_DIGIT = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", T: "7", Z: "2", S: "5", G: "6", B: "8", A: "4", J: "3" };
  function whitelistOf(fmt) {
    if (!fmt) return "";
    let s = "";
    if (/[AX?]/.test(fmt)) s += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (/[9X?]/.test(fmt)) s += "0123456789";
    for (const c of fmt) if (!"A9X?".includes(c) && !s.includes(c)) s += c;
    return s;
  }
  /** Fit a reading to the format: fix look-alike characters; returns {text, ok}. */
  function applyFormat(raw, fmt) {
    if (!fmt) return { text: raw, ok: true };
    const t = raw.toUpperCase().replace(/\s+/g, "");
    if (t.length !== fmt.length) return { text: t, ok: false };
    let out = "", ok = true;
    for (let i = 0; i < fmt.length; i++) {
      const f = fmt[i]; let c = t[i];
      if (f === "A") { if (/[0-9]/.test(c)) c = TO_LETTER[c] || c; ok = ok && /[A-Z]/.test(c); }
      else if (f === "9") { if (/[A-Z]/.test(c)) c = TO_DIGIT[c] || c; ok = ok && /[0-9]/.test(c); }
      else if (f === "X") ok = ok && /[A-Z0-9]/.test(c);
      else if (f !== "?") ok = ok && c === f;
      out += c;
    }
    return { text: out, ok };
  }

  /**
   * Text from Tesseract symbols, without noise: symbols touching the crop border (edges of the part, the
   * 2D code) and symbols much smaller than the others are dropped. Returns {text, conf}.
   */
  function cleanText(data, W, H, multi) {
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      const syms = []; for (const w of l.words || []) for (const sy of w.symbols || []) syms.push(sy);
      lines.push(syms);
    }
    const all = lines.flat(); if (!all.length) return { text: (data.text || "").replace(/\s+/g, ""), conf: data.confidence || 0 };
    const hs = all.map(sy => sy.bbox.y1 - sy.bbox.y0).sort((a, b) => a - b), mh = hs[hs.length >> 1] || 1, m = 2;
    const keep = sy => sy.bbox.x0 > m && sy.bbox.x1 < W - m && sy.bbox.y0 > m && sy.bbox.y1 < H - m && (sy.bbox.y1 - sy.bbox.y0) > 0.45 * mh;
    const parts = lines.map(ls => ls.filter(keep)).filter(ls => ls.length);
    const kept = parts.flat();
    return { text: parts.map(ls => ls.map(sy => sy.text).join("")).join(multi ? " " : ""), conf: kept.length ? kept.reduce((s, sy) => s + sy.confidence, 0) / kept.length : 0 };
  }
  /**
   * Reading with stray characters removed from the ends (smudges, part edges): when the text is longer than
   * the format, or without a format, end characters with low confidence are dropped.
   */
  function trimEnds(data, fmt, multi) {
    const lines = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      const syms = []; for (const w of l.words || []) for (const sy of w.symbols || []) if (sy.text.trim()) syms.push({ t: sy.text, c: sy.confidence });
      if (syms.length) lines.push(syms);
    }
    if (!lines.length) return (data.text || "").split("\n").map(l => l.replace(/\s+/g, "")).filter(Boolean).join(multi ? " " : "");
    const out = lines.map(syms => {
      const s = syms.slice();
      if (fmt && !multi) { while (s.length > fmt.length) { if (s[0].c <= s[s.length - 1].c) s.shift(); else s.pop(); } }
      else { while (s.length > 1 && s[0].c < 55) s.shift(); while (s.length > 1 && s[s.length - 1].c < 55) s.pop(); }
      return s.map(x => x.t).join("");
    });
    return out.join(multi ? " " : "");
  }
  /** Best substring of a reading for the format: fits, fewest look-alike corrections, centred. */
  function bestFit(t, fmt) {
    t = t.toUpperCase();
    if (!fmt || t.length <= fmt.length) return applyFormat(t, fmt);
    let best = null;
    for (let i = 0; i + fmt.length <= t.length; i++) {
      const sub = t.slice(i, i + fmt.length), f = applyFormat(sub, fmt);
      let fixes = 0; for (let k = 0; k < sub.length; k++) if (sub[k] !== f.text[k]) fixes++;
      const off = Math.abs(i - (t.length - fmt.length) / 2);
      const sc = (f.ok ? 100 : 0) - 10 * fixes - off;
      if (!best || sc > best.sc) best = { ...f, sc };
    }
    return best;
  }

  /**
   * Read text in a box: tries normal / inverted, gray / local threshold and two text sizes, and keeps the
   * reading that fits the character format with the highest confidence.
   * opt: {format ("AAA9"...), chars (extra whitelist), lines (1 = single line), polarity ("auto" | "dark" | "light")}
   */
  async function read(photo, box, opt = {}) {
    const w = await ensure();
    const multi = (opt.lines || 1) > 1;
    await w.setParameters({ tessedit_pageseg_mode: multi ? "6" : "7", tessedit_char_whitelist: opt.chars || whitelistOf(opt.format), preserve_interword_spaces: "0" });
    const pol = opt.polarity || "auto", tries = [];
    for (const textPx of [48, 64]) for (const bin of [false, true]) for (const inv of pol === "auto" ? [false, true] : [pol === "light"]) tries.push({ textPx, bin, inv });
    let best = null;
    for (const m of tries) {
      const c = prep(crop(photo, box, { textPx: m.textPx }), m);
      const r = await w.recognize(c, {}, { text: true, blocks: true });
      const txt = trimEnds(r.data, opt.format, multi);
      if (!txt) continue;
      const f = bestFit(txt, opt.format), conf = r.data.confidence || 0, raw = { text: txt };
      const L = f.text.length, fl = opt.format ? opt.format.length : 0;
      const score = conf + (f.ok ? 200 : 0) + (fl ? -30 * Math.abs(L - fl) : 15 * Math.min(L, 8));
      if (!best || score > best.score) best = { text: f.text, raw: raw.text, conf, ok: f.ok, mode: m, canvas: c, score };
      if (best.ok && best.conf > 85) break;
    }
    return best ? { text: best.text, raw: best.raw, conf: best.conf, formatOk: best.ok, mode: best.mode, image: best.canvas.toDataURL("image/png") } : { text: "", conf: 0, formatOk: false };
  }

  return { ensure, read, crop, prep, applyFormat, whitelistOf };
})();
