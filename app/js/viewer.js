// Canvas viewer (pan/zoom, aligned or original view) and the overlay painter shared with reports.
"use strict";
window.PM = window.PM || {};
PM.viewer = (() => {
  // ---- 2D affine: [a, b, c, d, e, f] maps (x, y) -> (a x + c y + e, b x + d y + f) ----
  const A = {
    id: () => [1, 0, 0, 1, 0, 0],
    mul: (m, n) => [ // m ∘ n (apply n first)
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
    inv: m => { const det = m[0] * m[3] - m[1] * m[2]; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; },
    ap: (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
    scale: k => [k, 0, 0, k, 0, 0],
    tr: (x, y) => [1, 0, 0, 1, x, y],
    rot: a => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0],
    /** mm -> px for a calibration frame */
    toPx: f => [Math.cos(f.th) / f.s, Math.sin(f.th) / f.s, -Math.sin(f.th) / f.s, Math.cos(f.th) / f.s, f.ox, f.oy],
  };
  const IDF = { ox: 0, oy: 0, th: 0, s: 1 };

  const COL = { ref: "#22d3ee", ok: "#34d399", ng: "#f87171", err: "#fb923c", info: "#e5e7eb", roi: "rgba(96,165,250,.9)", pts: "#facc15", dim: "#e879f9", sel: "#fde047", datum: "#a78bfa" };

  /**
   * Paint image + overlays.
   * T: mm -> screen. img: drawable, imgToPx: matrix image-pixels -> photo px. frame: px<->mm.
   */
  function paint(ctx, o) {
    const { T, frame } = o, f = frame || IDF, W = ctx.canvas.width, H = ctx.canvas.height;
    const S = A.mul(T, A.inv(A.toPx(f))); // px -> screen
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = o.bg || PM.viewer.bg || "#0b0f13"; ctx.fillRect(0, 0, W, H);
    if (o.img) {
      const M = A.mul(S, o.imgToPx || A.id());
      ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(o.img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (o.overlay && o.overlay.img && o.overlay.alpha > 0) { // master photo blended on top (aligned through its own frame)
      const ov = o.overlay, S2 = A.mul(T, A.inv(A.toPx(ov.frame))), M2 = A.mul(S2, ov.imgToPx || A.id());
      ctx.globalAlpha = ov.alpha; ctx.setTransform(M2[0], M2[1], M2[2], M2[3], M2[4], M2[5]);
      ctx.drawImage(ov.img, 0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    }
    if (o.dimImage) { ctx.fillStyle = `rgba(0,0,0,${o.dimImage})`; ctx.fillRect(0, 0, W, H); }
    const sc = o.lw || 1; // line/label scale (reports draw bigger)
    const P = m => A.ap(T, m);
    const zoom = Math.hypot(T[0], T[1]); // screen px per mm
    const t = o.template, res = o.result;

    // candidates (px), e.g. when picking references
    if (o.cands) for (const c of o.cands) {
      const p = A.ap(S, { x: c.cx, y: c.cy }), r = c.r * Math.hypot(S[0], S[1]);
      ring(ctx, p, r, "rgba(250,204,21,.8)", 1.5 * sc, [4, 3]);
    }
    // ROIs
    if (t && o.showRoi) for (const el of t.elements) drawRoi(ctx, el, P, zoom, sc, o.selected === el.id);
    if (t && o.showRoi && t.code) {
      const h = t.code.size / 2, q = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => P({ x: t.code.x + x, y: t.code.y + y }));
      poly(ctx, q, "rgba(167,139,250,.95)", 1.5 * sc, [6, 4]); label(ctx, q[0], "2D", "rgba(167,139,250,.95)", sc, -4);
    }
    if (t && o.showRoi && t.reportBox) {
      const b = t.reportBox, q = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => P({ x, y }));
      poly(ctx, q, "rgba(148,163,184,.8)", 1 * sc, [2, 4]);
    }
    if (res && res.elements) {
      const ngEls = new Set();
      if (res.dims && t) for (const dm of t.dims) if (res.dims[dm.id]?.status === "NG") { ngEls.add(dm.a); dm.b && ngEls.add(dm.b); }
      // edge points
      if (o.showPts) for (const el of t.elements) {
        const r = res.elements[el.id]; if (!r || r.error || !r.pts) continue;
        ctx.fillStyle = COL.pts;
        for (const q of r.pts) { const p = P(q); ctx.fillRect(p.x - 1.5 * sc, p.y - 1.5 * sc, 3 * sc, 3 * sc); }
      }
      // datum axes
      if (o.showDatum !== false && t) {
        const D = PM.engine.datumOf(t, res.elements), L = 4;
        const o0 = P(D.inv({ x: 0, y: 0 })), ox = P(D.inv({ x: L, y: 0 })), oy = P(D.inv({ x: 0, y: L }));
        arrow(ctx, o0, ox, COL.datum, 1.5 * sc); arrow(ctx, o0, oy, COL.datum, 1.5 * sc);
        label(ctx, ox, "X", COL.datum, sc, 0, true); label(ctx, oy, "Y", COL.datum, sc, 0, true);
      }
      // geometry
      for (const el of t.elements) {
        const r = res.elements[el.id];
        if (!r || r.error) { if (r && r.error && el.roi) { const c = roiCenter(el); if (c) label(ctx, P(c), el.id + " ✕", COL.err, sc); } continue; }
        const isRef = el.tool === "ref";
        const col = isRef ? COL.ref : ngEls.has(el.id) ? COL.ng : COL.ok;
        const sel = o.selected === el.id;
        const w = (sel ? 3 : 2) * sc;
        if (r.type === "circle") {
          const p = P({ x: r.cx, y: r.cy }), rr = r.r * zoom;
          if (r.arc) arcDraw(ctx, P, { x: r.cx, y: r.cy }, r.r, r.arc, col, w); else ring(ctx, p, rr, col, w);
          cross(ctx, p, Math.min(8 * sc, rr * 0.5 + 3), col, 1.5 * sc);
          if (o.labels !== false) label(ctx, { x: p.x + rr * 0.72, y: p.y - rr * 0.72 }, el.id, col, sc);
        } else if (r.type === "line") {
          const a = P({ x: r.px + r.dx * r.t0, y: r.py + r.dy * r.t0 }), b = P({ x: r.px + r.dx * r.t1, y: r.py + r.dy * r.t1 });
          seg(ctx, a, b, col, w);
          if (o.labels !== false) label(ctx, b, el.id, col, sc, 4);
        } else if (r.type === "text") {
          const q = rectPts(r.x, r.y, r.w || 1, r.h || 1, r.ang || 0).map(P);
          poly(ctx, q, col, w);
          if (o.labels !== false) label(ctx, { x: q[0].x, y: q[0].y - 10 * sc }, `${el.id} "${r.text}" ${Math.round(r.conf || 0)}%`, col, sc);
        } else if (r.type === "color") {
          const p = P(r), rr = Math.max(4 * sc, r.r * zoom), rgb = c => `rgb(${c.map(v => Math.round(v)).join(",")})`;
          ring(ctx, p, rr, r.white ? "#ffffff" : col, w);
          // swatches: measured (left) and taught (right)
          const sz = 12 * sc, x0 = p.x + rr + 4 * sc, y0 = p.y - sz / 2;
          ctx.fillStyle = rgb(r.rgb); ctx.fillRect(x0, y0, sz, sz); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, sz, sz);
          const ref = t.elements.find(e => e.id === el.id)?.ref;
          if (ref) { ctx.fillStyle = rgb(ref.rgb); ctx.fillRect(x0 + sz, y0, sz, sz); ctx.strokeRect(x0 + sz, y0, sz, sz); }
          if (o.labels !== false) label(ctx, { x: x0, y: y0 - 9 * sc }, el.id + (r.white ? " W" : ""), r.white ? "#ffffff" : col, sc);
        } else if (r.type === "point") {
          const p = P(r); cross(ctx, p, 7 * sc, col, w); if (o.labels !== false) label(ctx, { x: p.x + 6 * sc, y: p.y - 6 * sc }, el.id, col, sc);
        }
      }
      // dimensions
      if (res.dims && t && o.showDims !== false) {
        let k = 0;
        for (const dm of t.dims) {
          const d = res.dims[dm.id]; if (!d || !d.draw) continue;
          const col = d.status === "NG" ? COL.ng : d.status === "OK" ? COL.ok : COL.info;
          const txt = `${dm.id} ${fmtV(d.v, dm.kind)}`;
          drawDim(ctx, d.draw, P, txt, col, sc, zoom, k++);
        }
      }
    }
    if (o.handles) for (const h of o.handles) { // drag handles of the selected search area
      const p = P(h), r = 5 * sc;
      ctx.fillStyle = h.k === "c" ? "#fde047" : "#ffffff"; ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5 * sc;
      if (h.k === "c") { ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, 7); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r); ctx.strokeRect(p.x - r, p.y - r, 2 * r, 2 * r); }
    }
    if (o.after) o.after(ctx, P);
    ctx.restore();
  }

  function fmtV(v, kind) {
    if (v == null || (typeof v !== "string" && isNaN(v))) return "—";
    const k = PM.engine.DIMS[kind] || {};
    if (typeof v === "string") return v;
    if (kind === "color" || kind === "colordiff") return "ΔE " + v.toFixed(1);
    return kind === "angle" ? v.toFixed(2) + "°" : kind === "area" ? v.toFixed(3) : v.toFixed(3);
  }

  function drawDim(ctx, dr, P, txt, col, sc, zoom, k) {
    const dc = COL.dim;
    switch (dr.kind) {
      case "seg": { const a = P(dr.a), b = P(dr.b); seg(ctx, a, b, dc, 1.5 * sc, [5, 3]); tick(ctx, a, b, dc, sc); label(ctx, mid(a, b), txt, col, sc, 0, false, true); break; }
      case "axis": {
        const D = dr.D, qa = D.fwd(dr.a), qb = D.fwd(dr.b);
        const corner = dr.ax === "x" ? D.inv({ x: qb.x, y: qa.y }) : D.inv({ x: qa.x, y: qb.y });
        const a = P(dr.a), c = P(corner), b = P(dr.b);
        seg(ctx, a, c, dc, 1.5 * sc, [5, 3]); seg(ctx, c, b, "rgba(232,121,249,.4)", 1 * sc, [2, 3]);
        label(ctx, mid(a, c), txt, col, sc, 0, false, true); break;
      }
      case "coord": {
        const D = dr.D, q = D.fwd(dr.p), foot = dr.ax === "x" ? D.inv({ x: q.x, y: 0 }) : D.inv({ x: 0, y: q.y });
        const a = P(dr.p), b = P(foot); seg(ctx, a, b, dc, 1.2 * sc, [3, 3]); label(ctx, mid(a, b), txt, col, sc, 0, false, true); break;
      }
      case "circ": { const p = P({ x: dr.c.cx, y: dr.c.cy }), r = dr.c.r * zoom; label(ctx, { x: p.x, y: p.y + r + 14 * sc + k % 2 * 16 * sc }, txt, col, sc, 0, false, true); break; }
      case "ang": { const p = P(dr.p); arcMark(ctx, p, 18 * sc, dc, sc); label(ctx, { x: p.x + 16 * sc, y: p.y + 18 * sc }, txt, col, sc, 0, false, true); break; }
      case "line": { const l = dr.l, b = P({ x: l.px + l.dx * (l.t0 + l.t1) / 2, y: l.py + l.dy * (l.t0 + l.t1) / 2 }); label(ctx, { x: b.x, y: b.y + 16 * sc }, txt, col, sc, 0, false, true); break; }
      case "text": { const p = P({ x: dr.c.x, y: dr.c.y }); label(ctx, { x: p.x, y: p.y + (dr.c.h || 1) * zoom / 2 + 14 * sc }, txt, col, sc, 0, false, true); break; }
      case "color": { const p = P(dr.c); label(ctx, { x: p.x, y: p.y + Math.max(4 * sc, dr.c.r * zoom) + 14 * sc }, txt, col, sc, 0, false, true); break; }
      case "pos": { const a = P(dr.p), n = P(dr.n); cross(ctx, n, 6 * sc, dc, 1.5 * sc); seg(ctx, n, a, dc, 1 * sc, [2, 2]); label(ctx, { x: a.x + 10 * sc, y: a.y + 16 * sc }, txt, col, sc, 0, false, true); break; }
    }
  }

  function drawRoi(ctx, el, P, zoom, sc, sel) {
    const c = sel ? COL.sel : COL.roi, w = (sel ? 2 : 1) * sc, dash = [4, 4];
    const r = el.roi; if (!r) return;
    if (el.tool === "circle" || el.tool === "arc") {
      const p = P({ x: r.cx, y: r.cy });
      if (el.tool === "arc") {
        for (const rr of [Math.max(0.01, r.r - r.band), r.r + r.band]) arcDraw(ctx, P, { x: r.cx, y: r.cy }, rr, [r.a0, r.a1], c, w, dash);
      } else { ring(ctx, p, Math.max(1, (r.r - r.band) * zoom), c, w, dash); ring(ctx, p, (r.r + r.band) * zoom, c, w, dash); }
      if (el.edge && el.edge.dir) { // direction arrow
        const a = P({ x: r.cx + (r.r + r.band) * Math.cos((r.a0 ?? 45) * Math.PI / 180), y: r.cy + (r.r + r.band) * Math.sin((r.a0 ?? 45) * Math.PI / 180) });
        const b = P({ x: r.cx + Math.max(0.01, r.r - r.band) * Math.cos((r.a0 ?? 45) * Math.PI / 180), y: r.cy + Math.max(0.01, r.r - r.band) * Math.sin((r.a0 ?? 45) * Math.PI / 180) });
        el.edge.dir === "in" ? arrow(ctx, a, b, c, w) : arrow(ctx, b, a, c, w);
      }
    } else if (el.tool === "line") {
      const ux = r.p1.x - r.p0.x, uy = r.p1.y - r.p0.y, L = Math.hypot(ux, uy) || 1, nx = -uy / L * r.hw, ny = ux / L * r.hw;
      const q = [{ x: r.p0.x - nx, y: r.p0.y - ny }, { x: r.p1.x - nx, y: r.p1.y - ny }, { x: r.p1.x + nx, y: r.p1.y + ny }, { x: r.p0.x + nx, y: r.p0.y + ny }].map(P);
      poly(ctx, q, c, w, dash);
      const s = r.side || 1, m = { x: (r.p0.x + r.p1.x) / 2, y: (r.p0.y + r.p1.y) / 2 };
      arrow(ctx, P({ x: m.x - s * nx, y: m.y - s * ny }), P({ x: m.x + s * nx, y: m.y + s * ny }), c, w);
    } else if (el.tool === "point") {
      arrow(ctx, P(r.p0), P(r.p1), c, w);
    } else if (el.tool === "color") {
      ring(ctx, P({ x: r.cx, y: r.cy }), Math.max(2, r.r * zoom), c, w, dash);
    } else if (el.tool === "ocr") {
      poly(ctx, rectPts(r.cx, r.cy, r.w, r.h, r.ang || 0).map(P), c, w, dash);
    }
  }
  /** Corners of a rectangle centred at (cx, cy), size w x h, turned by ang degrees (part frame). */
  function rectPts(cx, cy, w, h, ang) {
    const a = ang * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
  }
  function roiCenter(el) {
    const r = el.roi; if (!r) return null;
    if (r.cx != null) return { x: r.cx, y: r.cy };
    if (r.p0) return { x: (r.p0.x + r.p1.x) / 2, y: (r.p0.y + r.p1.y) / 2 };
    return null;
  }

  // ---- primitives ----
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function ring(ctx, p, r, col, w, dash) { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  function arcDraw(ctx, P, c, r, angDeg, col, w, dash) {
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w;
    const n = 48, a0 = angDeg[0] * Math.PI / 180, a1 = angDeg[1] * Math.PI / 180;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, q = P({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  function seg(ctx, a, b, col, w, dash) { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
  function poly(ctx, q, col, w, dash) { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w; q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
  function cross(ctx, p, s, col, w) { seg(ctx, { x: p.x - s, y: p.y }, { x: p.x + s, y: p.y }, col, w); seg(ctx, { x: p.x, y: p.y - s }, { x: p.x, y: p.y + s }, col, w); }
  function arrow(ctx, a, b, col, w) {
    seg(ctx, a, b, col, w);
    const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 2) return;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L, h = Math.min(9, L / 3) + w;
    ctx.beginPath(); ctx.fillStyle = col; ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * h - uy * h * 0.5, b.y - uy * h + ux * h * 0.5); ctx.lineTo(b.x - ux * h + uy * h * 0.5, b.y - uy * h - ux * h * 0.5); ctx.closePath(); ctx.fill();
  }
  function tick(ctx, a, b, col, sc) {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L * 5 * sc, ny = (b.x - a.x) / L * 5 * sc;
    for (const p of [a, b]) seg(ctx, { x: p.x - nx, y: p.y - ny }, { x: p.x + nx, y: p.y + ny }, col, 1.5 * sc);
  }
  function arcMark(ctx, p, r, col, sc) { ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1.5 * sc; ctx.arc(p.x, p.y, r, 0, Math.PI / 2); ctx.stroke(); }
  function label(ctx, p, txt, col, sc = 1, dx = 0, plain = false, box = false) {
    ctx.font = `600 ${Math.round(12 * sc)}px "Segoe UI", Tahoma, "Leelawadee UI", Loma, sans-serif`;
    ctx.textBaseline = "middle";
    const w = ctx.measureText(txt).width, h = 16 * sc;
    const x = p.x + dx, y = p.y;
    if (!plain) { ctx.fillStyle = "rgba(10,14,20,.78)"; ctx.fillRect(x - (box ? w / 2 + 4 * sc : 2), y - h / 2, w + 8 * sc, h); if (box) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 - 4 * sc, y - h / 2, w + 8 * sc, h); } }
    ctx.fillStyle = col; ctx.fillText(txt, box ? x - w / 2 : x + 2 * sc, y);
  }

  // ---------------- interactive viewer ----------------
  class Viewer {
    constructor(canvas, opt = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.view = opt.view || { cx: 0, cy: 0, z: 1, rot: 0 }; // world centre, zoom (screen px / world unit), extra rotation (deg)
      this.mode = "aligned"; this.layers = { showRoi: false, showPts: true, labels: true };
      this.onTool = null; // (type, worldPoint, event) -> bool handled
      this.onViewChange = null;
      this.scene = null; // {img, imgToPx, frame, template, result, cands, selected}
      this._bind();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }
    resize() {
      const r = this.c.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
      if (this.c.width !== Math.floor(w * dpr) || this.c.height !== Math.floor(h * dpr)) {
        this.c.width = Math.floor(w * dpr); this.c.height = Math.floor(h * dpr);
        this.c.style.width = w + "px"; this.c.style.height = h + "px";
      }
      this.draw();
    }
    /** world -> screen. World = part mm if aligned, image px in original mode. Returns mm -> screen. */
    T() {
      const W = this.c.width, H = this.c.height, v = this.view, f = this.scene?.frame || IDF;
      const base = A.mul(A.tr(W / 2, H / 2), A.mul(A.rot((v.rot || 0) * Math.PI / 180), A.mul(A.scale(v.z), A.tr(-v.cx, -v.cy))));
      return this.mode === "aligned" || !this.scene?.frame ? base : A.mul(base, A.toPx(f));
    }
    worldMatrix() { // world -> screen (without frame)
      const W = this.c.width, H = this.c.height, v = this.view;
      return A.mul(A.tr(W / 2, H / 2), A.mul(A.rot((v.rot || 0) * Math.PI / 180), A.mul(A.scale(v.z), A.tr(-v.cx, -v.cy))));
    }
    /** screen (css px) -> mm (or px when no frame) */
    toMm(ev) {
      const r = this.c.getBoundingClientRect(), dpr = this.c.width / r.width;
      return A.ap(A.inv(this.T()), { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr });
    }
    toPx(ev) { const m = this.toMm(ev); return this.scene?.frame ? PM.geom.toPx(this.scene.frame, m) : m; }
    set(scene) { this.scene = scene; this.draw(); }
    /** Fit world box (in current world units) */
    fit(box) {
      const W = this.c.width, H = this.c.height;
      if (!box) box = this.defaultBox();
      if (!box) return;
      this.view.cx = (box.x0 + box.x1) / 2; this.view.cy = (box.y0 + box.y1) / 2;
      const rot = (this.view.rot || 0) % 180 !== 0;
      const bw = rot ? box.y1 - box.y0 : box.x1 - box.x0, bh = rot ? box.x1 - box.x0 : box.y1 - box.y0;
      this.view.z = 0.94 * Math.min(W / Math.max(1e-6, bw), H / Math.max(1e-6, bh));
      this.draw(); this.onViewChange && this.onViewChange(this.view);
    }
    defaultBox() {
      const s = this.scene; if (!s || !s.img) return null;
      const iw = s.img.width, ih = s.img.height, M = s.imgToPx || A.id();
      const corners = [[0, 0], [iw, 0], [iw, ih], [0, ih]].map(([x, y]) => A.ap(M, { x, y }));
      const toWorld = (this.mode === "aligned" && s.frame) ? (p => PM.geom.toMm(s.frame, p)) : (p => p);
      const w = corners.map(toWorld);
      return { x0: Math.min(...w.map(p => p.x)), x1: Math.max(...w.map(p => p.x)), y0: Math.min(...w.map(p => p.y)), y1: Math.max(...w.map(p => p.y)) };
    }
    draw() {
      if (!this.scene) { const x = this.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = PM.viewer.bg || "#0b0f13"; x.fillRect(0, 0, this.c.width, this.c.height); return; }
      const dpr = window.devicePixelRatio || 1;
      paint(this.ctx, { ...this.scene, T: this.T(), ...this.layers, lw: dpr, selected: this.scene.selected });
      if (this.preview) this.preview(this.ctx, m => A.ap(this.T(), m), dpr);
    }
    _bind() {
      const c = this.c;
      let drag = null;
      c.addEventListener("wheel", e => {
        e.preventDefault();
        const r = c.getBoundingClientRect(), dpr = c.width / r.width, sp = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
        const Wm = this.worldMatrix(), w0 = A.ap(A.inv(Wm), sp);
        const k = Math.exp(-e.deltaY * 0.0015);
        this.view.z = Math.max(1e-3, Math.min(1e4, this.view.z * k));
        const w1 = A.ap(A.inv(this.worldMatrix()), sp);
        this.view.cx += w0.x - w1.x; this.view.cy += w0.y - w1.y;
        this.draw(); this.onViewChange && this.onViewChange(this.view);
      }, { passive: false });
      c.addEventListener("pointerdown", e => {
        c.setPointerCapture(e.pointerId);
        const pan = e.button === 1 || e.button === 2 || e.shiftKey || !this.onTool || !this.onTool("down", this.toMm(e), e);
        drag = { pan, x: e.clientX, y: e.clientY, moved: false };
      });
      c.addEventListener("pointermove", e => {
        if (!drag) { this.onTool && this.onTool("hover", this.toMm(e), e); return; }
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) drag.moved = true;
        if (drag.pan) {
          const r = c.getBoundingClientRect(), dpr = c.width / r.width;
          const Wi = A.inv(this.worldMatrix());
          const a = A.ap(Wi, { x: drag.x * dpr, y: drag.y * dpr }), b = A.ap(Wi, { x: e.clientX * dpr, y: e.clientY * dpr });
          this.view.cx -= b.x - a.x; this.view.cy -= b.y - a.y; drag.x = e.clientX; drag.y = e.clientY;
          this.draw(); this.onViewChange && this.onViewChange(this.view);
        } else this.onTool("move", this.toMm(e), e);
      });
      const up = e => {
        if (!drag) return;
        if (!drag.pan) this.onTool("up", this.toMm(e), e);
        else if (!drag.moved && this.onTool) this.onTool("click", this.toMm(e), e);
        drag = null;
      };
      c.addEventListener("pointerup", up);
      c.addEventListener("pointercancel", () => (drag = null));
      c.addEventListener("contextmenu", e => e.preventDefault());
    }
  }

  return { A, paint, Viewer, COL, fmtV, IDF, rectPts, bg: "#0b0f13" };
})();
