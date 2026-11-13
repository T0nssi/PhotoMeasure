// Vision: image loading, circle candidates (OpenCV.js), sub-pixel edge scans (pure JS), DataMatrix (ZXing).
"use strict";
window.PM = window.PM || {};
PM.vision = (() => {
  const G = () => PM.geom;
  let cvReady = null;

  /** Resolve when OpenCV.js runtime is initialised. */
  function whenCv() {
    // Note: the Emscripten module object is a "thenable"; never resolve a Promise with it directly
    // (the promise would try to adopt it forever). Resolve with a box and strip .then once ready.
    if (cvReady) return cvReady;
    cvReady = new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function poll() {
        const c = window.cv;
        if (c && c.Mat) { if (typeof c.then === "function") { try { delete c.then; } catch (e) { c.then = undefined; } } return resolve({ cv: c }); }
        if (Date.now() - t0 > 90000) return reject(new Error("OpenCV.js did not load"));
        setTimeout(poll, 50);
      })();
    }).then(b => b.cv);
    return cvReady;
  }

  /** Default image-processing settings (stored per part program in t.proc). */
  function defaultProc() {
    return {
      channel: "gray",      // gray | red | green | blue | value | saturation
      brightness: 0,        // -100 .. +100
      contrast: 1,          // 0.2 .. 4
      gamma: 1,             // 0.3 .. 3
      normalize: false,     // stretch 1 %..99 % of the histogram to 0..255
      invert: false,
      matchMaster: false,   // after alignment, match brightness/contrast of the part area to the master
      det: { workSize: 1000, blur: 5, block1: 31, block2: 61, C: 8, canny1: 30, canny2: 90, minCirc: 0.75, minAxis: 0.8, minR: 4, maxRFrac: 6 },
      ref: { inner: 0.6, outer: 1.4, thr: 8, rays: 90 },
    };
  }
  /** Merge saved/partial settings over the defaults. */
  function procOf(p) {
    const d = defaultProc();
    if (!p) return d;
    return { ...d, ...p, det: { ...d.det, ...(p.det || {}) }, ref: { ...d.ref, ...(p.ref || {}) } };
  }

  /**
   * Load a File/Blob into a photo object: full-res canvas (EXIF orientation applied by the browser),
   * RGBA pixels, processed gray (see makeGray), EXIF date.
   */
  async function loadPhoto(file, maxDim = 4096, proc = null, adj = null) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    let w = bmp.width, h = bmp.height, k = 1;
    if (Math.max(w, h) > maxDim) { k = maxDim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    let exifDate = null, exifInfo = {};
    try {
      if (window.exifr) {
        const ex = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "Make", "Model"]);
        if (ex) { exifDate = ex.DateTimeOriginal || ex.CreateDate || null; exifInfo = { make: ex.Make, model: ex.Model }; }
      }
    } catch (e) { /* no EXIF */ }
    const photo = {
      name: file.name || "photo", size: file.size || 0, w, h, canvas, loadScale: k,
      date: exifDate ? new Date(exifDate) : (file.lastModified ? new Date(file.lastModified) : new Date()),
      dateSource: exifDate ? "EXIF" : "file",
      camera: [exifInfo.make, exifInfo.model].filter(Boolean).join(" "),
      rgba: ctx.getImageData(0, 0, w, h).data,
    };
    makeGray(photo, proc, adj);
    return photo;
  }

  /**
   * Build the gray image used by every detection step from the RGBA pixels:
   * colour channel -> gamma -> contrast/brightness -> optional histogram stretch -> optional invert.
   * adj = per-photo correction {brightness, contrast, gamma} applied on top of the program settings.
   */
  function makeGray(photo, proc, adj) {
    const P = procOf(proc), A = adj || {};
    const d = photo.rgba, n = photo.w * photo.h, raw = new Uint8Array(n), ch = P.channel;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = d[j], g = d[j + 1], b = d[j + 2];
      let v;
      if (ch === "red") v = r; else if (ch === "green") v = g; else if (ch === "blue") v = b;
      else if (ch === "value") v = r > g ? (r > b ? r : b) : (g > b ? g : b);
      else if (ch === "saturation") { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); v = mx ? Math.round(255 * (mx - mn) / mx) : 0; }
      else v = (r * 77 + g * 150 + b * 29) >> 8;
      raw[i] = v;
    }
    const gam = (P.gamma || 1) * (A.gamma || 1), con = (P.contrast ?? 1) * (A.contrast ?? 1), bri = 2.55 * ((P.brightness || 0) + (A.brightness || 0));
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let x = 255 * Math.pow(v / 255, 1 / gam);
      x = (x - 128) * con + 128 + bri;
      lut[v] = x < 0 ? 0 : x > 255 ? 255 : Math.round(x);
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = lut[raw[i]];
    if (P.normalize) {
      const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[out[i]]++;
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
      acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
      if (hi > lo + 4) { const l2 = new Uint8Array(256); for (let v = 0; v < 256; v++) l2[v] = Math.max(0, Math.min(255, Math.round((v - lo) * 255 / (hi - lo)))); for (let i = 0; i < n; i++) out[i] = l2[out[i]]; }
    }
    if (P.invert) for (let i = 0; i < n; i++) out[i] = 255 - out[i];
    photo.gray = { w: photo.w, h: photo.h, data: out };
    photo.graySmall = shrink(photo.gray, 4);
    photo.procKey = JSON.stringify([P, A]);
    return photo.gray;
  }

  /** Box-average downscale by an integer factor (fast coarse matching). */
  function shrink(gray, f) {
    const w = Math.floor(gray.w / f), h = Math.floor(gray.h / f), out = new Uint8Array(w * h), src = gray.data, f2 = f * f;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) { const row = (y * f + dy) * gray.w + x * f; for (let dx = 0; dx < f; dx++) s += src[row + dx]; }
      out[y * w + x] = s / f2;
    }
    return { w, h, data: out, f };
  }

  /** Gray image as a canvas (to show what the detector sees). */
  function grayCanvas(gray, maxDim = 1600) {
    const k = Math.min(1, maxDim / Math.max(gray.w, gray.h)), w = Math.round(gray.w * k), h = Math.round(gray.h * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"), id = x.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const v = gray.data[Math.min(gray.h - 1, Math.floor(y / k)) * gray.w + Math.min(gray.w - 1, Math.floor(xx / k))], j = (y * w + xx) * 4;
      id.data[j] = id.data[j + 1] = id.data[j + 2] = v; id.data[j + 3] = 255;
    }
    x.putImageData(id, 0, 0); c.k = k;
    return c;
  }

  /**
   * Appearance of a region given as a px polygon sampler: brightness (mean luminance), contrast (std),
   * mean colour (RGB + CIE Lab) and sharpness. pts = list of px sample points.
   */
  function appearance(photo, pts) {
    const d = photo.rgba, w = photo.w, h = photo.h;
    let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
    for (const p of pts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2], L = 0.299 * r + 0.587 * g + 0.114 * b;
      sr += r; sg += g; sb += b; sl += L; sl2 += L * L; n++;
    }
    if (!n) return null;
    const rgb = [sr / n, sg / n, sb / n], mean = sl / n;
    return { n, mean, std: Math.sqrt(Math.max(0, sl2 / n - mean * mean)), rgb, lab: toLab(rgb) };
  }
  function toLab([r, g, b]) {
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), Gg = lin(g), B = lin(b);
    const X = (0.4124 * R + 0.3576 * Gg + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * Gg + 0.0722 * B, Z = (0.0193 * R + 0.1192 * Gg + 0.9505 * B) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }

  // ---------- circle candidates ----------
  /** Returns [{cx, cy, r, ...}] in full-resolution pixels. Uses photo.gray (processed) and proc.det / proc.ref. */
  /** Search area of the REF circles {x0, y0, x1, y1} (fractions of the image) -> pixel rectangle, null = whole image. */
  function areaRect(photo, area) {
    if (!area || !(area.x1 > area.x0) || !(area.y1 > area.y0)) return null;
    const W = photo.w, H = photo.h, cl = (v, m) => Math.max(0, Math.min(m, v));
    const x = Math.floor(cl(area.x0, 1) * W), y = Math.floor(cl(area.y0, 1) * H);
    const w = Math.ceil(cl(area.x1, 1) * W) - x, h = Math.ceil(cl(area.y1, 1) * H) - y;
    if (w < 16 || h < 16 || (w >= W && h >= H)) return null;
    return { x, y, w, h };
  }
  const areaKey = area => (area && area.x1 > area.x0 && area.y1 > area.y0 ? `|${area.x0.toFixed(4)},${area.y0.toFixed(4)},${area.x1.toFixed(4)},${area.y1.toFixed(4)}` : "");
  /** Cache key of photo.cands for this search area (procKey + area). */
  const candsKey = (photo, area) => photo.procKey + areaKey(area);

  /**
   * Round candidates (REF circles) in the photo. area = optional search area {x0, y0, x1, y1} as fractions of the
   * image: only this part is searched (faster, and other round features of the part cannot be taken for a REF).
   */
  async function findCircles(photo, proc, area) {
    const cv = await whenCv();
    const P = procOf(proc), D = P.det;
    const R = areaRect(photo, area), ox = R ? R.x : 0, oy = R ? R.y : 0, rw = R ? R.w : photo.w, rh = R ? R.h : photo.h;
    const k = Math.min(1, (D.workSize || 1000) / Math.max(rw, rh));
    const gray = new cv.Mat(photo.h, photo.w, cv.CV_8UC1); gray.data.set(photo.gray.data);
    const sub = R ? gray.roi(new cv.Rect(ox, oy, rw, rh)) : gray;
    const small = new cv.Mat();
    cv.resize(sub, small, new cv.Size(Math.max(1, Math.round(rw * k)), Math.max(1, Math.round(rh * k))), 0, 0, cv.INTER_AREA);
    if (R) sub.delete();
    const bl = Math.max(1, (D.blur | 0) | 1);
    if (bl > 1) cv.GaussianBlur(small, small, new cv.Size(bl, bl), 0);
    const bins = [], odd = v => Math.max(3, (v | 0) | 1);
    for (const bs of [odd(D.block1), odd(D.block2)]) {
      const a = new cv.Mat(), b = new cv.Mat();
      cv.adaptiveThreshold(small, a, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, bs, D.C);
      cv.adaptiveThreshold(small, b, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, bs, -D.C);
      bins.push(a, b);
    }
    const e = new cv.Mat(); cv.Canny(small, e, D.canny1, D.canny2);
    const ker = cv.Mat.ones(3, 3, cv.CV_8U); cv.dilate(e, e, ker); cv.bitwise_not(e, e); bins.push(e);
    const minR = D.minR || 4, maxR = Math.max(photo.w, photo.h) * k / (D.maxRFrac || 6);   // size limit from the whole image, also with a search area
    const cands = [];
    for (const b of bins) {
      const cs = new cv.MatVector(), hi = new cv.Mat();
      cv.findContours(b, cs, hi, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i);
        if (c.rows >= 20) {
          const A = cv.contourArea(c), Pm = cv.arcLength(c, true);
          if (A > 30 && Pm > 0) {
            const circ = 4 * Math.PI * A / (Pm * Pm);
            if (circ > D.minCirc) {
              const el = cv.fitEllipse(c);
              const MA = el.size.width, ma = el.size.height;
              const ar = Math.min(MA, ma) / Math.max(MA, ma), r = (MA + ma) / 4;
              if (ar > D.minAxis && r >= minR && r <= maxR) cands.push({ cx: el.center.x, cy: el.center.y, r, circ, ar });
            }
          }
        }
        c.delete();
      }
      cs.delete(); hi.delete(); b.delete();
    }
    gray.delete(); small.delete(); ker.delete();
    cands.sort((a, b) => b.circ - a.circ);
    const out = [];
    for (const c of cands) {
      if (out.every(o => Math.hypot(c.cx - o.cx, c.cy - o.cy) > Math.max(3, 0.3 * o.r) || Math.abs(c.r - o.r) > 0.3 * o.r)) out.push(c);
    }
    // back to full resolution, then sub-pixel refine
    const res = [];
    for (const c of out) {
      const full = { cx: c.cx / k + ox, cy: c.cy / k + oy, r: c.r / k };
      const ref = refineCircle(photo.gray, full, P.ref) || null;
      if (ref && Math.abs(ref.r - full.r) < 0.35 * full.r && Math.hypot(ref.cx - full.cx, ref.cy - full.cy) < 0.35 * full.r)
        res.push({ ...ref, circ: c.circ, contrast: ref.contrast });
    }
    // dedupe after refinement
    const fin = [];
    for (const c of res.sort((a, b) => a.rms / a.r - b.rms / b.r))
      if (fin.every(o => Math.hypot(c.cx - o.cx, c.cy - o.cy) > 0.3 * o.r || Math.abs(c.r - o.r) > 0.2 * o.r)) fin.push(c);
    photo.candsKey = candsKey(photo, area);
    return fin;
  }

  // ---------- calibration plate ----------
  /**
   * Round dots of a calibration plate (dark on bright or bright on dark). Returns {dots:[{x, y, area}], polarity}
   * with sub-pixel centres (gray-weighted centroid around each blob), in photo pixels.
   */
  async function findDots(photo) {
    const cv = await whenCv();
    const g = photo.gray, w = g.w, h = g.h;
    const m = new cv.Mat(h, w, cv.CV_8UC1); m.data.set(g.data);
    const bl = new cv.Mat(); cv.GaussianBlur(m, bl, new cv.Size(3, 3), 0);
    const best = { dots: [], polarity: "" };
    for (const [pol, mode] of [["dark", cv.THRESH_BINARY_INV], ["bright", cv.THRESH_BINARY]]) {
      const b = new cv.Mat(); cv.threshold(bl, b, 0, 255, mode + cv.THRESH_OTSU);
      const cs = new cv.MatVector(), hi = new cv.Mat();
      cv.findContours(b, cs, hi, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
      const blobs = [];
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i), A = cv.contourArea(c), P = cv.arcLength(c, true);
        if (A > 12 && P > 0 && 4 * Math.PI * A / (P * P) > 0.7) { const r = cv.boundingRect(c); if (r.x > 1 && r.y > 1 && r.x + r.width < w - 2 && r.y + r.height < h - 2) blobs.push({ A, r }); }
        c.delete();
      }
      cs.delete(); hi.delete(); b.delete();
      if (blobs.length < 9) continue;
      const med = blobs.map(x => x.A).sort((x, y) => x - y)[blobs.length >> 1];
      const ok = blobs.filter(x => x.A > med * 0.5 && x.A < med * 2);
      if (ok.length <= best.dots.length) continue;
      const dots = [];
      for (const { A, r } of ok) {
        const e = Math.ceil(Math.max(r.width, r.height) * 0.3) + 1;
        const x0 = Math.max(0, r.x - e), y0 = Math.max(0, r.y - e), x1 = Math.min(w - 1, r.x + r.width + e), y1 = Math.min(h - 1, r.y + r.height + e);
        let lo = 255, hi2 = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = g.data[y * w + x]; if (v < lo) lo = v; if (v > hi2) hi2 = v; }
        if (hi2 - lo < 10) continue;
        let sw = 0, sx = 0, sy = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          let v = (g.data[y * w + x] - lo) / (hi2 - lo); if (pol === "dark") v = 1 - v;
          v = v < 0.15 ? 0 : v; // ignore the background
          sw += v; sx += v * x; sy += v * y;
        }
        if (sw > 0) dots.push({ x: sx / sw, y: sy / sw, area: A });
      }
      best.dots = dots; best.polarity = pol;
    }
    m.delete(); bl.delete();
    return best;
  }

  /** Refine a rough circle: radial rays, strongest edge in ring [0.6r, 1.4r], robust fit. */
  function refineCircle(gray, c, opt = {}) {
    const r0 = c.r * (opt.inner ?? 0.6), r1 = c.r * (opt.outer ?? 1.4);
    const n = opt.rays || opt.n || 90;
    const pts = scanRing(gray, { cx: c.cx, cy: c.cy, r0, r1, n, polarity: opt.polarity || "any", select: "strongest", thr: opt.thr ?? 8 });
    if (pts.length < 12) return null;
    const fit = robustCircle(pts);
    if (!fit) return null;
    fit.contrast = pts.reduce((s, p) => s + Math.abs(p.g), 0) / pts.length;
    fit.pts = pts; fit.coverage = pts.length / n;
    return fit;
  }

  function robustCircle(pts) {
    let set = pts, fit = G().ransacCircle(set, Math.max(1.5, 0.02 * Math.sqrt(area(set))), 200);
    for (let i = 0; i < 3 && fit; i++) {
      const tol = Math.max(1.0, 2.5 * fit.rms);
      const s2 = set.filter(p => Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r) < tol);
      if (s2.length < 6 || s2.length === set.length) break;
      set = s2; fit = G().fitCircle(set);
    }
    if (fit) { fit.inliers = set; fit.outliers = pts.length - set.length; }
    return fit;
  }
  const area = pts => { let x0 = Infinity, x1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); } return (x1 - x0) ** 2; };

  // ---------- 1-D edge scans ----------
  function sample(gray, x, y) {
    const { w, h, data } = gray;
    if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
  }

  /**
   * Scan along a ray a -> b. Returns the chosen edge {x, y, g} or null.
   * polarity: "any" | "d2b" (dark to bright along scan) | "b2d"; select: "first" | "last" | "strongest".
   * width: average this many parallel rays (pixels) to suppress noise.
   */
  function scanRay(gray, a, b, o = {}) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 3) return null;
    const step = 0.5, n = Math.floor(L / step), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const wd = o.width || 3, half = (wd - 1) / 2;
    const prof = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -half; k <= half; k++) {
        const v = sample(gray, a.x + ux * i * step - uy * k, a.y + uy * i * step + ux * k);
        if (!isNaN(v)) { s += v; c++; }
      }
      prof[i] = c ? s / c : NaN;
    }
    // smooth (gaussian-ish) and derivative over +-2 samples (1 px)
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < n && !isNaN(prof[j])) { const wt = [1, 3, 6, 7, 6, 3, 1][k + 3]; s += prof[j] * wt; c += wt; } }
      sm[i] = c ? s / c : NaN;
    }
    const gr = new Float32Array(n);
    for (let i = 2; i < n - 2; i++) gr[i] = (sm[i + 2] - sm[i - 2]) / 2; // per px
    const thr = o.thr ?? 10, pol = o.polarity || "any", edges = [];
    for (let i = 3; i < n - 3; i++) {
      const g = gr[i];
      if (isNaN(g) || Math.abs(g) < thr) continue;
      if (pol === "d2b" && g <= 0) continue;
      if (pol === "b2d" && g >= 0) continue;
      if (Math.abs(g) >= Math.abs(gr[i - 1]) && Math.abs(g) > Math.abs(gr[i + 1])) {
        const y0 = Math.abs(gr[i - 1]), y1 = Math.abs(g), y2 = Math.abs(gr[i + 1]);
        const den = y0 - 2 * y1 + y2, off = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
        const t = (i + Math.max(-0.5, Math.min(0.5, off))) * step;
        edges.push({ t, g, x: a.x + ux * t, y: a.y + uy * t });
      }
    }
    if (!edges.length) return null;
    const sel = o.select || "strongest";
    if (sel === "first") return edges[0];
    if (sel === "last") return edges[edges.length - 1];
    return edges.reduce((m, e) => (Math.abs(e.g) > Math.abs(m.g) ? e : m));
  }

  /** Radial scan of a ring. dir "in" scans from outer to inner radius (default "out"). a0/a1 in radians for arcs. */
  function scanRing(gray, o) {
    const pts = [], n = o.n || 72;
    const a0 = o.a0 ?? 0, a1 = o.a1 ?? 2 * Math.PI, full = Math.abs(a1 - a0) >= 2 * Math.PI - 1e-6;
    for (let i = 0; i < n; i++) {
      const t = full ? a0 + (i / n) * (a1 - a0) : a0 + (i / (n - 1)) * (a1 - a0);
      const c = Math.cos(t), s = Math.sin(t);
      const pin = { x: o.cx + o.r0 * c, y: o.cy + o.r0 * s }, pout = { x: o.cx + o.r1 * c, y: o.cy + o.r1 * s };
      const e = o.dir === "in" ? scanRay(gray, pout, pin, o) : scanRay(gray, pin, pout, o);
      if (e) pts.push(e);
    }
    return pts;
  }

  /** Caliper scans across a rectangle: p0->p1 is the line direction, half width hw, scan normal side (+1/-1). */
  function scanRect(gray, o) {
    const pts = [], n = o.n || 30, L = Math.hypot(o.p1.x - o.p0.x, o.p1.y - o.p0.y);
    if (L < 2) return pts;
    const ux = (o.p1.x - o.p0.x) / L, uy = (o.p1.y - o.p0.y) / L, nx = -uy * (o.side || 1), ny = ux * (o.side || 1);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n * L, cx = o.p0.x + ux * t, cy = o.p0.y + uy * t;
      const e = scanRay(gray, { x: cx - nx * o.hw, y: cy - ny * o.hw }, { x: cx + nx * o.hw, y: cy + ny * o.hw }, o);
      if (e) pts.push(e);
    }
    return pts;
  }

  /** Focus score: variance of Laplacian on a gray crop (higher = sharper). */
  function sharpness(gray, box) {
    const { w, data } = gray;
    const x0 = Math.max(1, box.x | 0), y0 = Math.max(1, box.y | 0);
    const x1 = Math.min(gray.w - 2, (box.x + box.w) | 0), y1 = Math.min(gray.h - 2, (box.y + box.h) | 0);
    let s = 0, s2 = 0, n = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
      const i = y * w + x, l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      s += l; s2 += l * l; n++;
    }
    return n ? s2 / n - (s / n) ** 2 : 0;
  }

  // ---------- DataMatrix ----------
  /**
   * Try to decode a DataMatrix. box (optional) = {cx, cy, size, angle} in px to crop around.
   * Tries several scales, rotations and inverted images.
   */
  function readDataMatrix(photo, box) {
    if (!window.ZXing) return null;
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.DATA_MATRIX]);
    const reader = new Z.DataMatrixReader();
    const tries = [];
    if (box) {
      for (const pad of [1.6, 2.4]) for (const tgt of [240, 360, 160]) tries.push({ size: box.size * pad, tgt, angle: box.angle || 0 });
    } else {
      for (const tgt of [1200, 1800, 900]) tries.push({ whole: true, tgt });
    }
    const c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
    for (const t of tries) {
      for (const rot of box ? [0, 45, 90] : [0]) {
        if (t.whole) {
          const k = Math.min(1, t.tgt / Math.max(photo.w, photo.h));
          c.width = Math.round(photo.w * k); c.height = Math.round(photo.h * k);
          x.drawImage(photo.canvas, 0, 0, c.width, c.height);
        } else {
          c.width = c.height = t.tgt;
          const k = t.tgt / t.size;
          x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#808080"; x.fillRect(0, 0, c.width, c.height);
          x.translate(t.tgt / 2, t.tgt / 2); x.rotate(-(t.angle + rot * Math.PI / 180)); x.scale(k, k);
          x.drawImage(photo.canvas, -box.cx, -box.cy);
          x.setTransform(1, 0, 0, 1, 0, 0);
        }
        const id = x.getImageData(0, 0, c.width, c.height);
        const lum = new Uint8ClampedArray(c.width * c.height);
        for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (id.data[j] * 77 + id.data[j + 1] * 150 + id.data[j + 2] * 29) >> 8;
        const src = new Z.RGBLuminanceSource(lum, c.width, c.height);
        for (const inv of [false, true]) {
          const s2 = inv ? new Z.InvertedLuminanceSource(src) : src;
          for (const Bin of [Z.HybridBinarizer, Z.GlobalHistogramBinarizer]) {
            try {
              const r = reader.decode(new Z.BinaryBitmap(new Bin(s2)), hints);
              if (r && r.getText()) return { text: r.getText(), try: { ...t, rot, inv } };
            } catch (e) { /* not found */ }
          }
        }
      }
    }
    return null;
  }

  return { whenCv, toLab, defaultProc, procOf, loadPhoto, makeGray, shrink, grayCanvas, appearance, findCircles, candsKey, areaRect, findDots, refineCircle, robustCircle, scanRay, scanRing, scanRect, sharpness, readDataMatrix, sample };
})();
