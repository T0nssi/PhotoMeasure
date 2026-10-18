// Station (fixed) calibration: the scale of a fixed camera station is measured once with a calibration
// plate (dot grid with a known pitch, or a ring / pin gauge with a known diameter) and stored on this PC.
// Programs in reference mode "Fixed calibration" use it instead of reference holes in every image.
//
// A station calibration record:
//   { id, name, station, serial, model, W0, H0, s0 (mm per camera pixel), sU, sV (mm/px along the grid axes),
//     skewDeg, rotDeg, rmsUm, maxUm, distPct, n, pitch, method, cover, date, by, validDays, settings, checks[], thumb }
// station = camera serial number, or "files" for photos loaded from files.
"use strict";
window.PM = window.PM || {};
PM.calib = (() => {
  const KEY = "pm.stations";
  const V = () => PM.vision;

  // ---------------- store (localStorage, included in the backup file) ----------------
  function list() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function saveAll(a) { localStorage.setItem(KEY, JSON.stringify(a)); }
  function put(rec) { const a = list().filter(r => r.id !== rec.id); a.push(rec); saveAll(a); return rec; }
  function del(id) { saveAll(list().filter(r => r.id !== id)); }
  function get(id) { return list().find(r => r.id === id) || null; }
  /** Newest calibration of a station (camera serial or "files"). */
  function active(station) {
    const a = list().filter(r => r.station === (station || "files")).sort((x, y) => Date.parse(y.date) - Date.parse(x.date));
    return a[0] || null;
  }
  function stations() {
    const m = new Map();
    for (const r of list()) { const c = m.get(r.station); if (!c || Date.parse(r.date) > Date.parse(c.date)) m.set(r.station, r); }
    return [...m.values()];
  }
  /** Merge records from a backup (same id: keep the newer check list). Returns the number added. */
  function importList(recs) {
    const a = list(), have = new Set(a.map(r => r.id)); let n = 0;
    for (const r of recs || []) if (r && r.id && r.s0 > 0 && !have.has(r.id)) { a.push(r); n++; }
    saveAll(a); return n;
  }
  /** "ok" | "soon" (≤ 3 days left) | "expired" | "none" */
  function stateOf(rec) {
    if (!rec) return { state: "none", days: null };
    if (!(rec.validDays > 0)) return { state: "ok", days: null };
    const left = rec.validDays - (Date.now() - Date.parse(rec.date)) / 864e5;
    return { state: left < 0 ? "expired" : left <= 3 ? "soon" : "ok", days: left };
  }

  // ---------------- dot grid ----------------
  const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  /**
   * Give every dot its grid index (i, j) by growing from the dot nearest the image centre, then fit
   * px = O + i·U + j·V (least squares). pts in pixels. Returns the fit with residuals, or {error}.
   */
  function fitGrid(pts, W, H) {
    const n = pts.length;
    if (n < 9) return { error: `only ${n} dots found (need at least 9)` };
    // nearest-neighbour spacing
    const cell = Math.sqrt(W * H / n), hash = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    pts.forEach((p, i) => { const k = key(p.x, p.y); (hash.get(k) || hash.set(k, []).get(k)).push(i); });
    const near = (x, y, r) => {
      const out = [], cx = Math.floor(x / cell), cy = Math.floor(y / cell), m = Math.ceil(r / cell);
      for (let a = cx - m; a <= cx + m; a++) for (let b = cy - m; b <= cy + m; b++) for (const i of hash.get(`${a},${b}`) || []) { const d = Math.hypot(pts[i].x - x, pts[i].y - y); if (d <= r) out.push({ i, d }); }
      return out.sort((p, q) => p.d - q.d);
    };
    const nn = pts.map((p, i) => { const c = near(p.x, p.y, 3 * cell).filter(q => q.i !== i); return c.length ? c[0].d : Infinity; });
    const d = median(nn.filter(isFinite));
    if (!(d > 2)) return { error: "dot spacing not found" };
    // start dot and its two grid directions
    let i0 = 0; pts.forEach((p, i) => { if (Math.hypot(p.x - W / 2, p.y - H / 2) < Math.hypot(pts[i0].x - W / 2, pts[i0].y - H / 2)) i0 = i; });
    const nb = near(pts[i0].x, pts[i0].y, 1.35 * d).filter(q => q.i !== i0 && q.d > 0.65 * d).map(q => ({ x: pts[q.i].x - pts[i0].x, y: pts[q.i].y - pts[i0].y }));
    if (nb.length < 2) return { error: "the dot in the middle has too few neighbours: is the plate in focus and fully lit?" };
    const u = nb.reduce((a, b) => (b.x / Math.hypot(b.x, b.y) > a.x / Math.hypot(a.x, a.y) ? b : a));
    const ul = Math.hypot(u.x, u.y);
    let v = null;
    for (const b of nb) { const cr = (u.x * b.y - u.y * b.x) / (ul * Math.hypot(b.x, b.y)); if (cr > 0.8 && (!v || Math.hypot(b.x, b.y) < Math.hypot(v.x, v.y))) v = b; }
    if (!v) return { error: "second grid direction not found (the plate needs a square dot pattern)" };
    // grow
    const idx = new Map(), at = new Map(), q = [{ k: i0, i: 0, j: 0, u, v }];
    idx.set(i0, [0, 0]); at.set("0,0", i0);
    while (q.length) {
      const c = q.shift(), p = pts[c.k];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ex = p.x + di * c.u.x + dj * c.v.x, ey = p.y + di * c.u.y + dj * c.v.y;
        const f = near(ex, ey, 0.3 * d)[0];
        if (!f || idx.has(f.i) || at.has(`${c.i + di},${c.j + dj}`)) continue;
        const ni = c.i + di, nj = c.j + dj, fp = pts[f.i];
        idx.set(f.i, [ni, nj]); at.set(`${ni},${nj}`, f.i);
        const nu = di ? { x: (fp.x - p.x) * di, y: (fp.y - p.y) * di } : c.u, nv = dj ? { x: (fp.x - p.x) * dj, y: (fp.y - p.y) * dj } : c.v;
        q.push({ k: f.i, i: ni, j: nj, u: nu, v: nv });
      }
    }
    let use = [...idx.entries()].map(([k, [i, j]]) => ({ x: pts[k].x, y: pts[k].y, i, j }));
    let fit = null;
    for (let pass = 0; pass < 3; pass++) {
      fit = affine(use);
      if (!fit) return { error: "grid fit failed" };
      const lim = Math.max(0.5, 4 * fit.rms), keep = use.filter(p => p.res <= lim);
      if (keep.length === use.length || keep.length < 9) break;
      use = keep;
    }
    fit.pts = use; fit.found = n; fit.spacing = d;
    return fit;
  }
  /** Least-squares px = O + i·U + j·V. */
  function affine(P) {
    let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    for (const p of P) { const r = [1, p.i, p.j]; for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) S[a][b] += r[a] * r[b]; bx[a] += r[a] * p.x; by[a] += r[a] * p.y; } }
    const sx = solve3(S, bx), sy = solve3(S, by);
    if (!sx || !sy) return null;
    let s2 = 0, mx = 0;
    for (const p of P) { const ex = sx[0] + sx[1] * p.i + sx[2] * p.j - p.x, ey = sy[0] + sy[1] * p.i + sy[2] * p.j - p.y; p.ex = ex; p.ey = ey; p.res = Math.hypot(ex, ey); s2 += p.res * p.res; mx = Math.max(mx, p.res); }
    return { O: { x: sx[0], y: sy[0] }, U: { x: sx[1], y: sy[1] }, V: { x: sx[2], y: sy[2] }, rms: Math.sqrt(s2 / P.length), max: mx, n: P.length };
  }
  function solve3(A, b) {
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  /**
   * Measure a calibration plate photo. method "dots" (size = pitch mm) or "circle" (size = gauge Ø mm).
   * Pixel values are converted to original camera pixels (photo.loadScale). Returns a result for the UI and for put().
   */
  async function measurePlate(photo, method, size) {
    if (!(size > 0)) throw new Error(method === "dots" ? "enter the dot pitch (mm)" : "enter the gauge diameter (mm)");
    const k = photo.loadScale || 1, W0 = Math.round(photo.w / k), H0 = Math.round(photo.h / k);
    if (method === "circle") {
      const cands = await V().findCircles(photo, V().defaultProc());
      if (!cands.length) throw new Error("no circle found");
      const c = cands.map(c => ({ c, sc: (c.coverage || 0) * c.r / (1 + Math.hypot(c.cx - photo.w / 2, c.cy - photo.h / 2) / photo.w) })).sort((a, b) => b.sc - a.sc)[0].c;
      const rPx = c.r / k, s0 = size / (2 * rPx);
      return { method, size, W0, H0, s0, sU: s0, sV: s0, skewDeg: 0, rotDeg: 0, rmsUm: (c.rms || 0) / k * s0 * 1000, maxUm: null, distPct: null, n: 1, cover: Math.round(100 * 2 * c.r / Math.max(photo.w, photo.h)),
        draw: { circle: { cx: c.cx, cy: c.cy, r: c.r } }, warn: ["A single circle gives the scale only from its diameter (edge errors count twice). Prefer a dot-grid plate."] };
    }
    const found = await V().findDots(photo);
    const pts = found.dots.map(p => ({ x: p.x / k, y: p.y / k }));
    const fit = fitGrid(pts, W0, H0);
    if (fit.error) throw new Error(fit.error);
    const lu = Math.hypot(fit.U.x, fit.U.y), lv = Math.hypot(fit.V.x, fit.V.y), s0 = size / ((lu + lv) / 2);
    const xs = fit.pts.map(p => p.x), ys = fit.pts.map(p => p.y);
    const cover = Math.round(100 * Math.min(1, (Math.max(...xs) - Math.min(...xs)) / W0) * Math.min(1, (Math.max(...ys) - Math.min(...ys)) / H0));
    // radial distortion: radial residual = a·r + b·r³ around the image centre (the affine fit already took the mean scale)
    let m11 = 0, m12 = 0, m22 = 0, v1 = 0, v2 = 0;
    for (const p of fit.pts) { const dx = p.x - W0 / 2, dy = p.y - H0 / 2, r = Math.hypot(dx, dy); if (r < 1) continue; const er = -(p.ex * dx + p.ey * dy) / r, r3 = r ** 3; m11 += r * r; m12 += r * r3; m22 += r3 * r3; v1 += er * r; v2 += er * r3; }
    const det = m11 * m22 - m12 * m12, kr = det ? (m11 * v2 - m12 * v1) / det : 0, rc = Math.hypot(W0, H0) / 2, distPct = 100 * kr * rc ** 2;
    // keystone (plate or camera tilted): grid step in one half of the image against the other half
    const stepOf = P => { const f = affine(P.map(q => ({ x: q.x, y: q.y, i: q.i, j: q.j }))); return f ? (Math.hypot(f.U.x, f.U.y) + Math.hypot(f.V.x, f.V.y)) / 2 : null; };
    const half = key => { const v = fit.pts.map(q => q[key]).sort((a, b) => a - b), m = v[v.length >> 1]; const A = fit.pts.filter(q => q[key] < m), B = fit.pts.filter(q => q[key] >= m); if (A.length < 9 || B.length < 9) return 0; const a = stepOf(A), b = stepOf(B); return a && b ? 200 * (b - a) / (a + b) : 0; };
    const tiltI = half("i"), tiltJ = half("j");
    const skewDeg = (Math.acos(Math.max(-1, Math.min(1, (fit.U.x * fit.V.x + fit.U.y * fit.V.y) / (lu * lv)))) * 180 / Math.PI) - 90;
    const res = { method, size, W0, H0, s0, sU: size / lu, sV: size / lv, skewDeg, rotDeg: Math.atan2(fit.U.y, fit.U.x) * 180 / Math.PI,
      rmsUm: fit.rms * s0 * 1000, maxUm: fit.max * s0 * 1000, rmsPx: fit.rms, distPct, tiltPct: Math.abs(tiltI) > Math.abs(tiltJ) ? tiltI : tiltJ, n: fit.n, found: found.dots.length, polarity: found.polarity, cover,
      draw: { dots: fit.pts.map(p => ({ x: p.x * k, y: p.y * k, ex: p.ex * k, ey: p.ey * k, res: p.res })) }, warn: [] };
    const aniso = 100 * (res.sU - res.sV) / s0;
    if (Math.abs(aniso) > 0.2) res.warn.push(`X/Y scale differ by ${aniso.toFixed(2)} %: camera or plate tilted`);
    if (Math.abs(skewDeg) > 0.2) res.warn.push(`grid not square (${skewDeg.toFixed(2)}°): camera or plate tilted`);
    if (res.maxUm > 3 * Math.max(1, res.rmsUm) && res.maxUm > 1000 * s0) res.warn.push(`largest dot error ${res.maxUm.toFixed(1)} µm: lens distortion at the image border or a dirty dot`);
    if (Math.abs(distPct) > 0.1) res.warn.push(`lens distortion ≈ ${distPct.toFixed(2)} % at the image corner: keep measured features near the centre`);
    if (Math.abs(res.tiltPct) > 0.05) res.warn.push(`scale changes ${Math.abs(res.tiltPct).toFixed(2)} % from one side of the image to the other: plate or camera tilted – level them`);
    if (fit.rms > 0.5) res.warn.push(`dot error RMS ${res.rmsUm.toFixed(1)} µm = ${fit.rms.toFixed(2)} px (limit 0.5 px): plate tilted, lens distortion or a poor plate`);
    if (cover < 50) res.warn.push(`the plate covers only ${cover} % of the image: use a plate that fills the field of view`);
    res.aniso = aniso;
    return res;
  }

  /** Compare a new plate measurement with a saved calibration (daily check). */
  function compare(rec, res, limitPct = 0.05) {
    const diffPct = 100 * (res.s0 - rec.s0) / rec.s0;
    return { diffPct, ok: Math.abs(diffPct) <= limitPct && res.W0 === rec.W0 && res.H0 === rec.H0, limitPct };
  }

  return { list, put, del, get, active, stations, importList, stateOf, fitGrid, measurePlate, compare };
})();
