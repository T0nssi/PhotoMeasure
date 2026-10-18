// Processing-time tracking: every measured image gets it.timing = {step: ms}. This module keeps the last
// rows of this session, shows statistics per step (n, average, 95 %, max), warns when the cycle time is over
// the limit, downloads a CSV and (with the Camera Bridge) appends every row to data/logs/timing-YYYY-MM-DD.csv.
//
// Steps (ms):  queue   waiting for the image before it (measuring is one image at a time)
//              grab    camera: button -> image ready in the bridge (wait = exposure + transfer, convert = colour)
//              transfer camera: image from the bridge into the browser
//              load    decode the image + gray image       circles  find circle candidates (REF modes)
//              align   find REF holes / part position        prep     appearance, brightness matching
//              tools   edge tools and constructions          ocr      text reading
//              code    DataMatrix                            judge    dimensions + tolerances
//              sn      serial number                         display  screen pictures
//              total   whole measurement in the app          cycle    camera: grab button -> result
"use strict";
PM.timing = (() => {
  const A = PM.app, S = A.S, I = PM.i18n, esc = A.esc;
  const $ = s => document.querySelector(s);
  const STEPS = ["queue", "grab", "wait", "convert", "transfer", "load", "circles", "align", "prep", "tools", "ocr", "code", "judge", "sn", "display", "total", "cycle"];
  const MAIN = ["load", "circles", "align", "tools", "ocr", "code"];
  const MAX_ROWS = 2000;
  const rows = [];
  let limit = 0;
  try { limit = +localStorage.getItem("pm.cycleLimit") || 0; } catch (e) { }
  try { $("#tmLog").checked = localStorage.getItem("pm.timingLog") !== "0"; } catch (e) { }
  $("#tmLimit").value = limit || "";

  const r0 = v => (v == null ? "" : Math.round(v));
  /** "load 120 · align 80 · tools 150" (steps over 1 ms) */
  function short(T) { return MAIN.filter(k => T[k] >= 1).map(k => `${k} ${r0(T[k])}`).join(" · "); }
  function detail(T) { return STEPS.filter(k => T[k] != null).map(k => `${k}: ${T[k].toFixed(1)} ms`).join("\n"); }

  function record(it) {
    const T = it.timing; if (!T) return;
    const row = { time: new Date().toISOString(), program: S.t.name || "", name: it.name, serial: it.serial || "", status: it.status, source: it.source || "file", w: it.w, h: it.h, ...T };
    const main = T.cycle ?? T.total;
    row.slow = limit > 0 && main > limit;
    rows.push(row); if (rows.length > MAX_ROWS) rows.shift();
    if (row.slow) A.toast(`${I.t("tmSlow")}: ${Math.round(main)} ms > ${limit} ms (${A.label(it)}). ${slowest(T)}`, true);
    render();
    logBridge(row);
  }
  function slowest(T) {
    const k = STEPS.filter(x => !["total", "cycle", "grab"].includes(x) && T[x] != null).sort((a, b) => T[b] - T[a])[0];
    return k ? `Slowest step: ${k} ${Math.round(T[k])} ms.` : "";
  }
  const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1) + 0.5))]; };
  function stats() {
    return STEPS.map(k => { const v = rows.map(r => r[k]).filter(x => x != null); return v.length ? { k, n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, p95: pct(v, 0.95), max: Math.max(...v) } : null; }).filter(Boolean);
  }
  function render() {
    const last = rows[rows.length - 1];
    $("#tmLast").textContent = last ? `${I.t("tmLastLbl")} ${Math.round(last.cycle ?? last.total)} ms` : "";
    if (!rows.length) { $("#tmStats").textContent = I.t("tmNone"); return; }
    const st = stats(), slow = rows.filter(r => r.slow).length;
    $("#tmStats").innerHTML = `<div>${rows.length} ${I.t("tmImages")}${slow ? ` · <span class="bad">${slow} ${I.t("tmOver")}</span>` : ""}</div>` +
      `<table class="tbl small tmTbl"><tr><th>Step</th><th class="num">n</th><th class="num">avg</th><th class="num">95 %</th><th class="num">max</th></tr>` +
      st.map(x => `<tr${x.k === "cycle" || x.k === "total" ? ' style="font-weight:600"' : ""}><td>${x.k}</td><td class="num">${x.n}</td><td class="num">${r0(x.avg)}</td><td class="num">${r0(x.p95)}</td><td class="num">${r0(x.max)}</td></tr>`).join("") + "</table>" +
      `<div class="muted">ms · ${esc(I.t("tmHint"))}</div>`;
  }
  const COLS = ["time", "program", "name", "serial", "status", "source", "w", "h", ...STEPS, "slow"];
  const csvCell = v => { if (v == null) return ""; if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1); const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function csv() { return [COLS.join(","), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(","))].join("\r\n"); }
  async function logBridge(row) {
    const cam = PM.camera;
    if (!$("#tmLog").checked || !cam || !cam.state.bridge) return;
    try { await cam.api("/api/timing", { body: { cols: COLS, vals: COLS.map(c => csvCell(row[c])) } }); } catch (e) { console.warn("timing log:", e.message); }
  }

  $("#tmLimit").addEventListener("change", e => { limit = Math.max(0, +e.target.value || 0); try { localStorage.setItem("pm.cycleLimit", String(limit)); } catch (x) { } A.toast(limit ? `Cycle-time limit: ${limit} ms` : "Cycle-time limit off"); });
  $("#tmLog").addEventListener("change", e => { try { localStorage.setItem("pm.timingLog", e.target.checked ? "1" : "0"); } catch (x) { } });
  $("#tmCsv").addEventListener("click", () => { if (!rows.length) { A.toast(I.t("tmNone"), true); return; } A.download(new Blob(["﻿" + csv()], { type: "text/csv" }), `PhotoMeasure_timing_${new Date().toISOString().slice(0, 10)}.csv`); });
  $("#tmClear").addEventListener("click", () => { rows.length = 0; render(); });
  render();

  return { record, short, detail, stats, rows, csv, STEPS, get limit() { return limit; } };
})();
