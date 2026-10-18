// Reports: Excel (ExcelJS), PDF (jsPDF, pages rendered on canvas so Thai prints correctly), Word (docx), CSV.
"use strict";
window.PM = window.PM || {};
PM.report = (() => {
  const VW = () => PM.viewer, E = () => PM.engine;
  const tt = (k, ctx) => PM.i18n.t(k, ctx.lang);
  const FONT = "Tahoma";
  const pad2 = n => String(n).padStart(2, "0");
  const dts = d => d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` : "";
  const stamp = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const xlDate = d => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000) : ""); // Excel has no time zone: store local time
  const fname = (ctx, ext) => `${(ctx.t.name || "part").replace(/[\\/:*?"<>|]+/g, "_")}_report_${stamp(ctx.now)}.${ext}`;

  // ---------- shared content ----------
  // Nominal column: the nominal of a "nominal ± tol" spec (or "=" value, or position X/Y); Tolerance column: the spec.
  function nomStr(d) {
    const sp = E().specOf(d);
    if (d.kind === "position") return `X${d.nomX ?? 0} Y${d.nomY ?? 0}`;
    if (sp.op === "tol") return d.nom ?? "";
    return "";
  }
  function tolStr(d) {
    const sp = E().specOf(d);
    if (sp.op === "tol") return d.tolP != null || d.tolM != null ? `+${d.tolP ?? d.tolM} / −${d.tolM ?? d.tolP}` : "";
    return E().specText(d);
  }
  function valStr(v, kind) { if (typeof v === "string") return v; return v == null || isNaN(v) ? "—" : kind === "angle" ? v.toFixed(2) : kind === "color" || kind === "colordiff" ? v.toFixed(1) : v.toFixed(3); }
  const isNum = v => typeof v === "number" && !isNaN(v);
  // detail filter: "all" | "ng" (NG and ERR) | "ok" | "none" (summary only)
  const pass = (ctx, st) => ctx.detail === "ng" ? (st === "NG" || st === "ERR") : ctx.detail === "ok" ? st === "OK" : true;
  /** Dimensions shown in the summary: with a filter, only those that are NG (or OK) in at least one photo. */
  function sumDims(ctx) {
    if (!ctx.detail || ctx.detail === "all" || ctx.detail === "none") return ctx.t.dims;
    return ctx.t.dims.filter(d => ctx.items.some(it => pass(ctx, it.res?.dims?.[d.id]?.status)));
  }
  function unit(kind) { return E().DIMS[kind]?.unit || ""; }
  function dimRows(ctx, it) {
    return ctx.t.dims.filter(d => pass(ctx, it.res?.dims?.[d.id]?.status || "ERR")).map(d => {
      const x = it.res?.dims?.[d.id] || {};
      const cl = ctx.lang === "both" ? { lang: "en" } : ctx;
      return { id: d.id, name: d.name, kind: tt("k_" + d.kind, cl), unit: unit(d.kind), nom: nomStr(d), tol: tolStr(d), v: x.v, val: valStr(x.v, d.kind), dev: x.dev != null ? (x.dev >= 0 ? "+" : "") + x.dev.toFixed(3) : "", status: x.status || "", statusT: x.status === "OK" || x.status === "NG" ? tt(x.status, ctx) : x.status || "", d };
    });
  }
  function infoRows(ctx, it) {
    const c = it.res?.cal;
    const rows = [
      [tt("serial", ctx), ctx.label(it)],
      [tt("file", ctx), it.name],
      [tt("taken", ctx), `${dts(it.date)}${it.dateSource ? ` (${it.dateSource})` : ""}`],
      [tt("measuredAt", ctx), `${dts(it.measuredAt)}${it.measuredBy ? " · " + tt("measuredBy", ctx) + " " + it.measuredBy : ""}`],
      [tt("result", ctx), tt(it.status, ctx)],
    ];
    if (c?.ok) {
      rows.push([tt("scale", ctx), `${c.pxPerMm.toFixed(2)} ${tt("pxmm", ctx)}`]);
      if (c.mode === "2c") rows.push([tt("refCheck", ctx), `${c.scaleDiffPct.toFixed(2)} % (REF1 Ø${c.d1.toFixed(3)}, REF2 Ø${c.d2.toFixed(3)})`]);
      if (c.mode === "cal" && c.station) rows.push([tt("calStation", ctx), `${c.station.name || c.station.serial || ""} · ${dts(new Date(c.station.date))}${c.station.by ? " · " + c.station.by : ""} · ${(c.station.s0 * 1000).toFixed(3)} µm/px${c.station.rmsUm != null ? ` · RMS ${c.station.rmsUm.toFixed(1)} µm` : ""}`]);
    }
    if (it.dm) rows.push(["2D code (DataMatrix)", it.dm]);
    for (const el of ctx.t.elements.filter(e => e.tool === "ocr")) { const x = it.res?.elements?.[el.id]; rows.push([`${el.id} ${tt("k_text", ctx)}`, x?.text ? `${x.text}  (${Math.round(x.conf)} %${el.format ? (x.formatOk ? ", format OK" : ", format not met") : ""})` : "—"]); }
    const d = it.res?.diff;
    if (d) rows.push([tt("vsMaster", ctx), `${tt("brightness", ctx)} ${d.brightnessPct >= 0 ? "+" : ""}${d.brightnessPct.toFixed(0)} %, ${tt("contrastW", ctx)} ×${d.contrastRatio.toFixed(2)}, ${tt("colourW", ctx)} ${d.dE.toFixed(1)}, ${tt("sizeW", ctx)} ${(d.scaleRatio * 100).toFixed(0)} %`]);
    if (it.res?.warnings?.length) rows.push([tt("warnings", ctx), it.res.warnings.join("; ")]);
    return rows;
  }
  function headRows(ctx) {
    const t = ctx.t;
    return [
      [tt("template", ctx), `${t.name || ""}${t.partNo ? "  (" + tt("partNo", ctx) + " " + t.partNo + ")" : ""}`],
      [tt("reportDate", ctx), dts(ctx.now)],
      ...(ctx.operator ? [[tt("operator", ctx), ctx.operator]] : []),
      ...(ctx.company ? [[tt("company", ctx), ctx.company]] : []),
      [tt("pieces", ctx), `${ctx.items.length}  (${tt("OK", ctx)} ${ctx.items.filter(i => i.status === "OK").length} · ${tt("NG", ctx)} ${ctx.items.filter(i => i.status === "NG").length})`],
    ];
  }
  function datumNote(ctx) {
    const d = ctx.t.datum || {};
    const y = d.yUp === false ? "down" : "up";
    const one = l => PM.i18n.t("datumNote", l).replace(/\{o\}/g, d.origin || "REF1").replace(/\{a\}/g, d.axis || "part X axis").replace(/\{y\}/g, PM.i18n.t(y, l));
    return ctx.lang === "both" ? `${one("en")} / ${one("th")}` : one(ctx.lang);
  }

  /** Annotated picture of one item, as a canvas. */
  async function picture(ctx, it, W) {
    const { img, imgToPx } = await ctx.loadImage(it);
    const A = VW().A, res = it.res, ok = res?.cal?.ok;
    let T, H;
    if (ok && ctx.pic !== "full") {
      let b = ctx.t.reportBox || E().corrBox(ctx.t);
      const mx = 0.05 * (b.x1 - b.x0), my = 0.05 * (b.y1 - b.y0);
      b = { x0: b.x0 - mx, x1: b.x1 + mx, y0: b.y0 - my, y1: b.y1 + my };
      let bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      const ar = Math.min(1.25, Math.max(0.45, bh / bw)); // keep page-friendly aspect
      if (bh / bw < ar) { const e = (ar * bw - bh) / 2; b.y0 -= e; b.y1 += e; } else if (bh / bw > ar) { const e = (bh / ar - bw) / 2; b.x0 -= e; b.x1 += e; }
      bw = b.x1 - b.x0; bh = b.y1 - b.y0; H = Math.round(W * bh / bw);
      T = A.mul(A.scale(W / bw), A.tr(-b.x0, -b.y0));
    } else {
      const w = it.w, h = it.h, k = W / w; H = Math.round(h * k);
      T = A.scale(k);
      if (ok) T = A.mul(T, A.toPx(res.cal.frame));
    }
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    VW().paint(c.getContext("2d"), {
      T, img, imgToPx, frame: ok ? res.cal.frame : null, template: ok ? ctx.t : null, result: ok ? res : null,
      showPts: true, showRoi: false, lw: Math.max(1, W / 900), bg: "#000",
    });
    img.close && img.close();
    return c;
  }
  const toJpeg = (c, q = 0.86) => c.toDataURL("image/jpeg", q);
  const b64ToU8 = d => { const s = atob(d.split(",")[1]); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  async function pictures(ctx) {
    const out = [];
    if (ctx.detail === "none") return ctx.items.map(() => null);
    for (let i = 0; i < ctx.items.length; i++) {
      ctx.progress && ctx.progress(i + 1, ctx.items.length);
      const c = await picture(ctx, ctx.items[i], ctx.imgW || 1600);
      out.push({ url: toJpeg(c), w: c.width, h: c.height });
      await new Promise(r => setTimeout(r, 0));
    }
    return out;
  }

  // ---------- Excel ----------
  async function xlsx(ctx) {
    const pics = await pictures(ctx);
    const wb = new ExcelJS.Workbook();
    wb.creator = "PhotoMeasure"; wb.created = ctx.now;
    const font = { name: FONT, size: 10 }, bold = { name: FONT, size: 10, bold: true };
    const fillOk = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9F2E3" } }, fillNg = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9D6D5" } }, fillHd = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, fillChk = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCEBC6" } };
    const border = { top: { style: "thin", color: { argb: "FFBFC5CC" } }, bottom: { style: "thin", color: { argb: "FFBFC5CC" } }, left: { style: "thin", color: { argb: "FFBFC5CC" } }, right: { style: "thin", color: { argb: "FFBFC5CC" } } };
    const stFill = s => (s === "OK" ? fillOk : s === "NG" || s === "FAIL" || s === "ERR" ? fillNg : s === "CHECK" ? fillChk : null);

    // Summary
    const ws = wb.addWorksheet(tt("summary", ctx).replace(/[\\/*?:\[\]]/g, "-").slice(0, 31), { views: [{ state: "frozen", ySplit: 0 }] });
    ws.getCell("A1").value = tt("report", ctx); ws.getCell("A1").font = { name: FONT, size: 16, bold: true };
    let r = 3;
    for (const [k, v] of headRows(ctx)) { ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = bold; ws.getCell(r, 3).value = v; ws.getCell(r, 3).font = font; r++; }
    ws.getCell(r, 1).value = datumNote(ctx); ws.getCell(r, 1).font = { ...font, italic: true, color: { argb: "FF667788" } }; r += 2;
    const dims = sumDims(ctx), hdr = r;
    const cols = [tt("no", ctx), tt("serial", ctx), tt("file", ctx), tt("taken", ctx), tt("result", ctx), ...dims.map(d => `${d.id} ${d.name}`)];
    cols.forEach((h, i) => { const c = ws.getCell(hdr, i + 1); c.value = h; c.font = { ...bold, color: { argb: "FFFFFFFF" } }; c.fill = fillHd; c.alignment = { wrapText: true, vertical: "middle" }; c.border = border; });
    const sub = [[tt("nominal", ctx), nomStr], [tt("spec", ctx), tolStr], [tt("kind", ctx), d => `${tt("k_" + d.kind, ctx)}${unit(d.kind) ? " (" + unit(d.kind) + ")" : ""}`]];
    sub.forEach(([lab, fn], j) => {
      const row = hdr + 1 + j; ws.getCell(row, 5).value = lab; ws.getCell(row, 5).font = bold;
      dims.forEach((d, i) => { const c = ws.getCell(row, 6 + i); c.value = fn(d); c.font = { ...font, color: { argb: "FF445566" } }; c.alignment = { horizontal: "right" }; c.border = border; });
    });
    r = hdr + 1 + sub.length;
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: r - 1 }];
    ctx.items.forEach((it, i) => {
      const row = ws.getRow(r);
      row.values = [i + 1, ctx.label(it), it.name, xlDate(it.date), tt(it.status, ctx), ...dims.map(d => { const v = it.res?.dims?.[d.id]?.v; return typeof v === "string" ? v : !isNum(v) ? "—" : +v.toFixed(4); })];
      row.font = font;
      row.getCell(4).numFmt = "yyyy-mm-dd hh:mm:ss";
      row.getCell(5).fill = stFill(it.status) || undefined; row.getCell(5).font = bold;
      dims.forEach((d, j) => { const c = row.getCell(6 + j), st = it.res?.dims?.[d.id]?.status; c.numFmt = d.kind === "angle" ? "0.00" : d.kind.startsWith("color") ? "0.0" : "0.000"; if (st === "NG" || st === "ERR") c.fill = fillNg; });
      for (let k = 1; k <= cols.length; k++) row.getCell(k).border = border;
      r++;
    });
    ws.getColumn(1).width = 6; ws.getColumn(2).width = 16; ws.getColumn(3).width = 24; ws.getColumn(4).width = 20; ws.getColumn(5).width = 12;
    dims.forEach((_, i) => (ws.getColumn(6 + i).width = 14));
    ws.getRow(hdr).height = 32;

    // one sheet per photo
    const used = new Set([ws.name]);
    (ctx.detail === "none" ? [] : ctx.items).forEach((it, i) => {
      let nm = `${i + 1}_${ctx.label(it)}`.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31);
      while (used.has(nm)) nm = nm.slice(0, 28) + "_" + Math.floor(Math.random() * 99);
      used.add(nm);
      const s = wb.addWorksheet(nm);
      s.getCell("A1").value = `${tt("report", ctx)} – ${ctx.label(it)}`; s.getCell("A1").font = { name: FONT, size: 14, bold: true };
      let rr = 3;
      for (const [k, v] of infoRows(ctx, it)) { s.getCell(rr, 1).value = k; s.getCell(rr, 1).font = bold; s.getCell(rr, 3).value = v; s.getCell(rr, 3).font = font; if (k === tt("result", ctx)) { s.getCell(rr, 3).fill = stFill(it.status); s.getCell(rr, 3).font = bold; } rr++; }
      rr++;
      // picture
      const p = pics[i], wpx = 760, hpx = Math.round(wpx * p.h / p.w);
      const imgId = wb.addImage({ base64: p.url, extension: "jpeg" });
      s.addImage(imgId, { tl: { col: 0, row: rr - 1 }, ext: { width: wpx, height: hpx } });
      rr += Math.ceil(hpx / 20) + 1;
      s.getCell(rr, 1).value = tt("legend", ctx); s.getCell(rr, 1).font = { ...font, italic: true, color: { argb: "FF667788" } }; rr += 2;
      const hd = [tt("dim", ctx), tt("name", ctx), tt("kind", ctx), tt("nominal", ctx), tt("spec", ctx), tt("measured", ctx), tt("dev", ctx), tt("status", ctx)];
      hd.forEach((h, k) => { const c = s.getCell(rr, k + 1); c.value = h; c.font = { ...bold, color: { argb: "FFFFFFFF" } }; c.fill = fillHd; c.border = border; });
      rr++;
      for (const d of dimRows(ctx, it)) {
        const row = s.getRow(rr);
        row.values = [d.id, d.name, `${d.kind}${d.unit ? " (" + d.unit + ")" : ""}`, d.nom === "" ? "" : d.nom, d.tol, typeof d.v === "string" ? d.v : !isNum(d.v) ? "—" : +d.v.toFixed(4), d.dev, d.statusT];
        row.font = font; row.getCell(6).numFmt = d.d.kind === "angle" ? "0.00" : d.d.kind.startsWith("color") ? "0.0" : "0.000";
        const f = stFill(d.status); if (f) row.getCell(8).fill = f;
        for (let k = 1; k <= 8; k++) row.getCell(k).border = border;
        rr++;
      }
      if (!dimRows(ctx, it).length) { s.getCell(rr, 1).value = tt("noRows", ctx); s.getCell(rr, 1).font = { ...font, italic: true }; }
      [8, 26, 22, 12, 14, 12, 10, 10].forEach((w, k) => (s.getColumn(k + 1).width = w));
      s.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    });

    // long data
    const dd = wb.addWorksheet("Data");
    dd.addRow([tt("serial", ctx), tt("file", ctx), tt("taken", ctx), tt("result", ctx), tt("dim", ctx), tt("name", ctx), tt("kind", ctx), "unit", tt("nominal", ctx), tt("spec", ctx), "op", tt("measured", ctx), tt("dev", ctx), tt("status", ctx), "px/mm"]).font = bold;
    for (const it of ctx.items) for (const d of dimRows(ctx, it)) {
      const k = E().DIMS[d.d.kind];
      dd.addRow([ctx.label(it), it.name, xlDate(it.date), it.status, d.id, d.name, d.d.kind, d.unit, nomStr(d.d), E().specText(d.d), E().specOf(d.d).op, typeof d.v === "string" ? d.v : !isNum(d.v) ? null : +d.v.toFixed(5), d.dev, d.status, it.res?.cal?.ok ? +it.res.cal.pxPerMm.toFixed(3) : null]).font = font;
    }
    dd.getColumn(3).numFmt = "yyyy-mm-dd hh:mm:ss";
    [16, 24, 20, 8, 7, 26, 14, 6, 10, 7, 7, 11, 9, 8, 8].forEach((w, k) => (dd.getColumn(k + 1).width = w));

    const buf = await wb.xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name: fname(ctx, "xlsx") };
  }

  // ---------- PDF (canvas pages) ----------
  const PW = 1240, PH = 1754, M = 70; // A4 @150 dpi
  const FF = `Tahoma, "Leelawadee UI", Loma, "Segoe UI", sans-serif`;
  function page() {
    const c = document.createElement("canvas"); c.width = PW; c.height = PH;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, PW, PH); x.textBaseline = "alphabetic";
    return { c, x };
  }
  function txt(x, s, px, py, size = 18, opt = {}) {
    x.font = `${opt.bold ? "700 " : ""}${size}px ${FF}`; x.fillStyle = opt.color || "#1b2430"; x.textAlign = opt.align || "left";
    let str = String(s ?? "");
    if (opt.max) { while (str.length > 1 && x.measureText(str).width > opt.max) str = str.slice(0, -2) + "…"; }
    x.fillText(str, px, py); x.textAlign = "left";
    return x.measureText(str).width;
  }
  function wrap(x, s, size, maxW, opt = {}) {
    x.font = `${opt.bold ? "700 " : ""}${size}px ${FF}`;
    const words = String(s).split(/(\s+)/), lines = []; let cur = "";
    for (const w of words) { if (x.measureText(cur + w).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trimStart(); } else cur += w; }
    if (cur.trim()) lines.push(cur.trim());
    // Thai has no spaces: hard-split very long lines
    const out = [];
    for (const l of lines) { let r = l; while (x.measureText(r).width > maxW) { let k = r.length; while (k > 1 && x.measureText(r.slice(0, k)).width > maxW) k--; out.push(r.slice(0, k)); r = r.slice(k); } out.push(r); }
    return out;
  }
  const ST_COL = { OK: "#1f9d55", NG: "#d64541", CHECK: "#c98a0b", FAIL: "#d64541", ERR: "#d64541" };
  function pill(x, s, label, px, py) {
    x.font = `700 18px ${FF}`; const w = x.measureText(label).width + 22;
    x.fillStyle = ST_COL[s] || "#7b8794"; roundRect(x, px, py - 20, w, 28, 14); x.fill();
    x.fillStyle = "#fff"; x.fillText(label, px + 11, py); return w;
  }
  function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function header(x, ctx, title) {
    x.fillStyle = "#1f3a5f"; x.fillRect(0, 0, PW, 8);
    txt(x, tt("report", ctx), M, 58, 30, { bold: true });
    txt(x, `${ctx.t.name || ""}${ctx.t.partNo ? " · " + ctx.t.partNo : ""}`, PW - M, 58, 18, { align: "right", color: "#556" });
    if (title) txt(x, title, M, 96, 20, { color: "#334" });
    x.strokeStyle = "#d0d7de"; x.lineWidth = 2; x.beginPath(); x.moveTo(M, 112); x.lineTo(PW - M, 112); x.stroke();
  }
  function footer(x, ctx, n, N) {
    x.strokeStyle = "#d0d7de"; x.lineWidth = 1; x.beginPath(); x.moveTo(M, PH - 70); x.lineTo(PW - M, PH - 70); x.stroke();
    const lines = wrap(x, tt("note", ctx), 13, PW - 2 * M - 160);
    lines.slice(0, 2).forEach((l, i) => txt(x, l, M, PH - 48 + i * 18, 13, { color: "#7b8794" }));
    txt(x, `${tt("page", ctx)} ${n}/${N}`, PW - M, PH - 48, 14, { align: "right", color: "#556" });
    txt(x, dts(ctx.now), PW - M, PH - 30, 12, { align: "right", color: "#99a" });
  }
  function kv(x, rows, px, py, kw, maxW) {
    let y = py;
    for (const [k, v] of rows) {
      txt(x, k, px, y, 17, { color: "#667", max: kw - 10 });
      const ls = wrap(x, v, 17, maxW - kw);
      ls.forEach((l, i) => txt(x, l, px + kw, y + i * 24, 17, { bold: i === 0 && false }));
      y += 24 * Math.max(1, ls.length) + 4;
    }
    return y;
  }
  /** Draw a table; returns {y, rest} where rest = rows that did not fit. */
  function table(x, cols, rows, px, py, maxY, opt = {}) {
    const rh = opt.rh || 30, W = cols.reduce((s, c) => s + c.w, 0);
    let y = py;
    const two = cols.some(c => String(c.h).includes(" / ")), hh = two ? 2 * rh - 4 : rh + 4;
    x.fillStyle = "#1f3a5f"; x.fillRect(px, y, W, hh);
    let cx = px;
    for (const c of cols) {
      const parts = two ? String(c.h).split(" / ") : [c.h];
      parts.slice(0, 2).forEach((h, k) => txt(x, h, c.right ? cx + c.w - 8 : cx + 8, y + 22 + k * 24, k ? 14 : 15, { bold: !k, color: "#fff", align: c.right ? "right" : "left", max: c.w - 12 }));
      cx += c.w;
    }
    y += hh;
    let i = 0;
    for (; i < rows.length; i++) {
      if (y + rh > maxY) break;
      const r = rows[i];
      if (i % 2) { x.fillStyle = "#f4f6f8"; x.fillRect(px, y, W, rh); }
      cx = px;
      cols.forEach((c, k) => {
        const v = r.cells[k];
        if (c.status && v) { pill(x, r.status[k] || v, v, cx + 6, y + rh - 7); }
        else txt(x, v, c.right ? cx + c.w - 8 : cx + 8, y + rh - 9, 16, { align: c.right ? "right" : "left", max: c.w - 12, color: r.color?.[k] || "#1b2430", bold: r.bold?.[k] });
        cx += c.w;
      });
      x.strokeStyle = "#e3e8ee"; x.lineWidth = 1; x.beginPath(); x.moveTo(px, y + rh); x.lineTo(px + W, y + rh); x.stroke();
      y += rh;
    }
    return { y, rest: rows.slice(i) };
  }
  function fitCols(cols, W) { const s = cols.reduce((a, c) => a + c.w, 0); cols.forEach(c => (c.w = Math.floor(c.w * W / s))); return cols; }

  async function pdf(ctx) {
    const pics = await pictures(ctx);
    for (const p of pics) { p.img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = p.url; }); }
    const pages = []; // functions (x, n, N)
    const IW = PW - 2 * M;
    // summary pages
    const sumCols = fitCols([{ h: tt("no", ctx), w: 50 }, { h: tt("serial", ctx), w: 180 }, { h: tt("file", ctx), w: 260 }, { h: tt("taken", ctx), w: 220 }, { h: tt("result", ctx), w: 130, status: true }, { h: "NG", w: 260 }], IW);
    let rows = ctx.items.map((it, i) => {
      const ng = ctx.t.dims.filter(d => it.res?.dims?.[d.id]?.status === "NG").map(d => d.id).join(", ");
      return { cells: [i + 1, ctx.label(it), it.name, dts(it.date), tt(it.status, ctx), ng], status: { 4: it.status }, color: { 5: "#d64541" } };
    });
    let first = true;
    do {
      const rr = rows, isFirst = first;
      let fit = null;
      pages.push((x) => {
        header(x, ctx, tt("summary", ctx));
        let y = 150;
        if (isFirst) { y = kv(x, headRows(ctx), M, y, 300, IW); txt(x, datumNote(ctx), M, y + 4, 15, { color: "#667" }); y += 40; }
        fit = table(x, sumCols, rr, M, y, PH - 100);
      });
      // measure how many rows fit using a scratch page
      const scratch = page(); pages[pages.length - 1](scratch.x); rows = fit.rest; first = false;
    } while (rows.length);
    // dims definition table on its own (after summary)
    // per item pages
    (ctx.detail === "none" ? [] : ctx.items).forEach((it, i) => {
      const p = pics[i];
      let drows = dimRows(ctx, it).map(d => ({ cells: [d.id, d.name, `${d.kind}`, d.nom === "" ? "" : `${d.nom}`, d.tol, d.val, d.dev, d.statusT], status: { 7: d.status }, color: { 5: d.status === "NG" ? "#d64541" : "#1b2430" }, bold: { 5: true } }));
      const cols = fitCols([{ h: tt("dim", ctx), w: 70 }, { h: tt("name", ctx), w: 260 }, { h: tt("kind", ctx), w: 170 }, { h: tt("nominal", ctx), w: 120, right: true }, { h: tt("spec", ctx), w: 140, right: true }, { h: tt("measured", ctx), w: 130, right: true }, { h: tt("dev", ctx), w: 100, right: true }, { h: tt("status", ctx), w: ctx.lang === "both" ? 150 : 110, status: true }], IW);
      let firstP = true; const rows0 = drows.length;
      do {
        const rr = drows, isFirst = firstP;
        let fit = null;
        const fn = (x) => {
          header(x, ctx, `${tt("serial", ctx)}: ${ctx.label(it)}${isFirst ? "" : " (cont.)"}`);
          pill(x, it.status, tt(it.status, ctx), PW - M - 140, 98);
          let y = 150;
          if (isFirst) {
            y = kv(x, infoRows(ctx, it), M, y, 300, IW);
            const maxH = 760, w = Math.min(IW, maxH * p.w / p.h), h = w * p.h / p.w;
            x.drawImage(p.img, M + (IW - w) / 2, y + 6, w, h);
            x.strokeStyle = "#c9d1d9"; x.strokeRect(M + (IW - w) / 2, y + 6, w, h);
            y += h + 30;
            wrap(x, tt("legend", ctx), 13, IW).forEach((l, k) => txt(x, l, M, y + k * 18, 13, { color: "#667" }));
            y += 40;
          }
          if (isFirst && !rows0) { txt(x, tt("noRows", ctx), M, y + 30, 16, { color: "#667" }); fit = { rest: [] }; return; }
          fit = table(x, cols, rr, M, y, PH - 100);
        };
        pages.push(fn);
        const scratch = page(); fn(scratch.x); drows = fit.rest; firstP = false;
      } while (drows.length);
    });
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title: `${tt("report", { lang: "en" })} ${ctx.t.name || ""}`, creator: "PhotoMeasure" });
    for (let n = 0; n < pages.length; n++) {
      ctx.progress && ctx.progress(n + 1, pages.length);
      const { c, x } = page(); pages[n](x); footer(x, ctx, n + 1, pages.length);
      if (n) doc.addPage();
      doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297, undefined, "FAST");
      await new Promise(r => setTimeout(r, 0));
    }
    return { blob: doc.output("blob"), name: fname(ctx, "pdf") };
  }

  // ---------- Word ----------
  async function docxReport(ctx) {
    const pics = await pictures(ctx);
    const d = window.docx;
    const run = (s, o = {}) => new d.TextRun({ text: String(s ?? ""), font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size: o.size || 18, sizeComplexScript: o.size || 18, bold: !!o.bold, boldComplexScript: !!o.bold, color: o.color, italics: o.italic });
    const para = (s, o = {}) => new d.Paragraph({ children: [run(s, o)], spacing: { after: o.after ?? 60 }, alignment: o.align, heading: o.heading, pageBreakBefore: o.pageBreak });
    const borders = { top: { style: d.BorderStyle.SINGLE, size: 4, color: "BFC5CC" }, bottom: { style: d.BorderStyle.SINGLE, size: 4, color: "BFC5CC" }, left: { style: d.BorderStyle.SINGLE, size: 4, color: "BFC5CC" }, right: { style: d.BorderStyle.SINGLE, size: 4, color: "BFC5CC" } };
    const cell = (s, o = {}) => new d.TableCell({ children: [new d.Paragraph({ children: [run(s, { bold: o.bold, color: o.color, size: o.size || 17 })], alignment: o.right ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT })], shading: o.fill ? { type: d.ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined, borders, width: o.w ? { size: o.w, type: d.WidthType.DXA } : undefined, margins: { top: 40, bottom: 40, left: 80, right: 80 } });
    const stFill = s => (s === "OK" ? "D9F2E3" : s === "NG" || s === "FAIL" || s === "ERR" ? "F9D6D5" : s === "CHECK" ? "FCEBC6" : undefined);
    const kvTable = rows => new d.Table({ width: { size: 9600, type: d.WidthType.DXA }, columnWidths: [2800, 6800], layout: d.TableLayoutType.FIXED, rows: rows.map(([k, v]) => new d.TableRow({ children: [cell(k, { bold: true, w: 2800, fill: "F1F4F7" }), cell(v, { w: 6800 })] })) });
    const hdrRow = (cols, ws) => new d.TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c, { bold: true, color: "FFFFFF", fill: "1F3A5F", w: ws[i] })) });

    const children = [];
    children.push(para(tt("report", ctx), { size: 36, bold: true, after: 200 }));
    children.push(kvTable(headRows(ctx)));
    children.push(para(datumNote(ctx), { italic: true, size: 16, color: "667788", after: 200 }));
    children.push(para(tt("summary", ctx), { size: 24, bold: true, after: 100 }));
    const sw = [600, 1700, 2600, 2000, 1100, 1600];
    children.push(new d.Table({
      width: { size: 9600, type: d.WidthType.DXA }, columnWidths: sw, layout: d.TableLayoutType.FIXED,
      rows: [hdrRow([tt("no", ctx), tt("serial", ctx), tt("file", ctx), tt("taken", ctx), tt("result", ctx), "NG"], sw),
        ...ctx.items.map((it, i) => new d.TableRow({ children: [cell(i + 1, { w: sw[0] }), cell(ctx.label(it), { bold: true, w: sw[1] }), cell(it.name, { w: sw[2] }), cell(dts(it.date), { w: sw[3] }), cell(tt(it.status, ctx), { bold: true, fill: stFill(it.status), w: sw[4] }), cell(ctx.t.dims.filter(x => it.res?.dims?.[x.id]?.status === "NG").map(x => x.id).join(", "), { color: "C0392B", w: sw[5] })] }))],
    }));
    const dw = [650, 2350, 1500, 1050, 1150, 1100, 850, 950];
    (ctx.detail === "none" ? [] : ctx.items).forEach((it, i) => {
      const p = pics[i];
      children.push(para(`${i + 1}. ${tt("serial", ctx)}: ${ctx.label(it)}  –  ${tt(it.status, ctx)}`, { size: 28, bold: true, pageBreak: true, after: 120, color: it.status === "OK" ? "1F9D55" : it.status === "NG" ? "C0392B" : "8A6D0B" }));
      children.push(kvTable(infoRows(ctx, it)));
      const wpt = 620, hpt = Math.round(wpt * p.h / p.w), maxH = 560, k = hpt > maxH ? maxH / hpt : 1;
      children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, spacing: { before: 160, after: 60 }, children: [new d.ImageRun({ type: "jpg", data: b64ToU8(p.url), transformation: { width: Math.round(wpt * k), height: Math.round(hpt * k) } })] }));
      children.push(para(tt("legend", ctx), { italic: true, size: 15, color: "667788", after: 160 }));
      children.push(new d.Table({
        width: { size: 9600, type: d.WidthType.DXA }, columnWidths: dw, layout: d.TableLayoutType.FIXED,
        rows: [hdrRow([tt("dim", ctx), tt("name", ctx), tt("kind", ctx), tt("nominal", ctx), tt("spec", ctx), tt("measured", ctx), tt("dev", ctx), tt("status", ctx)], dw),
          ...(dimRows(ctx, it).length ? [] : [new d.TableRow({ children: [new d.TableCell({ columnSpan: 8, children: [new d.Paragraph({ children: [run(tt("noRows", ctx), { italic: true })] })] })] })]),
          ...dimRows(ctx, it).map(r => new d.TableRow({ children: [cell(r.id, { bold: true, w: dw[0] }), cell(r.name, { w: dw[1] }), cell(`${r.kind}${r.unit ? " (" + r.unit + ")" : ""}`, { w: dw[2] }), cell(r.nom, { right: true, w: dw[3] }), cell(r.tol, { right: true, w: dw[4] }), cell(r.val, { right: true, bold: true, color: r.status === "NG" ? "C0392B" : undefined, w: dw[5] }), cell(r.dev, { right: true, w: dw[6] }), cell(r.statusT, { bold: true, fill: stFill(r.status), w: dw[7] })] }))],
      }));
    });
    children.push(para(tt("note", ctx), { italic: true, size: 15, color: "7B8794" }));
    const doc = new d.Document({
      creator: "PhotoMeasure", title: tt("report", ctx),
      styles: { default: { document: { run: { font: { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT }, size: 18 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        headers: { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [run(`${ctx.t.name || ""}${ctx.t.partNo ? " · " + ctx.t.partNo : ""} · ${dts(ctx.now)}`, { size: 14, color: "8899AA" })] })] }) },
        footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [run(tt("page", ctx) + " ", { size: 14, color: "8899AA" }), new d.TextRun({ children: [d.PageNumber.CURRENT], size: 14, color: "8899AA" })] })] }) },
        children,
      }],
    });
    const blob = await d.Packer.toBlob(doc);
    return { blob, name: fname(ctx, "docx") };
  }

  // ---------- CSV ----------
  async function csv(ctx) {
    const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dims = sumDims(ctx);
    const lines = [[tt("no", ctx), tt("serial", ctx), tt("file", ctx), tt("taken", ctx), tt("result", ctx), "px/mm", ...dims.map(d => `${d.id} ${d.name}${unit(d.kind) ? " [" + unit(d.kind) + "]" : ""}`)].map(q).join(",")];
    lines.push(["", "", "", "", tt("nominal", ctx), "", ...dims.map(nomStr)].map(q).join(","));
    lines.push(["", "", "", "", tt("spec", ctx), "", ...dims.map(tolStr)].map(q).join(","));
    ctx.items.forEach((it, i) => lines.push([i + 1, ctx.label(it), it.name, dts(it.date), it.status, it.res?.cal?.ok ? it.res.cal.pxPerMm.toFixed(3) : "", ...dims.map(d => { const v = it.res?.dims?.[d.id]?.v; return typeof v === "string" ? v : !isNum(v) ? "" : v.toFixed(4); })].map(q).join(",")));
    return { blob: new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), name: fname(ctx, "csv") };
  }

  return { xlsx, pdf, docx: docxReport, csv, picture };
})();
