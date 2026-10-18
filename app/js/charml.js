// Own character reader (trainable OCR), offline.
//  1. segment()   cuts the characters out of an OCR box (the same crop + flat-field as the built-in OCR)
//  2. normalise() makes each character a 32 x 32 image (ink = 255), the same in training and in reading
//  3. the character images are kept in this browser (IndexedDB "pm-train", store "chars"), with their label
//  4. train() fits a small neural network (32x32 -> hidden -> classes) in a Web Worker, with a train /
//     validation / test split, augmentation and early stopping; models are kept in store "models"
//  5. read() reads an OCR box with a trained model and the element's character format
"use strict";
window.PM = window.PM || {};
PM.charml = (() => {
  const N = 32, D = N * N;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", DIGITS = "0123456789";

  // ======================= storage (IndexedDB) =======================
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("pm-train", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("chars")) d.createObjectStore("chars", { keyPath: "id" });
        if (!d.objectStoreNames.contains("models")) d.createObjectStore("models", { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store); let out;
      const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("storage aborted (disk full?)"));
    });
  }
  const getAll = store => tx(store, "readonly", s => s.getAll());
  const putMany = (store, arr) => tx(store, "readwrite", s => { arr.forEach(x => s.put(x)); });
  const delMany = (store, ids) => tx(store, "readwrite", s => { ids.forEach(id => s.delete(id)); });

  const chars = { all: () => getAll("chars"), put: a => putMany("chars", a), del: ids => delMany("chars", ids) };
  // models: kept in memory too, so reading can find a model without waiting
  const MODELS = new Map();
  const modelsReady = (async () => { try { for (const m of await getAll("models")) MODELS.set(m.id, m); } catch (e) { console.warn("models", e); } })();
  const models = {
    ready: () => modelsReady,
    list: () => [...MODELS.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)),
    get: id => MODELS.get(id) || null,
    async put(m) { await putMany("models", [m]); MODELS.set(m.id, m); delete m._net; },
    async del(id) { await delMany("models", [id]); MODELS.delete(id); },
  };

  // ======================= small helpers =======================
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  const f32ToB64 = f => b64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  const b64ToF32 = s => { const u = unb64(s); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); };
  function grayOf(c) {
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }
  const median = a => { if (!a.length) return 0; const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };

  // ======================= segmentation =======================
  /**
   * Character boxes in an OCR box. The crop is straightened and scaled to ~48 px text (as the built-in OCR),
   * flat-field corrected and thresholded (Otsu). Specks and blobs with a long contact to the box border (part
   * edges, shadows) are removed; text lines come from the row profile, characters from the column profile
   * (gaps); for dot-peen marks the small gaps inside a character are joined; boxes much wider than the others
   * (touching characters) are split at the thinnest column.
   * opt: {polarity "auto"|"dark"|"light", inv (bool, from the OCR reading), lines}
   * Returns {boxes:[{x,y,w,h,line}], flat (canvas, dark text on white), W, H, inv}
   */
  function segment(photo, box, opt = {}) {
    const c = PM.ocr.crop(photo, box, { textPx: 48 * Math.max(1, opt.lines || 1) }); // ~48 px per text line
    let inv = opt.inv;
    if (inv == null) inv = opt.polarity === "light" ? true : opt.polarity === "dark" ? false : null;
    const tryInv = inv == null ? [false, true] : [inv];
    // polarity "auto": text is the minority, so the try with less ink wins (if it finds characters at all)
    const res = tryInv.map(iv => segWith(c, iv, opt));
    const withChars = res.filter(r => r.boxes.length);
    return (withChars.length ? withChars : res).sort((a, b) => a.inkFrac - b.inkFrac)[0];
  }
  function segWith(c, inv, opt) {
    const flat = PM.ocr.prep(c, { inv, bin: false }), bin = PM.ocr.prep(c, { inv, bin: true });
    const W = bin.width, H = bin.height, pad = Math.round((W - c.width) / 2), padY = Math.round((H - c.height) / 2);
    const gb = grayOf(bin), ink = new Uint8Array(W * H);
    let nInk = 0;
    for (let i = 0; i < ink.length; i++) if (gb[i] < 128) { ink[i] = 1; nInk++; }
    const inkFrac = nInk / Math.max(1, c.width * c.height);
    const empty = { boxes: [], flat, W, H, inv, inkFrac };
    // 1. connected blobs (8-neighbour): remove specks and blobs with a long contact to the box border
    //    (part edges, shadows); a character the box only just touches is kept
    const lab = new Int32Array(W * H), par = [0];
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!ink[i]) continue;
      let m = 0;
      const nb = [x > 0 ? lab[i - 1] : 0, y > 0 && x > 0 ? lab[i - W - 1] : 0, y > 0 ? lab[i - W] : 0, y > 0 && x < W - 1 ? lab[i - W + 1] : 0];
      for (const n of nb) if (n) { const r = find(n); if (!m) m = r; else if (r !== m) { if (r < m) { par[m] = r; m = r; } else par[r] = m; } }
      if (!m) { m = par.length; par.push(m); }
      lab[i] = m;
    }
    const x0i = pad, x1i = pad + c.width - 1, y0i = padY, y1i = padY + c.height - 1;
    const st = new Map();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!lab[i]) continue;
      const l = find(lab[i]); lab[i] = l;
      let q = st.get(l); if (!q) st.set(l, q = { n: 0, contact: 0, y0: y, y1: y });
      q.n++; if (y < q.y0) q.y0 = y; if (y > q.y1) q.y1 = y;
      if (x <= x0i + 1 || x >= x1i - 1 || y <= y0i + 1 || y >= y1i - 1) q.contact++;
    }
    const drop = new Set();
    for (const [l, q] of st) if (q.n < 6 || q.contact > 8) drop.add(l);
    for (let i = 0; i < ink.length; i++) if (ink[i] && drop.has(lab[i])) ink[i] = 0;
    const blobH = [...st].filter(([l]) => !drop.has(l)).map(([, q]) => q.y1 - q.y0 + 1);
    if (!blobH.length) return empty;
    // 2. text lines: row profile of the ink, rows joined over small gaps (dot-peen rows)
    const rows = new Float64Array(H); for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) n += ink[y * W + x]; rows[y] = n; }
    let runs = []; for (let y = 0; y < H; y++) if (rows[y] > 0) { const L = runs[runs.length - 1]; if (L && y - L.b <= 1) L.b = y; else runs.push({ a: y, b: y }); }
    const maxRun = Math.max(...runs.map(r => r.b - r.a + 1));
    for (let k = 1; k < runs.length;) { if (runs[k].a - runs[k - 1].b - 1 <= Math.max(2, 0.25 * maxRun)) { runs[k - 1].b = runs[k].b; runs.splice(k, 1); } else k++; }
    runs.forEach(r => { r.h = r.b - r.a + 1; r.ink = 0; for (let y = r.a; y <= r.b; y++) r.ink += rows[y]; });
    const hMax = Math.max(...runs.map(r => r.h));
    runs = runs.filter(r => r.h >= 0.4 * hMax);
    const maxLines = Math.max(1, opt.lines || 1);
    if (runs.length > maxLines) { runs.sort((a, b) => b.ink - a.ink); runs.length = maxLines; }
    runs.sort((a, b) => a.a - b.a);
    // 3. characters of a line: column profile; dot-peen (blobs much smaller than the line) joins small gaps
    const boxes = [];
    runs.forEach((R, li) => {
      const cols = new Float64Array(W);
      for (let y = R.a; y <= R.b; y++) for (let x = 0; x < W; x++) cols[x] += ink[y * W + x];
      const segs = []; for (let x = 0; x < W; x++) if (cols[x] > 0) { const L = segs[segs.length - 1]; if (L && x - L.b <= 1) L.b = x; else segs.push({ a: x, b: x }); }
      if (!segs.length) return;
      const hLine = R.h, inLine = blobH.filter(h => h <= hLine * 1.05), medBlob = median(inLine);
      if (medBlob < 0.45 * hLine && segs.length > 2) { // dotted characters: gaps inside a character are the small ones
        const gaps = []; for (let k = 1; k < segs.length; k++) gaps.push(segs[k].a - segs[k - 1].b - 1);
        const gs = gaps.slice().sort((a, b) => a - b);
        let best = null; for (let t = 1; t < gs.length; t++) { const lo = gs.slice(0, t), hi = gs.slice(t), m1 = lo.reduce((a, b) => a + b, 0) / lo.length, m2 = hi.reduce((a, b) => a + b, 0) / hi.length; const v = lo.reduce((a, b) => a + (b - m1) ** 2, 0) + hi.reduce((a, b) => a + (b - m2) ** 2, 0); if (m2 > 1.6 * m1 + 1 && (!best || v < best.v)) best = { v, thr: (gs[t - 1] + gs[t]) / 2 }; }
        if (best) for (let k = segs.length - 1; k > 0; k--) if (segs[k].a - segs[k - 1].b - 1 < best.thr) { segs[k - 1].b = segs[k].b; segs.splice(k, 1); }
      }
      const cand = segs.map(sg => {
        let Y0 = R.b, Y1 = R.a, n = 0;
        for (let y = R.a; y <= R.b; y++) for (let x = sg.a; x <= sg.b; x++) if (ink[y * W + x]) { n++; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y; }
        return { x: sg.a, y: Y0, w: sg.b - sg.a + 1, h: Y1 - Y0 + 1, ink: n, line: li };
      }).filter(b => b.ink >= 12 && b.h >= 0.5 * hLine);
      const mw = median(cand.map(b => b.w));
      // touching characters: a box much wider than the others is split at the thinnest columns
      for (const b of cand) {
        const k = mw > 0 && b.w > 1.6 * mw ? Math.round(b.w / mw) : 1;
        if (k <= 1) { boxes.push(b); continue; }
        let start = 0;
        for (let sI = 1; sI < k; sI++) {
          const c0 = Math.round(sI * b.w / k), r = Math.round(0.25 * b.w / k);
          let cut = c0; for (let x = Math.max(start + 2, c0 - r); x <= Math.min(b.w - 3, c0 + r); x++) if (cols[b.x + x] < cols[b.x + cut]) cut = x;
          if (cut - start >= 2) { boxes.push({ ...b, x: b.x + start, w: cut - start }); start = cut; }
        }
        boxes.push({ ...b, x: b.x + start, w: b.w - start });
      }
    });
    return { boxes, flat, W, H, inv, inkFrac };
  }

  // ======================= normalisation =======================
  /**
   * One character -> 32 x 32, ink = 255: background level removed, cropped to the ink, centred in a square
   * (aspect ratio kept), area-resampled. Same function for saving, training and reading.
   */
  function normaliseGray(g, W, H) {
    const ink = new Float32Array(W * H);
    for (let i = 0; i < ink.length; i++) ink[i] = 255 - g[i];
    const bg = median(ink);
    let mx = 0; for (let i = 0; i < ink.length; i++) { ink[i] = Math.max(0, ink[i] - bg); if (ink[i] > mx) mx = ink[i]; }
    const out = new Uint8Array(D); if (mx <= 0) return out;
    let X0 = W, X1 = -1, Y0 = H, Y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x] > 0.35 * mx) { if (x < X0) X0 = x; if (x > X1) X1 = x; if (y < Y0) Y0 = y; if (y > Y1) Y1 = y; }
    if (X1 < 0) return out;
    const cw = X1 - X0 + 1, ch = Y1 - Y0 + 1, s = Math.max(cw, ch) + 4, ox = X0 - (s - cw) / 2, oy = Y0 - (s - ch) / 2;
    const f = s / N, acc = new Float32Array(D);
    // area resampling: each output pixel = mean of its source square (sub-sampled 4 x 4)
    for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
        const x = Math.floor(ox + (u + (a + 0.5) / 4) * f), y = Math.floor(oy + (v + (b + 0.5) / 4) * f);
        if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) sum += ink[y * W + x];
      }
      acc[v * N + u] = sum / 16;
    }
    let m2 = 0; for (let i = 0; i < D; i++) if (acc[i] > m2) m2 = acc[i];
    for (let i = 0; i < D; i++) out[i] = Math.round(255 * acc[i] / Math.max(1e-6, m2));
    return out;
  }
  function charOf(seg, b) {
    const m = Math.max(2, Math.round(0.08 * b.h)), x = Math.max(0, b.x - m), y = Math.max(0, b.y - m), w = Math.min(seg.W - x, b.w + 2 * m), h = Math.min(seg.H - y, b.h + 2 * m);
    const d = seg.flat.getContext("2d", { willReadFrequently: true }).getImageData(x, y, w, h).data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j];
    return { img: normaliseGray(g, w, h), x, y, w, h };
  }
  function thumbOf(seg, r) {
    const k = 40 / r.h, c = document.createElement("canvas"); c.width = Math.max(4, Math.round(r.w * k)); c.height = 40;
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(seg.flat, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }
  /** A character image from a file (one character per image): dark-on-light or light-on-dark detected from the border. */
  async function fromImageFile(file) {
    const bm = await createImageBitmap(file), k = Math.min(1, 160 / Math.max(bm.width, bm.height));
    const c = document.createElement("canvas"); c.width = Math.max(4, Math.round(bm.width * k)); c.height = Math.max(4, Math.round(bm.height * k));
    c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
    const g = grayOf(c), W = c.width, H = c.height, bd = [];
    for (let x = 0; x < W; x++) { bd.push(g[x], g[(H - 1) * W + x]); } for (let y = 0; y < H; y++) { bd.push(g[y * W], g[y * W + W - 1]); }
    if (median(bd) < 128) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
    const t = document.createElement("canvas"), kt = 40 / H; t.width = Math.max(4, Math.round(W * kt)); t.height = 40;
    const tx2 = t.getContext("2d"), id = tx2.createImageData(W, H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) { id.data[j] = id.data[j + 1] = id.data[j + 2] = g[i]; id.data[j + 3] = 255; }
    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; tmp.getContext("2d").putImageData(id, 0, 0);
    tx2.drawImage(tmp, 0, 0, t.width, t.height);
    return { img: normaliseGray(g, W, H), thumb: t.toDataURL("image/png") };
  }
  /** 32 x 32 image (Uint8) as a small canvas, dark ink on white (for display). */
  function imgCanvas(img, scale = 2) {
    const c = document.createElement("canvas"); c.width = c.height = N * scale;
    const t = document.createElement("canvas"); t.width = t.height = N; const x = t.getContext("2d"), id = x.createImageData(N, N);
    for (let i = 0, j = 0; i < D; i++, j += 4) { const v = 255 - img[i]; id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255; }
    x.putImageData(id, 0, 0); const cx = c.getContext("2d"); cx.imageSmoothingEnabled = false; cx.drawImage(t, 0, 0, c.width, c.height);
    return c;
  }

  // ======================= save characters of a measured OCR box =======================
  /**
   * Character records of one OCR box. The label of each character comes from the reading when the number of
   * characters found equals the length of the reading, the format is met and the confidence is 60 % or more;
   * otherwise "?" (label it in the Training tab).
   * meta: {program, el, photo, serial, text, conf, formatOk, inv, polarity, lines}
   */
  function charsOf(photo, box, meta) {
    const seg = segment(photo, box, { polarity: meta.polarity, lines: meta.lines }); // own polarity test (the OCR may have read an inverted try)
    if (!seg || !seg.boxes.length) return [];
    const text = String(meta.text || "").replace(/\s+/g, "");
    // labels from the reading only when it is trustworthy: same number of characters, format met, confident;
    // otherwise a wrong or shifted reading would label characters wrongly
    const auto = text.length === seg.boxes.length && meta.formatOk !== false && (meta.conf == null || meta.conf >= 60);
    const time = new Date().toISOString();
    return seg.boxes.map((b, i) => {
      const r = charOf(seg, b);
      return { id: uid(), label: auto ? text[i] : "?", auto, verified: false, src: "measure", program: meta.program || "", el: meta.el || "", photo: meta.photo || "", serial: meta.serial || "", time, conf: meta.conf ?? null, pos: i, img: b64(r.img), thumb: thumbOf(seg, r) };
    });
  }

  // ======================= the network =======================
  function net(m) {
    if (m._net) return m._net;
    m._net = { W1: b64ToF32(m.W1), b1: b64ToF32(m.b1), W2: b64ToF32(m.W2), b2: b64ToF32(m.b2), H: m.hidden, K: m.classes.length };
    return m._net;
  }
  /** Class probabilities of one 32 x 32 image (Uint8, ink = 255). */
  function predict(m, img) {
    const n = net(m), H = n.H, K = n.K, h = new Float32Array(H), z = new Float32Array(K);
    const nz = []; for (let j = 0; j < D; j++) if (img[j]) nz.push(j);
    for (let i = 0; i < H; i++) { let s = n.b1[i]; const o = i * D; for (const j of nz) s += n.W1[o + j] * img[j] / 255; h[i] = s > 0 ? s : 0; }
    let mx = -Infinity;
    for (let k = 0; k < K; k++) { let s = n.b2[k]; const o = k * H; for (let i = 0; i < H; i++) s += n.W2[o + i] * h[i]; z[k] = s; if (s > mx) mx = s; }
    let sum = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - mx); sum += z[k]; }
    for (let k = 0; k < K; k++) z[k] /= sum;
    return z;
  }
  const allowOf = f => f === "A" ? c => LETTERS.includes(c) : f === "9" ? c => DIGITS.includes(c) : f === "X" ? c => LETTERS.includes(c) || DIGITS.includes(c) : f === "?" || f == null ? () => true : c => c === f;
  function bestOf(m, p, f) {
    const ok = allowOf(f); let bi = -1, bp = -1;
    for (let k = 0; k < p.length; k++) if (ok(m.classes[k]) && p[k] > bp) { bp = p[k]; bi = k; }
    return bi < 0 ? null : { c: m.classes[bi], p: bp };
  }

  /**
   * Read an OCR box with a trained model. Same result shape as PM.ocr.read.
   * opt: {format, lines, polarity}
   */
  async function read(photo, box, opt, modelId) {
    await modelsReady;
    const m = models.get(modelId);
    if (!m) throw new Error("trained reader not found on this PC (Training tab)");
    const seg = segment(photo, box, { polarity: opt.polarity, lines: opt.lines });
    if (!seg.boxes.length) return { text: "", conf: 0, formatOk: false };
    const P = seg.boxes.map(b => predict(m, charOf(seg, b).img));
    const fmt = (opt.lines || 1) > 1 ? "" : (opt.format || "");
    let idx = P.map((_, i) => i);
    if (fmt && P.length > fmt.length) { // extra blobs (smudges, part edges): keep the window that fits the format best
      let bs = -Infinity, b0 = 0;
      for (let s = 0; s + fmt.length <= P.length; s++) {
        let sc = 0; for (let i = 0; i < fmt.length; i++) { const r = bestOf(m, P[s + i], fmt[i]); sc += Math.log(Math.max(1e-6, r ? r.p : 0)); }
        if (sc > bs) { bs = sc; b0 = s; }
      }
      idx = idx.slice(b0, b0 + fmt.length);
    }
    let text = "", raw = "", ps = [], ok = !fmt || idx.length === fmt.length, line = seg.boxes[idx[0]]?.line ?? 0;
    idx.forEach((i, n) => {
      if (seg.boxes[i].line !== line) { text += " "; raw += " "; line = seg.boxes[i].line; }
      const any = bestOf(m, P[i], "?"), r = bestOf(m, P[i], fmt ? fmt[n] : "?");
      raw += any.c;
      if (!r) { ok = false; text += any.c; ps.push(any.p); } else { text += r.c; ps.push(r.p); }
    });
    const conf = 100 * ps.reduce((s, v) => s + v, 0) / Math.max(1, ps.length);
    // picture: the cleaned crop with the character boxes and the result
    const c = document.createElement("canvas"); c.width = seg.W; c.height = seg.H; const x = c.getContext("2d");
    x.drawImage(seg.flat, 0, 0); x.lineWidth = 1.5; x.font = `${Math.round(0.28 * seg.H)}px sans-serif`;
    let tk = 0;
    idx.forEach((i, n) => { const b = seg.boxes[i]; x.strokeStyle = ps[n] < 0.6 ? "#e03030" : "#18a058"; x.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3); x.fillStyle = x.strokeStyle; const ch = text.replace(/ /g, "")[tk++] || ""; x.fillText(ch, b.x, Math.max(10, b.y - 4)); });
    return { text, raw, conf, formatOk: ok, mode: { reader: m.name, inv: seg.inv }, image: c.toDataURL("image/png"), chars: idx.map((i, n) => ({ p: ps[n] })) };
  }

  // ======================= training (Web Worker) =======================
  function workerMain() {
    // ---- runs inside the worker ----
    const N = 32, D = N * N;
    let seed = 1; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    function augment(src, dst) { // small rotation, scale, shift, stroke contrast, noise
      const a = (rnd() - 0.5) * 12 * Math.PI / 180, s = 0.9 + rnd() * 0.2, dx = (rnd() - 0.5) * 4, dy = (rnd() - 0.5) * 4, ca = Math.cos(a) / s, sa = Math.sin(a) / s, g = 0.75 + rnd() * 0.5, nz = rnd() * 0.06;
      for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
        const xu = u - 15.5 - dx, yv = v - 15.5 - dy, x = ca * xu + sa * yv + 15.5, y = -sa * xu + ca * yv + 15.5;
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= N || yy >= N) ? 0 : src[yy * N + xx];
        let val = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
        val = Math.min(1, val * g) + (nz ? gauss() * nz : 0);
        dst[v * N + u] = val < 0 ? 0 : val > 1 ? 1 : val;
      }
    }
    onmessage = e => {
      const q = e.data;
      try {
        seed = q.seed || 1;
        const X = q.X, y = q.y, split = q.split, K = q.K, H = q.hidden, n = y.length;
        const idx = s => { const a = []; for (let i = 0; i < n; i++) if (split[i] === s) a.push(i); return a; };
        const tr = idx(0), va = idx(1), te = idx(2);
        const W1 = new Float32Array(H * D), b1 = new Float32Array(H), W2 = new Float32Array(K * H), b2 = new Float32Array(K);
        const s1 = Math.sqrt(2 / D), s2 = Math.sqrt(2 / H);
        for (let i = 0; i < W1.length; i++) W1[i] = gauss() * s1; for (let i = 0; i < W2.length; i++) W2[i] = gauss() * s2;
        const P = [W1, b1, W2, b2], M = P.map(p => new Float32Array(p.length)), V = P.map(p => new Float32Array(p.length)), G = P.map(p => new Float32Array(p.length));
        const lr = q.lr || 1e-3, wd = 1e-4, B = 32, b1a = 0.9, b2a = 0.999; let step = 0;
        const x = new Float32Array(D), hp = new Float32Array(H), h = new Float32Array(H), z = new Float32Array(K), dh = new Float32Array(H);
        const nzs = new Int32Array(D);
        const fwd = xx => {
          let m = 0; for (let j = 0; j < D; j++) if (xx[j] > 0) nzs[m++] = j;
          for (let i = 0; i < H; i++) { let s = b1[i]; const o = i * D; for (let t = 0; t < m; t++) { const j = nzs[t]; s += W1[o + j] * xx[j]; } hp[i] = s; h[i] = s > 0 ? s : 0; }
          let mx = -Infinity; for (let k = 0; k < K; k++) { let s = b2[k]; const o = k * H; for (let i = 0; i < H; i++) s += W2[o + i] * h[i]; z[k] = s; if (s > mx) mx = s; }
          let sum = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - mx); sum += z[k]; } for (let k = 0; k < K; k++) z[k] /= sum;
          return m;
        };
        const row = i => X.subarray(i * D, i * D + D);
        const evalSet = (set, wantPred) => { let ok = 0, loss = 0; const pred = wantPred ? new Int32Array(set.length) : null; set.forEach((i, t) => { const r = row(i); for (let j = 0; j < D; j++) x[j] = r[j]; fwd(x); let bk = 0; for (let k = 1; k < K; k++) if (z[k] > z[bk]) bk = k; if (bk === y[i]) ok++; loss -= Math.log(Math.max(1e-9, z[y[i]])); if (pred) pred[t] = bk; }); return { acc: set.length ? ok / set.length : null, loss: set.length ? loss / set.length : null, pred }; };
        let best = { val: -1, ep: 0, P: P.map(p => p.slice()) }, hist = [], patience = 0;
        const t0 = Date.now();
        for (let ep = 1; ep <= q.epochs; ep++) {
          for (let i = tr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = tr[i]; tr[i] = tr[j]; tr[j] = t; }
          let lossSum = 0;
          for (let b0 = 0; b0 < tr.length; b0 += B) {
            G.forEach(g => g.fill(0)); const bn = Math.min(B, tr.length - b0);
            for (let t = 0; t < bn; t++) {
              const i = tr[b0 + t], r = row(i);
              if (q.aug) augment(r, x); else for (let j = 0; j < D; j++) x[j] = r[j];
              const m = fwd(x); lossSum -= Math.log(Math.max(1e-9, z[y[i]]));
              z[y[i]] -= 1; // dz
              dh.fill(0);
              for (let k = 0; k < K; k++) { const dz = z[k]; if (!dz) continue; G[3][k] += dz; const o = k * H; for (let u = 0; u < H; u++) { G[2][o + u] += dz * h[u]; dh[u] += W2[o + u] * dz; } }
              for (let u = 0; u < H; u++) { if (hp[u] <= 0) continue; const d = dh[u]; G[1][u] += d; const o = u * D; for (let s = 0; s < m; s++) { const j = nzs[s]; G[0][o + j] += d * x[j]; } }
            }
            step++;
            const c1 = 1 - Math.pow(b1a, step), c2 = 1 - Math.pow(b2a, step);
            for (let p = 0; p < 4; p++) { const W = P[p], g = G[p], mm = M[p], vv = V[p], decay = p % 2 === 0 ? wd : 0; for (let i = 0; i < W.length; i++) { const gi = g[i] / bn + decay * W[i]; mm[i] = b1a * mm[i] + (1 - b1a) * gi; vv[i] = b2a * vv[i] + (1 - b2a) * gi * gi; W[i] -= lr * (mm[i] / c1) / (Math.sqrt(vv[i] / c2) + 1e-8); } }
          }
          const trA = evalSet(tr.length > 1500 ? tr.slice(0, 1500) : tr), vaA = evalSet(va);
          const rec = { epoch: ep, train: trA.acc, val: vaA.acc, loss: lossSum / Math.max(1, tr.length), valLoss: vaA.loss, ms: Date.now() - t0 };
          hist.push(rec); postMessage({ type: "epoch", rec, epochs: q.epochs });
          const score = vaA.acc != null ? vaA.acc - 1e-4 * vaA.loss : trA.acc;
          if (score > best.val) { best = { val: score, ep, P: P.map(p => p.slice()) }; patience = 0; } else if (++patience >= (q.patience || 12)) break;
        }
        best.P.forEach((p, i) => P[i].set(p));
        const teR = evalSet(te, true), vaR = evalSet(va), trR = evalSet(tr);
        const cm = new Int32Array(K * K); te.forEach((i, t) => { cm[y[i] * K + teR.pred[t]]++; });
        postMessage({ type: "done", W1, b1, W2, b2, hist, bestEpoch: best.ep, trainAcc: trR.acc, valAcc: vaR.acc, testAcc: teR.acc, cm, testIdx: Int32Array.from(te), testPred: teR.pred, ms: Date.now() - t0 });
      } catch (err) { postMessage({ type: "error", message: String(err && err.message || err) }); }
    };
  }
  let worker = null;
  function stop() { if (worker) { worker.terminate(); worker = null; } }
  /**
   * Train a model from character records. opt: {name, hidden, epochs, aug, minPerClass, seed, onEpoch}
   * Split per class: 70 % training, 15 % validation, 15 % test (fixed by the seed).
   */
  function train(recs, opt = {}) {
    stop();
    const seed = opt.seed || 7;
    let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const by = new Map(); for (const r of recs) { if (!r.label || r.label === "?") continue; (by.get(r.label) || by.set(r.label, []).get(r.label)).push(r); }
    const minN = opt.minPerClass || 5;
    const classes = [...by.keys()].filter(k => by.get(k).length >= minN).sort();
    const skipped = [...by.keys()].filter(k => by.get(k).length < minN).map(k => `${k} (${by.get(k).length})`);
    if (classes.length < 2) return Promise.reject(new Error(`need at least 2 characters with ${minN} or more images each`));
    const use = [], split = [];
    for (const c of classes) {
      const a = by.get(c).slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      const nTe = Math.max(1, Math.round(0.15 * a.length)), nVa = Math.max(1, Math.round(0.15 * a.length));
      a.forEach((r, i) => { use.push(r); split.push(i < nTe ? 2 : i < nTe + nVa ? 1 : 0); });
    }
    const n = use.length, X = new Float32Array(n * D), y = new Int32Array(n);
    use.forEach((r, i) => { const u = unb64(r.img); for (let j = 0; j < D; j++) X[i * D + j] = u[j] / 255; y[i] = classes.indexOf(r.label); });
    const src = "(" + workerMain.toString() + ")();";
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
    const hidden = opt.hidden || 128, epochs = opt.epochs || 40;
    return new Promise((res, rej) => {
      worker.onerror = e => { stop(); rej(new Error(e.message || "training failed")); };
      worker.onmessage = e => {
        const q = e.data;
        if (q.type === "epoch") { try { opt.onEpoch && opt.onEpoch(q.rec, q.epochs); } catch (x) { console.error(x); } return; }
        stop();
        if (q.type === "error") { rej(new Error(q.message)); return; }
        const K = classes.length, pairs = [];
        for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) if (a !== b && q.cm[a * K + b]) pairs.push({ t: classes[a], p: classes[b], n: q.cm[a * K + b] });
        pairs.sort((a, b) => b.n - a.n);
        const mistakes = []; q.testIdx.forEach((i, t) => { if (q.testPred[t] !== y[i]) mistakes.push({ id: use[i].id, label: use[i].label, read: classes[q.testPred[t]] }); });
        const counts = {}; classes.forEach(c => { counts[c] = by.get(c).length; });
        const m = {
          id: uid(), name: opt.name || "Reader " + new Date().toLocaleDateString(), date: new Date().toISOString(), by: opt.by || "",
          classes, hidden, input: N, W1: f32ToB64(q.W1), b1: f32ToB64(q.b1), W2: f32ToB64(q.W2), b2: f32ToB64(q.b2),
          n, nTrain: split.filter(v => v === 0).length, nVal: split.filter(v => v === 1).length, nTest: split.filter(v => v === 2).length, counts, skipped,
          trainAcc: q.trainAcc, valAcc: q.valAcc, testAcc: q.testAcc, bestEpoch: q.bestEpoch, hist: q.hist, pairs: pairs.slice(0, 12), mistakes: mistakes.slice(0, 60),
          settings: { epochs, aug: !!opt.aug, minPerClass: minN, seed, verifiedOnly: !!opt.verifiedOnly }, ms: q.ms,
        };
        res(m);
      };
      worker.postMessage({ X, y, split: Int8Array.from(split), K: classes.length, hidden, epochs, aug: opt.aug !== false, seed, patience: opt.patience || 12 }, [X.buffer]);
    });
  }
  /** Accuracy of a model on records with labels (e.g. new photos). */
  function evaluate(m, recs) {
    let ok = 0, n = 0; const wrong = [];
    for (const r of recs) { if (!r.label || r.label === "?" || !m.classes.includes(r.label)) continue; const p = predict(m, unb64(r.img)); let bk = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[bk]) bk = k; n++; if (m.classes[bk] === r.label) ok++; else wrong.push({ id: r.id, label: r.label, read: m.classes[bk], p: p[bk] }); }
    return { n, ok, acc: n ? ok / n : null, wrong };
  }
  /** Predicted class of one stored record. */
  function classify(m, rec) { const p = predict(m, unb64(rec.img)); let bk = 0; for (let k = 1; k < p.length; k++) if (p[k] > p[bk]) bk = k; return { c: m.classes[bk], p: p[bk] }; }

  return { N, chars, models, segment, charOf, charsOf, normaliseGray, fromImageFile, imgCanvas, predict, classify, read, train, stop, evaluate, b64, unb64, uid };
})();
