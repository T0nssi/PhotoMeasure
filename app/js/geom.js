// Geometry helpers: fitting, transforms, distances. Pure JS, no OpenCV.
"use strict";
window.PM = window.PM || {};
PM.geom = (() => {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // deterministic PRNG for RANSAC (same photo -> same result)
  function rng(seed = 12345) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

  /** Algebraic (Kasa) circle fit, then Gauss-Newton geometric refinement. */
  function fitCircle(pts) {
    if (pts.length < 3) return null;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (const p of pts) {
      const u = p.x - mx, v = p.y - my;
      suu += u * u; svv += v * v; suv += u * v;
      suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-12) return null;
    const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
    let uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
    let cx = uc + mx, cy = vc + my;
    let r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
    // geometric refinement
    for (let it = 0; it < 15; it++) {
      let J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
      for (const p of pts) {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1e-9;
        const res = d - r, j = [-dx / d, -dy / d, -1];
        for (let a = 0; a < 3; a++) { g[a] += j[a] * res; for (let b = 0; b < 3; b++) J[a][b] += j[a] * j[b]; }
      }
      const s = solve3(J, g.map(v => -v));
      if (!s) break;
      cx += s[0]; cy += s[1]; r += s[2];
      if (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2]) < 1e-6) break;
    }
    let ss = 0, maxd = -Infinity, mind = Infinity;
    for (const p of pts) { const d = Math.hypot(p.x - cx, p.y - cy) - r; ss += d * d; maxd = Math.max(maxd, d); mind = Math.min(mind, d); }
    return { cx, cy, r, rms: Math.sqrt(ss / pts.length), roundness: maxd - mind, n: pts.length };
  }

  function solve3(A, b) {
    const m = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
      if (Math.abs(m[p][c]) < 1e-12) return null;
      [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }

  /** Total-least-squares line fit. Returns point on line, unit direction, rms, straightness. */
  function fitLine(pts) {
    if (pts.length < 2) return null;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dx = Math.cos(th), dy = Math.sin(th);
    let ss = 0, mn = Infinity, mxd = -Infinity, tmin = Infinity, tmax = -Infinity;
    for (const p of pts) {
      const d = -(p.x - mx) * dy + (p.y - my) * dx; ss += d * d; mn = Math.min(mn, d); mxd = Math.max(mxd, d);
      const t = (p.x - mx) * dx + (p.y - my) * dy; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
    }
    return { px: mx, py: my, dx, dy, rms: Math.sqrt(ss / pts.length), straightness: mxd - mn, tmin, tmax, n: pts.length };
  }

  /** RANSAC line fit to reject outliers (text, scratches), then refit on inliers. */
  function ransacLine(pts, tol = 1.5, iters = 300) {
    if (pts.length < 2) return null;
    let best = null, bestCount = 0; const R = rng(pts.length);
    for (let i = 0; i < iters; i++) {
      const a = pts[(R() * pts.length) | 0], b = pts[(R() * pts.length) | 0];
      const L = dist(a, b); if (L < 3) continue;
      const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
      let c = 0; for (const p of pts) if (Math.abs(-(p.x - a.x) * dy + (p.y - a.y) * dx) < tol) c++;
      if (c > bestCount) { bestCount = c; best = { a, dx, dy }; }
    }
    if (!best) return fitLine(pts);
    const inl = pts.filter(p => Math.abs(-(p.x - best.a.x) * best.dy + (p.y - best.a.y) * best.dx) < tol);
    return fitLine(inl);
  }

  /** RANSAC circle on 3-point samples, then refit inliers. */
  function ransacCircle(pts, tol = 1.5, iters = 300) {
    if (pts.length < 3) return null;
    let best = null, bestCount = 0; const R = rng(pts.length * 7 + 1);
    for (let i = 0; i < iters; i++) {
      const s = [0, 1, 2].map(() => pts[(R() * pts.length) | 0]);
      const c = circle3(s[0], s[1], s[2]); if (!c) continue;
      let n = 0; for (const p of pts) if (Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) < tol) n++;
      if (n > bestCount) { bestCount = n; best = c; }
    }
    if (!best) return fitCircle(pts);
    return fitCircle(pts.filter(p => Math.abs(Math.hypot(p.x - best.cx, p.y - best.cy) - best.r) < tol));
  }

  function circle3(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
  }

  // ---- part frame <-> image ----
  /** Frame from reference circles: origin c1, X toward c2, scale mm/px. */
  function makeFrame(c1, c2, s) {
    const th = Math.atan2(c2.cy - c1.cy, c2.cx - c1.cx);
    return { ox: c1.cx, oy: c1.cy, th, s };
  }
  const toMm = (f, p) => {
    const dx = p.x - f.ox, dy = p.y - f.oy, c = Math.cos(-f.th), s = Math.sin(-f.th);
    return { x: f.s * (dx * c - dy * s), y: f.s * (dx * s + dy * c) };
  };
  const toPx = (f, m) => {
    const x = m.x / f.s, y = m.y / f.s, c = Math.cos(f.th), s = Math.sin(f.th);
    return { x: f.ox + x * c - y * s, y: f.oy + x * s + y * c };
  };

  // ---- element math (all in mm) ----
  function pointOf(el) {
    if (!el) return null;
    if (el.type === "circle" || el.type === "arc") return { x: el.cx, y: el.cy };
    if (el.type === "point" || el.type === "color") return { x: el.x, y: el.y };
    if (el.type === "line") return { x: el.px, y: el.py };
    return null;
  }
  function pointLineDist(p, l) { return Math.abs(-(p.x - l.px) * l.dy + (p.y - l.py) * l.dx); }
  function lineIntersect(a, b) {
    const den = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
    return { x: a.px + t * a.dx, y: a.py + t * a.dy };
  }
  function angleBetween(a, b) { // 0..90 deg between two lines
    let d = Math.abs(Math.atan2(a.dx * b.dy - a.dy * b.dx, a.dx * b.dx + a.dy * b.dy)) * 180 / Math.PI;
    if (d > 90) d = 180 - d;
    return d;
  }

  return { dist, fitCircle, fitLine, ransacLine, ransacCircle, circle3, makeFrame, toMm, toPx, pointOf, pointLineDist, lineIntersect, angleBetween };
})();
