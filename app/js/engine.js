// Measurement engine: template (part program), calibration from 2 reference circles, element tools,
// constructed elements, dimensions and tolerances. Coordinates: "px" = photo pixels, "mm" = part frame
// (origin REF1 centre, +X toward REF2, +Y = image-down side). Reporting uses the user datum (default
// origin REF1, X toward REF2, Y up).
"use strict";
window.PM = window.PM || {};
PM.engine = (() => {
  const G = () => PM.geom, V = () => PM.vision;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ---------------- catalogue ----------------
  const TOOLS = {
    // measured (edge detection inside an ROI)
    circle: { out: "circle", measured: true },
    arc: { out: "circle", measured: true },
    line: { out: "line", measured: true },
    point: { out: "point", measured: true },
    color: { out: "color", measured: true },
    ocr: { out: "text", measured: true },
    // constructed
    mid: { out: "point", args: ["pt", "pt"] },
    intersect: { out: "point", args: ["line", "line"] },
    foot: { out: "point", args: ["pt", "line"] },
    line2p: { out: "line", args: ["pt", "pt"] },
    circle3p: { out: "circle", args: ["pt", "pt", "pt"] },
    parallel: { out: "line", args: ["line", "pt"] },
    perp: { out: "line", args: ["line", "pt"] },
    bisector: { out: "line", args: ["line", "line"] },
    ref: { out: "circle" },
  };
  // dimension kinds: args, unit, form = one-sided (upper limit only)
  const DIMS = {
    distance: { args: ["any", "any"], unit: "mm" },
    x: { args: ["pt"], unit: "mm" },
    y: { args: ["pt"], unit: "mm" },
    diameter: { args: ["circle"], unit: "mm" },
    radius: { args: ["circle"], unit: "mm" },
    angle: { args: ["line", "line?"], unit: "°" },
    roundness: { args: ["circle"], unit: "mm", form: true },
    straightness: { args: ["line"], unit: "mm", form: true },
    parallelism: { args: ["line", "line"], unit: "mm", form: true },
    perpendicularity: { args: ["line", "line"], unit: "mm", form: true },
    position: { args: ["pt"], unit: "mm", form: true, needsNominalXY: true },
    concentricity: { args: ["circle", "circle"], unit: "mm", form: true },
    area: { args: ["circle"], unit: "mm²" },
    color: { args: ["color"], unit: "ΔE", form: true },
    colordiff: { args: ["color", "color"], unit: "ΔE", form: true },
    text: { args: ["text"], unit: "", text: true },
  };

  function newTemplate() {
    return {
      app: "PhotoMeasure", version: 1, id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: "New part", partNo: "", note: "",
      created: new Date().toISOString(), modified: new Date().toISOString(),
      ref: { mode: "2c", rotBy: "ref2", d1: 4, d2: 4, L: null, Lsource: "master", ratioD: null, ratioL: null, beta: 0, alpha: null, minPxPerMm: 20 },
      proc: PM.vision.defaultProc(),
      master: null, // {name, w, h, img, imgScale, c1, c2, frame}
      datum: { origin: "REF1", axis: "REF2", yUp: true },
      code: null, // DataMatrix ROI {x, y, size} in mm
      reportBox: null, // {x0, y0, x1, y1} mm crop for report pictures
      elements: [
        { id: "REF1", name: "Reference circle 1", tool: "ref", which: 1 },
        { id: "REF2", name: "Reference circle 2", tool: "ref", which: 2 },
      ],
      dims: [],
      seq: { el: 0, dim: 0 },
    };
  }

  const defaultEdge = () => ({ polarity: "any", select: "strongest", thr: 12, dir: "in" });

  /** Next free id per prefix: C1, C2…, L1…, P1…, D1… */
  function nextId(t, prefix, kind) {
    t.seq = t.seq || {};
    const used = new Set([...t.elements, ...t.dims].map(e => e.id));
    let n = (t.seq[prefix] || 0) + 1;
    while (used.has(prefix + n)) n++;
    t.seq[prefix] = n;
    return prefix + n;
  }
  /** Search area moved by (sx, sy) mm: centres (cx, cy) and points ({x, y}: p0, p1 …) of the ROI. */
  function shiftRoi(roi, sx, sy) {
    if (!roi || typeof roi !== "object") return roi;
    const r = JSON.parse(JSON.stringify(roi));
    if (typeof r.cx === "number" && typeof r.cy === "number") { r.cx += sx; r.cy += sy; }
    if (typeof r.x === "number" && typeof r.y === "number") { r.x += sx; r.y += sy; }
    for (const k of Object.keys(r)) { const v = r[k]; if (v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number") { v.x += sx; v.y += sy; } }
    return r;
  }

  /**
   * Array copy of a group of elements that have the same style (e.g. a row of holes): every copy gets new ids, its
   * search areas moved by the pitch, constructions copied with their arguments when these are in the group, and the
   * dimensions of the group copied (a position nominal moves by the pitch).
   * opt = {nx, ny: columns / rows (incl. the original), dx, dy: pitch in mm as in the report datum (X, Y of the drawing),
   *        D: datum (datumOf) – without it dx / dy are in the program frame, dims: copy dimensions (default true)}.
   * Returns {elements, dims, check} – check = copied dimensions that also use an element outside the group, whose
   * nominal (if any) is not moved and must be checked.
   */
  function arrayCopy(t, ids, opt) {
    const nx = Math.max(1, Math.floor(+opt.nx || 1)), ny = Math.max(1, Math.floor(+opt.ny || 1)), dx = +opt.dx || 0, dy = +opt.dy || 0;
    const els = t.elements.filter(e => ids.includes(e.id) && e.tool !== "ref");
    if (!els.length) throw new Error("select the elements to copy (REF circles are not copied)");
    if (nx * ny < 2) throw new Error("columns × rows must be 2 or more");
    if (nx * ny > 500) throw new Error("too many copies (max 500 positions)");
    if ((nx > 1 && !dx) || (ny > 1 && !dy)) throw new Error("enter the pitch for every direction that has more than 1 position");
    const group = new Set(els.map(e => e.id));
    // pitch (datum X / Y) -> shift in the program frame (mm)
    const D = opt.D, frameShift = (ix, iy) => {
      if (!D) return { x: ix * dx, y: iy * dy };
      const o = D.fwd({ x: 0, y: 0 }), f = D.inv({ x: o.x + ix * dx, y: o.y + iy * dy }), z = D.inv(o);
      return { x: f.x - z.x, y: f.y - z.y };
    };
    t.seq = t.seq || {};
    const gName = els[0].group || ("G" + (t.seq.G = (t.seq.G || 0) + 1));
    for (const e of els) e.group = e.group || gName;
    const dimsOf = opt.dims === false ? [] : t.dims.filter(d => group.has(d.a) || (d.b && group.has(d.b)));
    const added = { elements: [], dims: [], check: [] };
    let n = 1;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      if (!ix && !iy) continue;
      n++;
      const s = frameShift(ix, iy), map = {};
      for (const e of els) {
        const c = JSON.parse(JSON.stringify(e));
        c.id = nextId(t, PREFIX[e.tool] || String(e.id).replace(/\d+$/, "") || "E", "el");
        map[e.id] = c.id;
        c.name = `${String(e.name || e.id).replace(/ \[\d+\]$/, "")} [${n}]`;
        c.group = gName; c.arrayOf = e.id;
        if (c.roi) c.roi = shiftRoi(c.roi, s.x, s.y);
        t.elements.push(c); added.elements.push(c);
      }
      for (const c of added.elements.slice(-els.length)) if (Array.isArray(c.args)) c.args = c.args.map(a => map[a] ?? a);
      for (const d of dimsOf) {
        const c = JSON.parse(JSON.stringify(d));
        c.id = nextId(t, "D", "dim");
        c.name = `${String(d.name || d.id).replace(/ \[\d+\]$/, "")} [${n}]`;
        c.a = map[d.a] ?? d.a; if (d.b) c.b = map[d.b] ?? d.b;
        c.arrayOf = d.id;
        if (num(c.nomX) != null) c.nomX = +(num(c.nomX) + ix * dx).toFixed(6);
        if (num(c.nomY) != null) c.nomY = +(num(c.nomY) + iy * dy).toFixed(6);
        const outside = !group.has(d.a) || (d.b && !group.has(d.b));
        if (outside && c.kind !== "position" && (num(c.nom) != null || c.spec)) added.check.push(c.id);
        t.dims.push(c); added.dims.push(c);
      }
    }
    return added;
  }

  const PREFIX = { ocr: "T", color: "K", circle: "C", arc: "A", line: "L", point: "P", mid: "P", intersect: "P", foot: "P", line2p: "L", circle3p: "C", parallel: "L", perp: "L", bisector: "L" };

  // ---------------- calibration ----------------
  // Reference modes (t.ref.mode):  "2c" = 2 circles (scale from their spacing L, origin REF1)
  //                                "1c" = 1 circle  (scale from its diameter, origin REF1)
  // Rotation source (t.ref.rotBy): "ref2"  = direction REF1 -> REF2 (2c only)
  //                                "<element id>" = a measured line / edge point / circle (angle of a line, or
  //                                                  direction REF1 -> point) as in the master
  //                                "image" = best match of the part area with the master image
  //                                "none"  = keep the photo orientation (fixture / jig)
  //                 "cal" = fixed (station) calibration: the scale comes from a calibration plate measured
  //                         beforehand (no reference holes in the image); position from t.ref.pos:
  //                         "fixture" = part always at the same place, "shift" = search position,
  //                         "image" = search position + rotation (image match with the master)
  /** REF search area {x0, y0, x1, y1} (fractions of the photo) of a 2c / 1c program; null = whole photo. */
  const refArea = t => { const a = t.ref?.area; return a && a.x1 > a.x0 && a.y1 > a.y0 && modeOf(t) !== "cal" ? a : null; };
  const modeOf = t => (t.ref.mode === "1c" ? "1c" : t.ref.mode === "cal" ? "cal" : "2c");
  const posOf = t => (["fixture", "shift", "image"].includes(t.ref.pos) ? t.ref.pos : "image");
  const rotOf = t => (modeOf(t) === "cal" ? (posOf(t) === "image" ? "image" : "none") : t.ref.rotBy || (modeOf(t) === "2c" ? "ref2" : "image"));
  const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
  const rotEl = t => { if (modeOf(t) === "cal") return null; const r = rotOf(t); return ["ref2", "image", "none"].includes(r) ? null : t.elements.find(e => e.id === r && TOOLS[e.tool]?.measured && !["color", "ocr"].includes(e.tool)) || null; };

  /** Calibration of the master photo. Sets t.ref.L (2c), ratios and beta; master frame angle = REF1->REF2 or 0. */
  function masterCalibration(t, c1, c2, sCal) {
    if (modeOf(t) === "cal") {
      if (!(sCal > 0)) throw new Error("no station calibration");
      t.ref.beta = 0; t.ref.ratioD = null; t.ref.ratioL = null;
      return frameInfo(t, c1, null, { ox: c1.cx, oy: c1.cy, th: 0, s: sCal });
    }
    const two = modeOf(t) === "2c";
    let s;
    if (two) {
      const Lpx = Math.hypot(c2.cx - c1.cx, c2.cy - c1.cy);
      const sD = (t.ref.d1 / (2 * c1.r) + t.ref.d2 / (2 * c2.r)) / 2;
      if (!(t.ref.Lsource === "drawing" && t.ref.L > 0)) { t.ref.L = sD * Lpx; t.ref.Lsource = "master"; }
      t.ref.ratioD = c1.r / c2.r; t.ref.ratioL = Lpx / c1.r;
      s = t.ref.L / Lpx;
    } else { s = t.ref.d1 / (2 * c1.r); t.ref.ratioD = null; t.ref.ratioL = null; }
    const dir = two ? Math.atan2(c2.cy - c1.cy, c2.cx - c1.cx) : 0;
    const th = two && rotOf(t) === "ref2" ? dir : 0;
    t.ref.beta = two ? wrap(dir - th) : 0;
    return frameInfo(t, c1, two ? c2 : null, { ox: c1.cx, oy: c1.cy, th, s });
  }

  /** Store the angle of the rotation-reference element as measured on the master (after reframing). */
  function setRotRef(t, master, cal) {
    const E = rotEl(t);
    if (!E) { t.ref.alpha = null; return { ok: true }; }
    const r = measureElement(E, master, cal, {});
    const a = angleOf(r);
    t.ref.alpha = a;
    return a == null ? { ok: false, error: `rotation reference ${E.id}: ${r?.error || "too close to REF1"}` } : { ok: true };
  }
  /** Angle of an element: direction of a line, or direction REF1 (origin) -> point/centre. */
  function angleOf(r) {
    if (!r || r.error) return null;
    if (r.type === "line") return Math.atan2(r.dy, r.dx);
    const p = G().pointOf(r);
    if (!p || Math.hypot(p.x, p.y) < 0.5) return null;
    return Math.atan2(p.y, p.x);
  }

  function frameInfo(t, c1, c2, f) {
    const s = f.s, two = !!c2;
    const sD = two ? (t.ref.d1 / (2 * c1.r) + t.ref.d2 / (2 * c2.r)) / 2 : s;
    return {
      frame: f, c1: strip(c1), c2: two ? strip(c2) : null, s, pxPerMm: 1 / s,
      Lpx: two ? Math.hypot(c2.cx - c1.cx, c2.cy - c1.cy) : null,
      sCheck: sD, scaleDiffPct: two ? 100 * (sD - s) / s : 0,
      d1: 2 * c1.r * s, d2: two ? 2 * c2.r * s : null, angleDeg: f.th * R2D, mode: modeOf(t), rot: rotOf(t),
    };
  }
  const strip = c => ({ cx: c.cx, cy: c.cy, r: c.r, rms: c.rms, coverage: c.coverage });

  /**
   * Calibrate a photo from given circle(s) (sync). Finds the rotation with the configured source.
   * mp = master patches {box, data, coarse} for image matching.
   */
  function calibrateWith(t, photo, c1, c2, mp) {
    const two = modeOf(t) === "2c", rot = rotOf(t), notes = [];
    if (two && !c2) return { ok: false, error: "REF2 missing" };
    let s, th;
    if (two) {
      s = t.ref.L / Math.hypot(c2.cx - c1.cx, c2.cy - c1.cy);
      th = wrap(Math.atan2(c2.cy - c1.cy, c2.cx - c1.cx) - (t.ref.beta || 0));
    } else {
      s = t.ref.d1 / (2 * c1.r);
      th = 0;
      if (rot !== "none") {
        if (!mp?.coarse) return { ok: false, error: "no master image to find the rotation" };
        th = searchAngle(mp, photo, c1, s).th;
      }
    }
    const E = rotEl(t);
    if (E && rot !== "ref2") {
      if (t.ref.alpha == null) notes.push(`rotation reference ${E.id} not set on the master`);
      else {
        let okRef = false;
        for (let i = 0; i < 4; i++) {
          const f = { ox: c1.cx, oy: c1.cy, th, s };
          const r = measureElement(E, photo, { frame: f, c1, c2 }, {});
          const a = angleOf(r);
          if (a == null) { notes.push(`rotation reference ${E.id} not found: ${r?.error || "?"}`); break; }
          const d = wrap(a - t.ref.alpha); th = wrap(th + d); okRef = true;
          if (Math.abs(d) < 1e-6) break;
        }
        if (!okRef && !two) notes.push("rotation taken from image match only");
      }
    }
    const cal = frameInfo(t, c1, two ? c2 : null, { ox: c1.cx, oy: c1.cy, th, s });
    cal.ok = true; cal.notes = notes;
    cal.ncc = mp ? correlate(mp, photo, cal.frame) : null;
    return cal;
  }

  /**
   * Find REF1 (and REF2) in a new photo, then calibrate.
   * 2c: rank candidate pairs by size and spacing ratios vs the master; image match decides between the best.
   * 1c: try the round candidates whose size fits the master (0.4x..2.5x distance), image match decides.
   */
  async function autoCalibrate(t, photo, mp, st) {
    if (modeOf(t) === "cal") return stationCalibrate(t, photo, mp, st);
    const area = refArea(t);
    const cands = (photo.cands && photo.candsKey === V().candsKey(photo, area)) ? photo.cands : (photo.cands = await V().findCircles(photo, t.proc, area));
    const two = modeOf(t) === "2c";
    if (!cands.length) return { ok: false, error: area ? "no circle found in the REF search area" : "no circle found", cands };
    let best = null;
    if (two) {
      if (cands.length < 2) return { ok: false, error: "fewer than 2 circles found", cands };
      const mD = t.ref.ratioD, mL = t.ref.ratioL, pairs = [];
      for (let i = 0; i < cands.length; i++) for (let j = 0; j < cands.length; j++) {
        if (i === j) continue;
        const a = cands[i], b = cands[j], Lpx = Math.hypot(b.cx - a.cx, b.cy - a.cy);
        if (Lpx < (a.r + b.r)) continue;
        const cost = 3 * Math.abs(Math.log((a.r / b.r) / mD)) + 2 * Math.abs(Math.log((Lpx / a.r) / mL))
          + 0.5 * (2 - (a.coverage || 0) - (b.coverage || 0)) + ((a.rms / a.r) + (b.rms / b.r));
        pairs.push({ a, b, cost });
      }
      if (!pairs.length) return { ok: false, error: "no matching circle pair", cands };
      pairs.sort((p, q) => p.cost - q.cost);
      const top = pairs.slice(0, 8).filter(p => p.cost < pairs[0].cost + 0.6);
      if (!mD || !mL || !t.ref.L) return { ok: false, error: "program has no REF2 on the master", cands };
      for (const p of top) {
        const s = t.ref.L / Math.hypot(p.b.cx - p.a.cx, p.b.cy - p.a.cy);
        const th = wrap(Math.atan2(p.b.cy - p.a.cy, p.b.cx - p.a.cx) - (t.ref.beta || 0));
        const ncc = mp ? correlate(mp, photo, { ox: p.a.cx, oy: p.a.cy, th, s }) : 0;
        const score = ncc - 0.35 * p.cost;
        if (!best || score > best.score) best = { p, score, cost: p.cost };
      }
      if (!best) return { ok: false, error: "no matching circle pair", cands };
      const cal = calibrateWith(t, photo, best.p.a, best.p.b, mp);
      if (!cal.ok) return { ...cal, cands };
      return { ...cal, auto: true, cost: best.cost, ambiguous: Math.abs(Math.log(mD)) < 0.05 };
    }
    // one circle
    const mPxmm = t.master?.stats?.pxPerMm || (t.master?.frame ? 1 / t.master.frame.s : null);
    const rExp = mPxmm ? t.ref.d1 / 2 * mPxmm : null;
    let list = cands.filter(c => !rExp || (c.r > rExp * 0.4 && c.r < rExp * 2.5));
    list = list.sort((a, b) => (b.coverage - a.coverage) || (a.rms / a.r - b.rms / b.r)).slice(0, 8);
    if (!list.length) return { ok: false, error: "no circle of the expected size", cands };
    const rot = rotOf(t);
    const scored = list.map(c => {
      const s = t.ref.d1 / (2 * c.r);
      if (!mp) return { c, score: c.coverage };
      if (rot === "none") return { c, score: correlate(mp, photo, { ox: c.cx, oy: c.cy, th: 0, s }, true) };
      return { c, score: searchAngle(mp, photo, c, s, true).score };
    }).sort((a, b) => b.score - a.score);
    for (const x of scored.slice(0, 2)) {
      const cal = calibrateWith(t, photo, x.c, null, mp);
      if (!cal.ok) continue;
      if (!best || (cal.ncc ?? 0) > (best.ncc ?? 0)) best = cal;
    }
    if (!best) return { ok: false, error: "REF1 not found", cands };
    return { ...best, auto: true };
  }

  /** Calibration from circles picked by hand. */
  function manualCalibration(t, photo, c1, c2, mp) {
    const cal = calibrateWith(t, photo, c1, c2, mp);
    cal.auto = false;
    return cal;
  }

  // ---- master correlation (aligned low-res gray patches) ----
  function alignedPatch(photo, frame, box, N = 96, coarse = false) {
    const g = coarse ? photo.graySmall : photo.gray, k = coarse ? 1 / photo.graySmall.f : 1;
    const out = new Float32Array(N * N), st = (box.x1 - box.x0) / N / frame.s / 3 * k;
    const c = Math.cos(frame.th) / frame.s, sn = Math.sin(frame.th) / frame.s;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const mx = box.x0 + (i + 0.5) / N * (box.x1 - box.x0), my = box.y0 + (j + 0.5) / N * (box.y1 - box.y0);
      const px = (frame.ox + mx * c - my * sn) * k, py = (frame.oy + mx * sn + my * c) * k;
      if (coarse) { out[j * N + i] = V().sample(g, px, py); continue; }
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = V().sample(g, px + dx * st, py + dy * st); if (!isNaN(v)) { s += v; n++; } }
      out[j * N + i] = n ? s / n : NaN;
    }
    return out;
  }
  function ncc(a, b) {
    let n = 0, sa = 0, sb = 0;
    const ok = v => v != null && !isNaN(v);
    for (let i = 0; i < a.length; i++) if (ok(a[i]) && ok(b[i])) { n++; sa += a[i]; sb += b[i]; }
    if (n < a.length * 0.3) return -1;
    const ma = sa / n, mb = sb / n; let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) if (ok(a[i]) && ok(b[i])) { const u = a[i] - ma, v = b[i] - mb; sab += u * v; saa += u * u; sbb += v * v; }
    return sab / Math.sqrt(saa * sbb + 1e-9);
  }
  function correlate(mp, photo, frame, coarse = false) {
    if (coarse && mp.coarse) return ncc(mp.coarse, alignedPatch(photo, frame, mp.box, 48, true));
    return ncc(mp.data, alignedPatch(photo, frame, mp.box));
  }
  /** Rotation search around REF1 by image matching: 10° steps, then 2°, then 0.25°. */
  function searchAngle(mp, photo, c1, s, quick = false) {
    const at = th => correlate(mp, photo, { ox: c1.cx, oy: c1.cy, th, s }, true);
    let best = { th: 0, score: -2 };
    for (let d = 0; d < 360; d += 10) { const th = d * D2R, sc = at(th); if (sc > best.score) best = { th, score: sc }; }
    if (quick) return best;
    for (const [span, step] of [[10, 2], [2, 0.25]]) {
      const c0 = best.th;
      for (let d = -span; d <= span; d += step) { const th = c0 + d * D2R, sc = at(th); if (sc > best.score) best = { th, score: sc }; }
    }
    best.th = wrap(best.th);
    return best;
  }
  function corrBox(t) {
    if (t.reportBox) return t.reportBox;
    if (modeOf(t) === "cal" && t.master?.frame && t.master.w) { // central 60 % of the master image
      const f = t.master.frame, q = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]].map(([a, b]) => G().toMm(f, { x: a * t.master.w, y: b * t.master.h }));
      return { x0: Math.min(...q.map(p => p.x)), x1: Math.max(...q.map(p => p.x)), y0: Math.min(...q.map(p => p.y)), y1: Math.max(...q.map(p => p.y)) };
    }
    if (modeOf(t) === "2c" && t.ref.L) { const L = t.ref.L, b = t.ref.beta || 0, c = Math.cos(b), s = Math.sin(b);
      const q = [[-0.6, -0.6], [1.6, -0.6], [1.6, 0.6], [-0.6, 0.6]].map(([x, y]) => ({ x: L * (x * c - y * s), y: L * (x * s + y * c) }));
      return { x0: Math.min(...q.map(p => p.x)), x1: Math.max(...q.map(p => p.x)), y0: Math.min(...q.map(p => p.y)), y1: Math.max(...q.map(p => p.y)) }; }
    const R = 6 * (t.ref.d1 || 4);
    return { x0: -R, x1: R, y0: -R, y1: R };
  }
  // ---- fixed (station) calibration ----
  /** mm per pixel of this photo from a station calibration (s0 = mm per original camera pixel). */
  function stationScale(st, photo) { return st.s0 / (photo.loadScale || 1); }
  /**
   * Is the station calibration usable for this photo? errors block the measurement, warnings make it CHECK.
   * meta = {serial} of the camera that took the photo (if known).
   */
  function checkStation(st, photo, meta) {
    if (!st) return { ok: false, error: "no station calibration for this program: calibrate the station first (📐 Calibration tab)" };
    const k = photo.loadScale || 1, W = Math.round(photo.w / k), H = Math.round(photo.h / k), warnings = [];
    if (Math.abs(W - st.W0) > 2 || Math.abs(H - st.H0) > 2) return { ok: false, error: `image size ${W}×${H} px differs from the station calibration (${st.W0}×${st.H0} px): ROI / binning changed, calibrate again` };
    if (meta?.serial && st.serial && meta.serial !== st.serial) return { ok: false, error: `photo from camera ${meta.serial}, but the station calibration is for camera ${st.serial}` };
    const age = (Date.now() - Date.parse(st.date)) / 864e5;
    if (st.validDays > 0 && age > st.validDays) warnings.push(`station calibration expired: ${new Date(st.date).toLocaleDateString()} (valid ${st.validDays} days) – calibrate again`);
    return { ok: true, warnings };
  }
  /** Calibration of a photo with a station calibration: scale fixed, position from the fixture or by image search. */
  function stationCalibrate(t, photo, mp, st, timing) {
    const chk = checkStation(st, photo, null);
    if (!chk.ok) return { ok: false, error: chk.error };
    const o = t.ref.org;
    if (!o) return { ok: false, error: "program has no origin on the master (reload the master photo)" };
    const k = photo.loadScale || 1, s = stationScale(st, photo), pos = posOf(t);
    let f = { ox: o.x * k, oy: o.y * k, th: 0, s }, search = null;
    if (pos !== "fixture") {
      if (!mp?.coarse) return { ok: false, error: "no master image to find the part" };
      search = searchPose(mp, photo, f, pos === "image", t.ref.searchMm);
      f = search.frame;
      // fine position from the measured features (circle centres, line directions) of the master
      const fa = alignOnFeatures(t, photo, f, pos === "image");
      if (fa) { search.features = fa.used; search.shiftMm = fa.shiftMm; search.turnDeg = fa.turnDeg; search.scale = fa.scale; f = fa.frame; }
    }
    const cal = frameInfo(t, { cx: f.ox, cy: f.oy, r: 0 }, null, f);
    cal.ok = true; cal.auto = true; cal.notes = [];
    cal.ncc = mp ? correlate(mp, photo, f) : null;
    cal.station = stationInfo(st);
    cal.pos = pos; if (search) cal.search = { evals: search.evals, ms: Math.round(search.ms), score: search.score, features: search.features || null, shiftMm: search.shiftMm, turnDeg: search.turnDeg, scale: search.scale || null };
    return cal;
  }
  /** Feature positions of the master (fixed-calibration mode): circle / arc centres and line directions. */
  function setAnchors(t, res) {
    if (modeOf(t) !== "cal" || !res) { if (t.ref) t.ref.anchors = null; return; }
    const a = [];
    for (const el of t.elements) {
      const r = res[el.id]; if (!r || r.error) continue;
      if ((el.tool === "circle" || el.tool === "arc") && r.type === "circle") a.push({ id: el.id, k: "c", x: r.cx, y: r.cy, r: r.r });
      else if (el.tool === "line" && r.type === "line") a.push({ id: el.id, k: "l", a: Math.atan2(r.dy, r.dx) });
    }
    t.ref.anchors = a;
  }
  /**
   * Correct the frame so the measured anchor features sit where they were on the master (rigid, no scale).
   * ≥ 2 circles: best fit of the centres; 1 circle + lines: angle from the lines, position from the circle.
   */
  function alignOnFeatures(t, photo, f0, rotate) {
    const A = t.ref.anchors; if (!A || !A.some(a => a.k === "c")) return null;
    let f = f0, used = [], scale = null;
    for (let it = 0; it < 3; it++) {
      const cal = { frame: f, c1: { cx: f.ox, cy: f.oy, r: 0 }, c2: null }, C = [], L = [];
      for (const a of A) {
        const el = t.elements.find(e => e.id === a.id); if (!el) continue;
        let r; try { r = measureElement(el, photo, cal, {}); } catch (e) { continue; }
        if (!r || r.error) continue;
        if (a.k === "c" && r.type === "circle") C.push({ m: a, x: r.cx, y: r.cy, r: r.r });
        if (a.k === "l" && r.type === "line") L.push(wrap(Math.atan2(r.dy, r.dx) - a.a));
      }
      if (!C.length || (rotate && C.length < 2 && !L.length)) return it ? { frame: f, used, shiftMm: 0, turnDeg: 0 } : null;
      let d = 0;
      if (rotate) {
        if (C.length >= 2) { // Procrustes: rotation between the centred point sets
          const mx = C.reduce((s, c) => s + c.m.x, 0) / C.length, my = C.reduce((s, c) => s + c.m.y, 0) / C.length, px = C.reduce((s, c) => s + c.x, 0) / C.length, py = C.reduce((s, c) => s + c.y, 0) / C.length;
          let sn = 0, cs = 0; for (const c of C) { const ax = c.m.x - mx, ay = c.m.y - my, bx = c.x - px, by = c.y - py; cs += ax * bx + ay * by; sn += ax * by - ay * bx; }
          d = Math.atan2(sn, cs);
          if (L.length && C.length === 2 && Math.hypot(C[0].m.x - C[1].m.x, C[0].m.y - C[1].m.y) < 2) d = L.reduce((s, x) => s + x, 0) / L.length;
        } else d = L.reduce((s, x) => s + x, 0) / L.length;
      }
      const c = Math.cos(d), sn = Math.sin(d);
      let tx = 0, ty = 0; for (const q of C) { tx += q.x - (q.m.x * c - q.m.y * sn); ty += q.y - (q.m.x * sn + q.m.y * c); } tx /= C.length; ty /= C.length;
      const ct = Math.cos(f.th), st = Math.sin(f.th);
      f = { ox: f.ox + (tx * ct - ty * st) / f.s, oy: f.oy + (tx * st + ty * ct) / f.s, th: wrap(f.th + d), s: f.s };
      used = [...C.map(q => q.m.id), ...(rotate ? A.filter(a => a.k === "l").map(a => a.id) : [])];
      // size check: spacing of the centres (≥ 2 circles) or the diameter compared with the master
      scale = null;
      if (C.length >= 2) { let sm = 0, sp = 0; for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) { sm += Math.hypot(C[i].m.x - C[j].m.x, C[i].m.y - C[j].m.y); sp += Math.hypot(C[i].x - C[j].x, C[i].y - C[j].y); } if (sm > 1) scale = { pct: 100 * (sp / sm - 1), from: "spacing" }; }
      if (!scale && C[0].m.r > 0) scale = { pct: 100 * (C[0].r / C[0].m.r - 1), from: "diameter " + C[0].m.id };
      if (Math.hypot(tx, ty) < 1e-4 && Math.abs(d) < 1e-6) break;
    }
    return { frame: f, used: [...new Set(used)], scale, shiftMm: Math.hypot((f.ox - f0.ox) * f.s, (f.oy - f0.oy) * f.s), turnDeg: wrap(f.th - f0.th) * R2D };
  }
  const stationInfo = st => ({ id: st.id, name: st.name || "", serial: st.serial || "", date: st.date, s0: st.s0, rmsUm: st.rmsUm, maxUm: st.maxUm, validDays: st.validDays, by: st.by || "" });
  /** Gray image patch N×N over box (mm) of a frame, sampled from gray image g whose pixels are k × photo pixels. */
  function patchOn(g, k, frame, box, N) {
    const out = new Float32Array(N * N), c = Math.cos(frame.th) / frame.s * k, sn = Math.sin(frame.th) / frame.s * k;
    const ox = frame.ox * k, oy = frame.oy * k, sx = (box.x1 - box.x0) / N, sy = (box.y1 - box.y0) / N;
    for (let j = 0; j < N; j++) { const my = box.y0 + (j + 0.5) * sy; for (let i = 0; i < N; i++) { const mx = box.x0 + (i + 0.5) * sx; out[j * N + i] = V().sample(g, ox + mx * c - my * sn, oy + mx * sn + my * c); } }
    return out;
  }
  /** Gradient magnitude of an N×N patch (central differences; border and missing values = NaN). */
  function gradPatch(a, N) {
    const out = new Float32Array(N * N).fill(NaN), v = i => { const x = a[i]; return x == null ? NaN : x; };
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i, gx = v(k + 1) - v(k - 1), gy = v(k + N) - v(k - N);
      out[k] = Math.hypot(gx, gy);
    }
    return out;
  }
  /** Shrink factor so that the matching box is about 40 pixels wide. */
  const tinyF = (box, s) => Math.max(2, Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) / s / 40));
  /** 2×2 average of an N×N patch (nulls ignored). */
  function halfPatch(a, N) {
    const M = N >> 1, out = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      let s = 0, n = 0;
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = a[(2 * j + dj) * N + 2 * i + di]; if (v != null && !isNaN(v)) { s += v; n++; } }
      out[j * M + i] = n ? s / n : NaN;
    }
    return out;
  }
  /**
   * Find the part (origin position, and the angle if rotate) by matching the master patch: coarse grid on a
   * small image, then hill-climbing on the coarse and the fine patch. f0 = expected frame (fixture position).
   */
  function searchPose(mp, photo, f0, rotate, rangeMm) {
    const t0 = (typeof performance !== "undefined" ? performance : Date).now();
    const box = mp.box, s = f0.s, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const F = tinyF(box, s);
    if (!photo._tiny || photo._tiny.F !== F || photo._tiny.key !== photo.procKey) photo._tiny = { F, key: photo.procKey, g: V().shrink(photo.gray, F) };
    const tiny = photo._tiny.g, small = photo.graySmall, N0 = 24, ref0 = mp.tiny ? Float32Array.from(mp.tiny, v => (v == null ? NaN : v)) : halfPatch(mp.coarse, 48);
    let evals = 0;
    // edges (gradient) are compared, not brightness: robust against lighting and shading differences
    const g0 = gradPatch(ref0, N0), g1 = gradPatch(mp.coarse, 48), g2 = gradPatch(mp.data, 96);
    const score = (f, lvl) => { evals++;
      if (lvl === 0) return ncc(g0, gradPatch(patchOn(tiny, 1 / F, f, box, N0), N0));
      if (lvl === 1) return ncc(g1, gradPatch(patchOn(small, 1 / small.f, f, box, 48), 48));
      return ncc(g2, gradPatch(alignedPatch(photo, f, box), 96)); };
    const W = photo.w * s, H = photo.h * s, R = rangeMm > 0 ? rangeMm : 0.6 * Math.max(W, H);
    const step = Math.max(bw, bh) / 16, ths = rotate ? Array.from({ length: 36 }, (_, i) => i * 10 * D2R) : [0];
    // parameters: (dx, dy) = shift of the box centre in mm, th = rotation around the box centre
    const bc = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, c0 = G().toPx(f0, bc);
    const at = (dx, dy, th) => { const cx = c0.x + dx / s, cy = c0.y + dy / s, c = Math.cos(th), sn = Math.sin(th);
      return { ox: cx - (bc.x * c - bc.y * sn) / s, oy: cy - (bc.x * sn + bc.y * c) / s, th, s }; };
    const list = [];
    for (let dy = -R; dy <= R + 1e-9; dy += step) for (let dx = -R; dx <= R + 1e-9; dx += step) {
      const cx = c0.x + dx / s, cy = c0.y + dy / s;
      if (cx < 0 || cy < 0 || cx > photo.w || cy > photo.h) continue; // box centre must be inside the photo
      for (const th of ths) { const sc = score(at(dx, dy, th), 0); if (sc > -1) list.push({ dx, dy, th, sc }); }
    }
    if (!list.length) return { frame: f0, score: -1, evals, ms: 0 };
    list.sort((a, b) => b.sc - a.sc);
    const top = [];
    for (const c of list) { if (top.length >= 8) break; if (top.every(o => Math.hypot(o.dx - c.dx, o.dy - c.dy) > 1.5 * step || Math.abs(wrap(o.th - c.th)) > 15 * D2R)) top.push(c); }
    const climb = (c, lvl, d0, a0, d1, a1) => {
      let best = { ...c, sc: score(at(c.dx, c.dy, c.th), lvl) }, d = d0, a = rotate ? a0 : 0;
      while (d >= d1 || a >= a1) {
        let moved = false;
        const tries = [];
        if (d >= d1) tries.push([d, 0, 0], [-d, 0, 0], [0, d, 0], [0, -d, 0], [d, d, 0], [-d, -d, 0], [d, -d, 0], [-d, d, 0]);
        if (a >= a1) tries.push([0, 0, a], [0, 0, -a]);
        for (const [ex, ey, ea] of tries) {
          const q = { dx: best.dx + ex, dy: best.dy + ey, th: best.th + ea }, sc = score(at(q.dx, q.dy, q.th), lvl);
          if (sc > best.sc) { best = { ...q, sc }; moved = true; }
        }
        if (!moved) { d /= 2; a /= 2; if (d < d1 && a < a1) break; }
      }
      return best;
    };
    let best = null;
    for (const c of top) { const r = climb(c, 1, step / 2, 6 * D2R, step / 24, 0.2 * D2R); if (!best || r.sc > best.sc) best = r; }
    best = climb(best, 2, step / 12, 0.5 * D2R, Math.max(s * 0.05, step / 600), 0.005 * D2R);
    const ms = (typeof performance !== "undefined" ? performance : Date).now() - t0;
    return { frame: at(best.dx, best.dy, rotate ? wrap(best.th) : 0), score: best.sc, evals, ms };
  }

  /** Low-res aligned gray patches of the master (fine + coarse), used to find/verify the alignment of new photos. */
  function masterPatch(t, masterPhoto, frame) {
    const box = corrBox(t), r = v => (isNaN(v) ? null : Math.round(v));
    const mp = { box, data: Array.from(alignedPatch(masterPhoto, frame, box), r), coarse: Array.from(alignedPatch(masterPhoto, frame, box, 48, true), r) };
    if (modeOf(t) === "cal") { // very small patch made like the one of a new photo (for the position search)
      const F = tinyF(box, frame.s), g = V().shrink(masterPhoto.gray, F);
      mp.tiny = Array.from(patchOn(g, 1 / F, frame, box, 24), r);
    }
    return mp;
  }

  // ---- appearance (master vs workpiece) ----
  function regionPts(t, frame, n = 48) {
    const b = corrBox(t), out = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(G().toPx(frame, { x: b.x0 + (i + 0.5) / n * (b.x1 - b.x0), y: b.y0 + (j + 0.5) / n * (b.y1 - b.y0) }));
    return out;
  }
  function grayStats(gray, pts) {
    let n = 0, s = 0, s2 = 0;
    for (const p of pts) { const v = V().sample(gray, p.x, p.y); if (!isNaN(v)) { n++; s += v; s2 += v * v; } }
    const m = n ? s / n : 0; return { mean: m, std: n ? Math.sqrt(Math.max(0, s2 / n - m * m)) : 0 };
  }
  function sharpOf(t, photo, frame) {
    const box = corrBox(t);
    const q = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([x, y]) => G().toPx(frame, { x, y }));
    const xs = q.map(p => p.x), ys = q.map(p => p.y);
    return V().sharpness(photo.gray, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  /** Appearance of the part area: raw brightness/contrast/colour, processed gray stats, sharpness, scale. */
  function appearanceOf(t, photo, cal) {
    const pts = regionPts(t, cal.frame), a = V().appearance(photo, pts) || {};
    const g = grayStats(photo.gray, pts);
    return { ...a, gmean: g.mean, gstd: g.std, sharp: sharpOf(t, photo, cal.frame), pxPerMm: cal.pxPerMm, th: cal.frame.th };
  }
  /** Differences of a workpiece photo vs the master. */
  function diffVsMaster(m, p) {
    if (!m || !p || p.mean == null || m.mean == null) return null;
    const dE = m.lab && p.lab ? Math.hypot(m.lab[0] - p.lab[0], m.lab[1] - p.lab[1], m.lab[2] - p.lab[2]) : null;
    return {
      brightness: p.mean - m.mean, brightnessPct: 100 * (p.mean - m.mean) / Math.max(1, m.mean),
      contrastRatio: m.std ? p.std / m.std : null, dE, rgbM: m.rgb, rgbP: p.rgb,
      scaleRatio: m.pxPerMm ? p.pxPerMm / m.pxPerMm : null,
      sharpRatio: m.sharp ? p.sharp / m.sharp : null,
      angleDeg: m.th != null ? wrap(p.th - m.th) * R2D : null,
    };
  }
  /** Copy of the gray image with brightness/contrast of the part area matched to the master. */
  function matchedGray(t, photo, cal) {
    const m = t.master?.stats; if (!m || !m.gstd) return null;
    const g = grayStats(photo.gray, regionPts(t, cal.frame, 32));
    if (!g.std) return null;
    const gain = m.gstd / g.std, off = m.gmean - g.mean * gain, lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round(v * gain + off)));
    const src = photo.gray.data, out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = lut[src[i]];
    return { gray: { w: photo.gray.w, h: photo.gray.h, data: out }, gain, off };
  }

  // ---------------- element tools ----------------
  /**
   * Execute all elements on a photo with calibration cal. ov = per-photo search-area overrides {id: roi}.
   * Returns map id -> result (mm).
   */
  function runElements(t, photo, cal, ov, eov) {
    const out = {}, eff = el0 => {
      let el = el0;
      if (ov && ov[el0.id]) el = { ...el, roi: ov[el0.id] };
      if (eov && eov[el0.id]) el = { ...el, edge: { ...(el0.edge || defaultEdge()), ...eov[el0.id] } };
      return el;
    };
    const ctx = { wb: whiteBalance(t, photo, cal, eff) };
    for (const el0 of t.elements) {
      const el = eff(el0);
      let r;
      try { r = measureElement(el, photo, cal, out, ctx); } catch (err) { r = { error: String(err.message || err) }; }
      out[el.id] = r;
    }
    return out;
  }

  // ---- colour points ----
  /** Mean colour inside a circle (px). */
  function sampleColor(photo, c, rp) {
    const d = photo.rgba, w = photo.w, h = photo.h, R = Math.max(1, rp), st = Math.max(1, R / 12);
    let n = 0, sr = 0, sg = 0, sb = 0, s2 = 0;
    for (let y = -R; y <= R; y += st) for (let x = -R; x <= R; x += st) {
      if (x * x + y * y > R * R) continue;
      const X = Math.round(c.x + x), Y = Math.round(c.y + y);
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = (Y * w + X) * 4, r = d[j], g = d[j + 1], b = d[j + 2];
      sr += r; sg += g; sb += b; s2 += r * r + g * g + b * b; n++;
    }
    if (!n) return null;
    const rgb = [sr / n, sg / n, sb / n];
    return { rgb, n, std: Math.sqrt(Math.max(0, s2 / n - (rgb[0] ** 2 + rgb[1] ** 2 + rgb[2] ** 2)) / 3) };
  }
  const lab = rgb => V().toLab(rgb.map(v => Math.max(0, Math.min(255, v))));
  /** Per-channel gains from white/gray reference points: photo colours -> master lighting. */
  function whiteBalance(t, photo, cal, eff) {
    const refs = t.elements.filter(e => e.tool === "color" && e.white && e.ref);
    if (!refs.length || !photo.rgba) return null;
    let g = [0, 0, 0], n = 0;
    for (const e0 of refs) {
      const e = eff(e0), c = G().toPx(cal.frame, { x: e.roi.cx, y: e.roi.cy }), sm = sampleColor(photo, c, e.roi.r / cal.frame.s);
      if (!sm) continue;
      for (let k = 0; k < 3; k++) g[k] += e.ref.raw[k] / Math.max(1, sm.rgb[k]);
      n++;
    }
    return n ? g.map(v => v / n) : null;
  }
  function colorResult(el, photo, cal, ctx) {
    const f = cal.frame, c = G().toPx(f, { x: el.roi.cx, y: el.roi.cy }), sm = sampleColor(photo, c, el.roi.r / f.s);
    if (!sm) return { error: "colour area outside the photo" };
    const wb = !el.white && ctx && ctx.wb;
    const rgb = wb ? sm.rgb.map((v, k) => Math.min(255, v * wb[k])) : sm.rgb, L = lab(rgb);
    const r = { type: "color", x: el.roi.cx, y: el.roi.cy, r: el.roi.r, rgb, raw: sm.rgb, lab: L, std: sm.std, wb: !!wb, white: !!el.white };
    if (el.ref) { const R = el.ref.lab; r.dE = Math.hypot(L[0] - R[0], L[1] - R[1], L[2] - R[2]); r.dL = L[0] - R[0]; r.da = L[1] - R[1]; r.db = L[2] - R[2]; }
    return r;
  }
  /** Teach (store) the reference colour of a colour element from a measured result. */
  function teachColor(el, r) {
    if (!r || r.error || r.type !== "color") return false;
    el.ref = { rgb: r.rgb.map(v => +v.toFixed(2)), raw: r.raw.map(v => +v.toFixed(2)), lab: r.lab.map(v => +v.toFixed(3)), at: new Date().toISOString() };
    return true;
  }

  /** Measure one element. photo.gray is used; cal.frame maps mm <-> px. */
  function measureElement(el, photo, cal, out, ctx) {
    const f = cal.frame;
    if (el.tool === "color") return colorResult(el, photo, cal, ctx);
    if (el.tool === "ocr") return { type: "text", x: el.roi.cx, y: el.roi.cy, pending: true, text: "", conf: 0 };
    const tm = p => G().toMm(f, p), tp = m => G().toPx(f, m);
    let r = null;
    if (el.tool === "ref") {
      const c = el.which === 1 ? cal.c1 : cal.c2;
      if (!c) return { error: "not used (1-circle mode)" };
      const cm = tm({ x: c.cx, y: c.cy });
      return { type: "circle", cx: cm.x, cy: cm.y, r: c.r * f.s, rms: (c.rms || 0) * f.s };
    }
    if (el.tool === "circle" || el.tool === "arc") {
      const c = tp({ x: el.roi.cx, y: el.roi.cy }), rp = el.roi.r / f.s, bp = Math.max(4, el.roi.band / f.s);
      const e = el.edge || defaultEdge();
      // arc angles are stored in part frame (deg); convert to image angles
      const a0 = el.tool === "arc" ? el.roi.a0 * D2R + f.th : 0, a1 = el.tool === "arc" ? el.roi.a1 * D2R + f.th : 2 * Math.PI;
      const pts = V().scanRing(photo.gray, { cx: c.x, cy: c.y, r0: Math.max(1, rp - bp), r1: rp + bp, n: el.n || (el.tool === "arc" ? 36 : 72), a0, a1, polarity: e.polarity, select: e.select, thr: e.thr, dir: e.dir });
      const need = el.tool === "arc" ? 5 : 8;
      if (pts.length >= need) {
        const mm = pts.map(tm);
        const fit = robust(mm, "circle", el.edge);
        const nr = el.n || (el.tool === "arc" ? 36 : 72), lo = Math.max(0, el.roi.r - el.roi.band) * 0.6, hi = (el.roi.r + el.roi.band) * 1.4;
        if (fit && (fit.r < lo || fit.r > hi)) return { error: `no circle of this size in the search area (fit Ø ${(2 * fit.r).toFixed(2)})` };
        if (fit && fit.inliers.length < 0.3 * nr) return { error: `too few edge points (${Math.round(100 * fit.inliers.length / nr)} %)` };
        if (fit) r = { type: "circle", cx: fit.cx, cy: fit.cy, r: fit.r, rms: fit.rms, roundness: fit.roundness, pts: fit.inliers, rejected: mm.length - fit.inliers.length, nScan: el.n || 72, arc: el.tool === "arc" ? [el.roi.a0, el.roi.a1] : null };
      }
      return r || { error: "edge not found (" + pts.length + " pts)" };
    }
    if (el.tool === "line") {
      const e = el.edge || defaultEdge();
      const pts = V().scanRect(photo.gray, { p0: tp(el.roi.p0), p1: tp(el.roi.p1), hw: el.roi.hw / f.s, side: el.roi.side || 1, n: el.n || 30, polarity: e.polarity, select: e.select, thr: e.thr, width: 5 });
      if (pts.length >= 4) {
        const mm = pts.map(tm);
        const fit = robust(mm, "line", el.edge);
        if (fit) {
          // orient along ROI p0 -> p1
          const ux = el.roi.p1.x - el.roi.p0.x, uy = el.roi.p1.y - el.roi.p0.y;
          let dx = fit.dx, dy = fit.dy; if (dx * ux + dy * uy < 0) { dx = -dx; dy = -dy; }
          const ts = fit.inliers.map(p => (p.x - fit.px) * dx + (p.y - fit.py) * dy);
          r = { type: "line", px: fit.px, py: fit.py, dx, dy, t0: Math.min(...ts), t1: Math.max(...ts), rms: fit.rms, straightness: fit.straightness, pts: fit.inliers, rejected: mm.length - fit.inliers.length };
        }
      }
      return r || { error: "edge not found (" + pts.length + " pts)" };
    }
    if (el.tool === "point") {
      const e = el.edge || defaultEdge();
      const hit = V().scanRay(photo.gray, tp(el.roi.p0), tp(el.roi.p1), { polarity: e.polarity, select: e.select, thr: e.thr, width: Math.max(3, Math.round((el.roi.w || 0.3) / f.s)) });
      if (hit) { const m = tm(hit); return { type: "point", x: m.x, y: m.y, pts: [m] }; }
      return { error: "edge not found" };
    }
    return construct(el, out);
  }

  function robust(mm, kind, edge) {
    const outl = !edge || edge.outliers !== false;
    if (kind === "circle") {
      let fit = outl ? G().ransacCircle(mm, 0.05, 250) : G().fitCircle(mm);
      if (!fit) fit = G().fitCircle(mm);
      let set = mm;
      if (fit && outl) {
        for (let i = 0; i < 3; i++) {
          const tol = Math.max(0.02, 2.5 * fit.rms);
          const s2 = mm.filter(p => Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r) < tol);
          if (s2.length < 5) break; set = s2; const f2 = G().fitCircle(set); if (!f2) break; fit = f2;
        }
      }
      if (fit) fit.inliers = set;
      return fit;
    }
    let fit = outl ? G().ransacLine(mm, 0.05, 250) : G().fitLine(mm), set = mm;
    if (fit && outl) {
      for (let i = 0; i < 3; i++) {
        const tol = Math.max(0.02, 2.5 * fit.rms);
        const s2 = mm.filter(p => G().pointLineDist(p, fit) < tol);
        if (s2.length < 3) break; set = s2; const f2 = G().fitLine(set); if (!f2) break; fit = f2;
      }
    }
    if (fit) fit.inliers = set;
    return fit;
  }

  function P(r) { if (!r || r.error) return null; return G().pointOf(r); }
  function Lin(r) { return r && !r.error && r.type === "line" ? r : null; }
  function mkLine(px, py, dx, dy, t0 = -1, t1 = 1) { const n = Math.hypot(dx, dy); return { type: "line", px, py, dx: dx / n, dy: dy / n, t0, t1 }; }

  function construct(el, out) {
    const A = out[el.args?.[0]], B = out[el.args?.[1]], C = out[el.args?.[2]];
    const need = (...xs) => { if (xs.some(x => !x)) throw new Error("input element missing or failed"); };
    switch (el.tool) {
      case "mid": { const a = P(A), b = P(B); need(a, b); return { type: "point", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
      case "intersect": { const a = Lin(A), b = Lin(B); need(a, b); const p = G().lineIntersect(a, b); if (!p) throw new Error("lines are parallel"); return { type: "point", ...p }; }
      case "foot": { const a = P(A), l = Lin(B); need(a, l); const t = (a.x - l.px) * l.dx + (a.y - l.py) * l.dy; return { type: "point", x: l.px + t * l.dx, y: l.py + t * l.dy }; }
      case "line2p": { const a = P(A), b = P(B); need(a, b); const L = Math.hypot(b.x - a.x, b.y - a.y); return mkLine(a.x, a.y, b.x - a.x, b.y - a.y, 0, L); }
      case "circle3p": { const a = P(A), b = P(B), c = P(C); need(a, b, c); const k = G().circle3(a, b, c); if (!k) throw new Error("points are collinear"); return { type: "circle", ...k }; }
      case "parallel": { const l = Lin(A), p = P(B); need(l, p); return mkLine(p.x, p.y, l.dx, l.dy, l.t0 - ((p.x - l.px) * l.dx + (p.y - l.py) * l.dy), l.t1 - ((p.x - l.px) * l.dx + (p.y - l.py) * l.dy)); }
      case "perp": { const l = Lin(A), p = P(B); need(l, p); const h = Math.max(1, (l.t1 - l.t0) / 2); return mkLine(p.x, p.y, -l.dy, l.dx, -h, h); }
      case "bisector": {
        const a = Lin(A), b = Lin(B); need(a, b);
        let bx = b.dx, by = b.dy; if (a.dx * bx + a.dy * by < 0) { bx = -bx; by = -by; }
        const p = G().lineIntersect(a, b);
        if (!p) { const mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2; return mkLine(mx, my, a.dx, a.dy, a.t0, a.t1); }
        const h = Math.max(a.t1 - a.t0, b.t1 - b.t0) / 2;
        return mkLine(p.x, p.y, a.dx + bx, a.dy + by, -h, h);
      }
    }
    throw new Error("unknown tool " + el.tool);
  }

  // ---------------- datum ----------------
  function datumOf(t, res) {
    const d = t.datum || { origin: "REF1", axis: "REF2", yUp: true };
    // (axis element missing, e.g. REF2 in 1-circle mode -> X axis of the part frame)
    const o = P(res[d.origin]) || P(res.REF1) || { x: 0, y: 0 };
    let th = 0;
    const ax = res[d.axis];
    if (ax && !ax.error) {
      if (ax.type === "line") th = Math.atan2(ax.dy, ax.dx);
      else { const p = P(ax); if (p && Math.hypot(p.x - o.x, p.y - o.y) > 1e-6) th = Math.atan2(p.y - o.y, p.x - o.x); }
    }
    const c = Math.cos(th), s = Math.sin(th), ys = d.yUp === false ? 1 : -1;
    return {
      o, th, ys,
      fwd: p => { const dx = p.x - o.x, dy = p.y - o.y; return { x: dx * c + dy * s, y: ys * (-dx * s + dy * c) }; },
      inv: q => { const x = q.x, y = q.y * ys; return { x: o.x + x * c - y * s, y: o.y + x * s + y * c }; },
    };
  }

  // ---------------- dimensions ----------------
  // ---- specifications ----
  // numeric ops: tol (nominal +tolP / -tolM), range (v1..v2), >, <, >=, <=, == (v1 ± eps), != ; none = info only
  // text ops: ==, !=, contains, starts, ends, regex, format (OCR character format fulfilled), none
  const NUM_OPS = ["tol", "range", ">", "<", ">=", "<=", "==", "!=", "none"];
  const TEXT_OPS = ["==", "!=", "contains", "starts", "ends", "regex", "format", "none"];
  /** Normalised spec of a dimension (older programs stored nom/tolP/tolM only). */
  function specOf(dm) {
    const k = DIMS[dm.kind] || {};
    if (dm.spec && dm.spec.op) return dm.spec;
    if (k.text) return { op: "format" };
    if (dm.kind === "position") return { op: "<=", v1: dm.tolP ?? null };
    if (k.form) return dm.tolP != null ? { op: "<=", v1: dm.tolP } : { op: "none" };
    if (num(dm.nom) != null && (num(dm.tolP) != null || num(dm.tolM) != null)) return { op: "tol" };
    return { op: "none" };
  }
  /** Replace {DM} / {DM:a-b} / {Tn} in expected text by the DataMatrix serial or another text result. */
  function expandText(v, ctx) {
    return String(v ?? "").replace(/\{(DM|T\d+)(?::(\d+)-(\d+))?\}/g, (m, key, a, b) => {
      const src = key === "DM" ? ctx.dm || "" : (ctx.res?.[key]?.text || "");
      return a != null ? src.slice(+a, +b) : src;
    });
  }
  /** Status of a value against a spec: "OK", "NG" or "—" (no spec). */
  function judge(dm, v, ctx = {}) {
    const sp = specOf(dm), op = sp.op;
    if (op === "none" || v == null) return "—";
    if ((DIMS[dm.kind] || {}).text) {
      const t = String(v), e = expandText(sp.v1, ctx);
      const ci = sp.ci ? (x => x.toUpperCase()) : (x => x);
      switch (op) {
        case "==": return ci(t) === ci(e) ? "OK" : "NG";
        case "!=": return ci(t) !== ci(e) ? "OK" : "NG";
        case "contains": return ci(t).includes(ci(e)) ? "OK" : "NG";
        case "starts": return ci(t).startsWith(ci(e)) ? "OK" : "NG";
        case "ends": return ci(t).endsWith(ci(e)) ? "OK" : "NG";
        case "regex": try { return new RegExp(e, sp.ci ? "i" : "").test(t) ? "OK" : "NG"; } catch (x) { return "NG"; }
        case "format": return ctx.formatOk ? "OK" : "NG";
      }
      return "—";
    }
    const x = +v, a = num(sp.v1), b = num(sp.v2), eps = num(sp.eps) ?? 0, E9 = 1e-9;
    switch (op) {
      case "tol": {
        const nom = num(dm.nom), tp = num(dm.tolP), tm = num(dm.tolM);
        if (nom == null || (tp == null && tm == null)) return "—";
        const lo = nom - Math.abs(tm ?? tp), hi = nom + Math.abs(tp ?? tm);
        return x >= lo - E9 && x <= hi + E9 ? "OK" : "NG";
      }
      case "range": if (a == null && b == null) return "—"; return (a == null || x >= a - E9) && (b == null || x <= b + E9) ? "OK" : "NG";
      case ">": return a == null ? "—" : x > a ? "OK" : "NG";
      case "<": return a == null ? "—" : x < a ? "OK" : "NG";
      case ">=": return a == null ? "—" : x >= a - E9 ? "OK" : "NG";
      case "<=": return a == null ? "—" : x <= a + E9 ? "OK" : "NG";
      case "==": return a == null ? "—" : Math.abs(x - a) <= eps + E9 ? "OK" : "NG";
      case "!=": return a == null ? "—" : Math.abs(x - a) > eps + E9 ? "OK" : "NG";
    }
    return "—";
  }
  /** Short text of a spec, e.g. "4.000 +0.1/−0.1", "2.9 … 3.1", "≥ 0.5", "= 4 ±0.01", "contains DZZ". */
  function specText(dm) {
    const sp = specOf(dm), op = sp.op, f = v => (v == null || v === "" ? "?" : v);
    if ((DIMS[dm.kind] || {}).text) {
      const q = `"${sp.v1 ?? ""}"`;
      return { "==": "= " + q, "!=": "≠ " + q, contains: "contains " + q, starts: "starts with " + q, ends: "ends with " + q, regex: "matches /" + (sp.v1 ?? "") + "/", format: "format OK", none: "" }[op] ?? "";
    }
    switch (op) {
      case "tol": return dm.nom == null ? "" : `${dm.nom} +${dm.tolP ?? dm.tolM}/−${dm.tolM ?? dm.tolP}`;
      case "range": return `${f(sp.v1)} … ${f(sp.v2)}`;
      case ">": return `> ${f(sp.v1)}`; case "<": return `< ${f(sp.v1)}`;
      case ">=": return `≥ ${f(sp.v1)}`; case "<=": return `≤ ${f(sp.v1)}`;
      case "==": return `= ${f(sp.v1)}${num(sp.eps) ? " ±" + sp.eps : ""}`;
      case "!=": return `≠ ${f(sp.v1)}${num(sp.eps) ? " ±" + sp.eps : ""}`;
    }
    return "";
  }

  function evalDims(t, res, ctx = {}) {
    const D = datumOf(t, res), out = {};
    for (const dm of t.dims) {
      let v = null, err = null, draw = null, extra = {};
      try { ({ v, draw, ...extra } = evalDim(dm, res, D)); } catch (e) { err = String(e.message || e); }
      let status;
      if (v != null && (typeof v === "string" || !isNaN(v))) status = judge(dm, v, { ...ctx, res, formatOk: extra.formatOk });
      else status = "ERR";
      const sp = specOf(dm);
      const ref = sp.op === "tol" ? num(dm.nom) : sp.op === "==" ? num(sp.v1) : null;
      out[dm.id] = { v, err, status, draw, dev: typeof v === "number" && ref != null ? v - ref : null, ...extra };
    }
    return out;
  }
  const num = x => (x === "" || x == null || isNaN(+x) ? null : +x);

  function evalDim(dm, res, D) {
    const A = res[dm.a], B = res[dm.b];
    const ok = r => r && !r.error;
    if (!ok(A)) throw new Error("element " + dm.a + " not measured");
    if (dm.b && !ok(B)) throw new Error("element " + dm.b + " not measured");
    const pa = P(A), pb = B ? P(B) : null;
    switch (dm.kind) {
      case "distance": {
        if (!B) throw new Error("needs 2 elements");
        if (A.type === "line" && B.type === "line") {
          const m = lineMid(A), d = G().pointLineDist(m, B), f = footOn(m, B);
          return { v: d, draw: { kind: "seg", a: m, b: f } };
        }
        if (A.type === "line" || B.type === "line") {
          const l = A.type === "line" ? A : B, p = A.type === "line" ? pb : pa, f = footOn(p, l);
          return { v: G().pointLineDist(p, l), draw: { kind: "seg", a: p, b: f } };
        }
        const qa = D.fwd(pa), qb = D.fwd(pb);
        if (dm.axis === "x") return { v: Math.abs(qb.x - qa.x), draw: { kind: "axis", a: pa, b: pb, ax: "x", D } };
        if (dm.axis === "y") return { v: Math.abs(qb.y - qa.y), draw: { kind: "axis", a: pa, b: pb, ax: "y", D } };
        return { v: Math.hypot(pb.x - pa.x, pb.y - pa.y), draw: { kind: "seg", a: pa, b: pb } };
      }
      case "x": { if (!pa) throw new Error("not a point"); return { v: D.fwd(pa).x, draw: { kind: "coord", p: pa, ax: "x", D } }; }
      case "y": { if (!pa) throw new Error("not a point"); return { v: D.fwd(pa).y, draw: { kind: "coord", p: pa, ax: "y", D } }; }
      case "diameter": case "radius": case "area": {
        if (A.type !== "circle") throw new Error("not a circle");
        const v = dm.kind === "diameter" ? 2 * A.r : dm.kind === "radius" ? A.r : Math.PI * A.r * A.r;
        return { v, draw: { kind: "circ", c: A } };
      }
      case "angle": {
        if (A.type !== "line") throw new Error("not a line");
        let v;
        if (B) {
          if (B.type !== "line") throw new Error("not a line");
          v = Math.acos(Math.max(-1, Math.min(1, A.dx * B.dx + A.dy * B.dy))) * R2D; // 0..180 using line directions
          if (dm.acute !== false && v > 90) v = 180 - v;
          const p = G().lineIntersect(A, B) || lineMid(A);
          return { v, draw: { kind: "ang", p, a: A, b: B } };
        }
        // angle to datum X axis, -90..90
        const q0 = D.fwd({ x: A.px, y: A.py }), q1 = D.fwd({ x: A.px + A.dx, y: A.py + A.dy });
        v = Math.atan2(q1.y - q0.y, q1.x - q0.x) * R2D; if (v > 90) v -= 180; if (v < -90) v += 180;
        return { v, draw: { kind: "ang", p: lineMid(A), a: A } };
      }
      case "roundness": { if (A.type !== "circle") throw new Error("not a circle"); if (A.roundness == null) throw new Error("constructed circle has no form"); return { v: A.roundness, draw: { kind: "circ", c: A } }; }
      case "straightness": { if (A.type !== "line" || A.straightness == null) throw new Error("needs a measured line"); return { v: A.straightness, draw: { kind: "line", l: A } }; }
      case "parallelism": case "perpendicularity": {
        if (A.type !== "line" || !A.pts) throw new Error("A must be a measured line");
        if (!B || B.type !== "line") throw new Error("datum B must be a line");
        // zone: band width of A's points, orthogonal to the reference direction
        const ux = dm.kind === "parallelism" ? B.dx : -B.dy, uy = dm.kind === "parallelism" ? B.dy : B.dx;
        let mn = Infinity, mx = -Infinity;
        for (const p of A.pts) { const d = -p.x * uy + p.y * ux; mn = Math.min(mn, d); mx = Math.max(mx, d); }
        return { v: mx - mn, draw: { kind: "line", l: A } };
      }
      case "position": {
        if (!pa) throw new Error("not a point");
        const q = D.fwd(pa), nx = num(dm.nomX) ?? 0, ny = num(dm.nomY) ?? 0;
        return { v: 2 * Math.hypot(q.x - nx, q.y - ny), draw: { kind: "pos", p: pa, n: D.inv({ x: nx, y: ny }) } };
      }
      case "text": {
        if (A.type !== "text") throw new Error("not a text area");
        if (A.pending) throw new Error("text not read yet");
        if (!A.text) throw new Error("no text found");
        return { v: A.text, formatOk: A.formatOk, draw: { kind: "text", c: A } };
      }
      case "color": {
        if (A.type !== "color") throw new Error("not a colour point");
        if (A.dE == null) throw new Error("colour not taught");
        return { v: A.dE, draw: { kind: "color", c: A } };
      }
      case "colordiff": {
        if (A.type !== "color" || !B || B.type !== "color") throw new Error("needs 2 colour points");
        return { v: Math.hypot(A.lab[0] - B.lab[0], A.lab[1] - B.lab[1], A.lab[2] - B.lab[2]), draw: { kind: "seg", a: pa, b: pb } };
      }
      case "concentricity": {
        if (A.type !== "circle" || !B || B.type !== "circle") throw new Error("needs 2 circles");
        return { v: 2 * Math.hypot(A.cx - B.cx, A.cy - B.cy), draw: { kind: "seg", a: pa, b: pb } };
      }
    }
    throw new Error("unknown dimension " + dm.kind);
  }
  const lineMid = l => { const t = (l.t0 + l.t1) / 2; return { x: l.px + t * l.dx, y: l.py + t * l.dy }; };
  const footOn = (p, l) => { const t = (p.x - l.px) * l.dx + (p.y - l.py) * l.dy; return { x: l.px + t * l.dx, y: l.py + t * l.dy }; };

  // ---------------- whole run ----------------
  /**
   * Measure one photo with a template. cal may be supplied (manual fix) otherwise auto.
   * Returns item.result {cal, elements, dims, status, warnings, quality}.
   */
  async function measure(t, photo, opt = {}) {
    const warnings = [];
    const T = opt.timing || null, now = () => (typeof performance !== "undefined" ? performance : Date).now();
    let tl = now();
    const lap = k => { if (!T) return; const x = now(); T[k] = (T[k] || 0) + (x - tl); tl = x; };
    const mp = opt.masterPatch || t.master?.patch;
    const fixed = modeOf(t) === "cal";
    let stWarn = [];
    if (fixed) {
      const chk = checkStation(opt.station, photo, opt.meta);
      if (!chk.ok) return { status: "FAIL", cal: { ok: false, error: chk.error }, warnings: [chk.error], elements: {}, dims: {} };
      stWarn = chk.warnings;
    }
    let cal = opt.cal;
    if (!cal) cal = await autoCalibrate(t, photo, mp, opt.station);
    lap("align");
    if (!cal || !cal.ok) return { status: "FAIL", cal, warnings: [cal?.error || "calibration failed"], elements: {}, dims: {} };
    const two = modeOf(t) === "2c";
    for (const w of stWarn) warnings.push(w);
    let sizeOff = false;
    const sc = cal.search?.scale;
    if (fixed && sc && Math.abs(sc.pct) > (sc.from === "spacing" ? 1 : 4)) { sizeOff = true; warnings.push(`part looks ${sc.pct > 0 ? "larger" : "smaller"} than the master by ${Math.abs(sc.pct).toFixed(1)} % (${sc.from}): part height, camera distance or focus changed, or wrong part – the fixed calibration is not valid for it`); }
    if (cal.pxPerMm < (t.ref.minPxPerMm || 20)) warnings.push(`low resolution: ${cal.pxPerMm.toFixed(1)} px/mm (< ${t.ref.minPxPerMm || 20})`);
    if (two && Math.abs(cal.scaleDiffPct) > 3) warnings.push(`reference diameters disagree with spacing by ${cal.scaleDiffPct.toFixed(1)}% (tilt, wrong hole, or perspective)`);
    if (cal.auto && cal.ncc != null && cal.ncc < 0.35) warnings.push(fixed ? `low match with master image (${cal.ncc.toFixed(2)}): part missing, wrong part or wrong position` : `low match with master image (${cal.ncc.toFixed(2)}): check REF1${two ? "/REF2" : " and rotation"}`);
    if (cal.ambiguous && cal.auto && rotOf(t) === "ref2") warnings.push("REF1 and REF2 have similar size: orientation decided by image match");
    for (const n of cal.notes || []) warnings.push(n);
    // appearance before any correction
    const app = appearanceOf(t, photo, cal);
    const diff = diffVsMaster(t.master?.stats, app);
    // optional brightness/contrast matching to the master for the edge scans
    let work = photo, match = null;
    if (t.proc?.matchMaster || opt.matchMaster) {
      const mg = matchedGray(t, photo, cal);
      if (mg) { work = { ...photo, gray: mg.gray }; match = { gain: mg.gain, offset: mg.off }; }
    }
    lap("prep");
    const elements = runElements(t, work, cal, opt.ov, opt.eov);
    lap("tools");
    await readTexts(t, photo, cal, elements, opt.ov);
    lap("ocr");
    const dm = opt.dm !== undefined ? opt.dm : readCode(t, photo, cal);
    lap("code");
    const dims = evalDims(t, elements, { dm });
    for (const el of t.elements) if (elements[el.id]?.error && !(el.tool === "ref" && !two)) warnings.push(`${el.id}: ${elements[el.id].error}`);
    const who = opt.user ? ` (by ${opt.user})` : "";
    if (opt.ov && Object.keys(opt.ov).length) warnings.push(`search area adjusted by hand${who}: ${Object.keys(opt.ov).join(", ")}`);
    if (opt.eov && Object.keys(opt.eov).length) warnings.push(`edge settings changed for this photo${who}: ${Object.keys(opt.eov).join(", ")}`);
    if (app.sharp < 4) warnings.push(`photo may be blurred (sharpness ${app.sharp.toFixed(0)})`);
    const st = Object.values(dims).map(d => d.status);
    // a doubtful alignment makes every value doubtful: ask the user to check instead of judging NG/OK
    const doubtful = (two && Math.abs(cal.scaleDiffPct) > 8) || (cal.auto && cal.ncc != null && cal.ncc < 0.35) || stWarn.length > 0 || sizeOff;
    const status = doubtful ? "CHECK" : st.includes("NG") ? "NG" : st.includes("ERR") ? "CHECK" : "OK";
    lap("judge");
    return { status, cal, elements, dims, warnings, quality: { sharpness: app.sharp }, appearance: app, diff, match, dm };
  }

  /** OCR box of a text element in photo px. */
  function ocrBox(el, cal) {
    const f = cal.frame, c = G().toPx(f, { x: el.roi.cx, y: el.roi.cy });
    return { cx: c.x, cy: c.y, w: el.roi.w / f.s, h: el.roi.h / f.s, angle: f.th + (el.roi.ang || 0) * D2R };
  }
  /** Read one text element: the trained reader chosen for it (Training tab), or the built-in OCR. */
  async function readOcr(photo, box, el) {
    const opt = { format: el.format || "", lines: el.lines || 1, polarity: el.polarity || "auto" };
    if (el.reader && PM.charml) return PM.charml.read(photo, box, opt, el.reader);
    return PM.ocr.read(photo, box, opt);
  }
  /** Read all text (OCR) elements of a program into results (async). */
  async function readTexts(t, photo, cal, out, ov) {
    const els = t.elements.filter(e => e.tool === "ocr");
    if (!els.length) return;
    for (const e0 of els) {
      const el = ov && ov[e0.id] ? { ...e0, roi: ov[e0.id] } : e0;
      try {
        const r = await readOcr(photo, ocrBox(el, cal), el);
        out[el.id] = { type: "text", x: el.roi.cx, y: el.roi.cy, w: el.roi.w, h: el.roi.h, ang: el.roi.ang || 0, text: r.text, raw: r.raw, conf: r.conf, formatOk: r.formatOk, image: r.image, mode: r.mode || null, reader: el.reader || "" };
        if (!r.text) out[el.id].error = "no text found";
      } catch (err) { out[el.id] = { error: "OCR: " + (err.message || err) }; }
    }
  }

  /** Measured elements that cause a dimension (or element) to fail, following constructions back. */
  function failedRoots(t, res, ids) {
    const out = new Set(), seen = new Set();
    const walk = id => {
      if (!id || seen.has(id)) return; seen.add(id);
      const el = t.elements.find(e => e.id === id), r = res[id];
      if (!el) return;
      if (TOOLS[el.tool]?.measured) { if (!r || r.error) out.add(id); return; }
      if (el.tool === "ref") { if (!r || r.error) out.add(id); return; }
      (el.args || []).forEach(walk);
    };
    ids.forEach(walk);
    return [...out];
  }

  /**
   * Try wider search areas and softer edge settings for one failed element and keep the variant whose
   * result looks most like the master (size / angle). Returns {roi, edge, result, tried} or null.
   */
  function autoSearch(t, photo, cal, el, masterR, ov) {
    const base = { ...el, roi: (ov && ov[el.id]) || el.roi }, e0 = { ...defaultEdge(), ...(el.edge || {}) };
    if (!TOOLS[el.tool]?.measured || el.tool === "color" || el.tool === "ocr") return null;
    const clone = o => JSON.parse(JSON.stringify(o));
    const thrs = [e0.thr, Math.max(3, Math.round(e0.thr * 0.6)), Math.max(2, Math.round(e0.thr * 0.35))];
    const pols = e0.polarity === "any" ? ["any"] : [e0.polarity, "any"];
    const sels = [...new Set([e0.select, "strongest", "first", "last"])];
    const rois = [];
    const r0 = base.roi;
    if (el.tool === "circle" || el.tool === "arc") for (const k of [1, 1.6, 2.5, 4]) rois.push({ ...clone(r0), band: Math.min(r0.r * 0.95, r0.band * k) });
    else if (el.tool === "line") for (const k of [1, 1.8, 3]) rois.push({ ...clone(r0), hw: r0.hw * k });
    else if (el.tool === "point") for (const k of [1, 1.6, 2.5]) { const mx = (r0.p0.x + r0.p1.x) / 2, my = (r0.p0.y + r0.p1.y) / 2; rois.push({ ...clone(r0), p0: { x: mx + (r0.p0.x - mx) * k, y: my + (r0.p0.y - my) * k }, p1: { x: mx + (r0.p1.x - mx) * k, y: my + (r0.p1.y - my) * k } }); }
    let best = null, tried = 0;
    for (const roi of rois) for (const thr of thrs) for (const polarity of pols) for (const select of sels) {
      const edge = { ...e0, thr, polarity, select }, cand = { ...base, roi, edge };
      let r; try { r = measureElement(cand, photo, cal, {}, null); } catch (e) { continue; }
      tried++;
      if (!r || r.error) continue;
      let score;
      if (r.type === "circle") {
        const n = el.n || (el.tool === "arc" ? 36 : 72), cov = (r.pts?.length || 0) / n;
        const rm = masterR && !masterR.error ? masterR.r : r0.r;
        if (Math.abs(r.r - rm) > 0.3 * rm) continue;
        score = cov - 3 * Math.abs(r.r - rm) / rm - 2 * (r.rms / Math.max(1e-6, r.r));
      } else if (r.type === "line") {
        const n = el.n || 30, cov = (r.pts?.length || 0) / n;
        const am = masterR && !masterR.error ? Math.atan2(masterR.dy, masterR.dx) : Math.atan2(r0.p1.y - r0.p0.y, r0.p1.x - r0.p0.x);
        const da = Math.abs(wrap(Math.atan2(r.dy, r.dx) - am)); if (da > 0.15) continue;
        score = cov - 4 * da - 5 * r.rms;
      } else {
        const pm = masterR && !masterR.error ? masterR : { x: (r0.p0.x + r0.p1.x) / 2, y: (r0.p0.y + r0.p1.y) / 2 };
        score = -Math.hypot(r.x - pm.x, r.y - pm.y);
      }
      // prefer the smallest change from the program settings
      score -= 0.02 * (rois.indexOf(roi) + thrs.indexOf(thr) + pols.indexOf(polarity) + sels.indexOf(select));
      if (!best || score > best.score) best = { roi, edge, result: r, score };
    }
    if (!best) return { tried, found: false };
    const edgeDiff = {};
    for (const k of ["thr", "polarity", "select"]) if (best.edge[k] !== e0[k]) edgeDiff[k] = best.edge[k];
    return { tried, found: true, roi: best.roi, edge: edgeDiff, result: best.result, roiChanged: JSON.stringify(best.roi) !== JSON.stringify(r0) };
  }

  /** DataMatrix around template code ROI (if any), else whole image. */
  function readCode(t, photo, cal) {
    let r = null;
    if (t.code && cal && cal.ok) {
      const c = G().toPx(cal.frame, { x: t.code.x, y: t.code.y });
      r = V().readDataMatrix(photo, { cx: c.x, cy: c.y, size: t.code.size / cal.frame.s, angle: cal.frame.th });
    }
    if (!r) r = V().readDataMatrix(photo, null);
    return r ? r.text : null;
  }

  // ---------------- descriptions ----------------
  function describeElement(el) {
    if (el.tool === "ref") return `REF${el.which}`;
    if (el.tool === "color") return el.white ? "colour (white ref.)" : "colour";
    if (el.tool === "ocr") return `text (${el.reader ? "trained reader" : "OCR"}${el.format ? " " + el.format : ""})`;
    if (TOOLS[el.tool]?.measured) return el.tool;
    return `${el.tool}(${(el.args || []).join(", ")})`;
  }

  return {
    TOOLS, DIMS, PREFIX, newTemplate, nextId, defaultEdge,
    masterCalibration, manualCalibration, autoCalibrate, refArea, posOf, setAnchors, alignOnFeatures, stationScale, checkStation, stationCalibrate, stationInfo, searchPose, calibrateWith, frameInfo, masterPatch, corrBox, setRotRef, angleOf,
    NUM_OPS, TEXT_OPS, specOf, specText, judge, readTexts, readOcr, ocrBox,
    modeOf, rotOf, rotEl, appearanceOf, diffVsMaster, measureElement, failedRoots, autoSearch, teachColor,
    runElements, evalDims, datumOf, measure, readCode, describeElement, num, arrayCopy, shiftRoi,
  };
})();
