// Host mode: PhotoMeasure inside another program (CodeVerifyStation) through WebView2 messages.
// The host sends JSON jobs with window.chrome.webview.postMessage; this file runs them with the normal
// measuring engine (PM.engine.measure) and answers with a compact result. Stand-alone use is not affected:
// without a host nothing here is active.
//
// Protocol 1 (all messages are JSON objects with "type"):
//   host → page  {type:"hello"}                                   page → host {type:"ready", app, version, protocol}
//   host → page  {type:"measure", id, program | programUrl, image, name?, maxDim?, serial?}
//                                                                 page → host {type:"result", id, ok, result | error}
//   host → page  {type:"selftest", id}   (the 3 golden photos of selftest/selftest-data.js through the same path)
//                                                                 page → host {type:"result", id, ok, result | error}
//   page → host  {type:"log", level, text}
"use strict";
window.PM = window.PM || {};

PM.host = (() => {
  const VERSION = "0.6.0", PROTOCOL = 1;
  const wv = (window.chrome && window.chrome.webview) || null;
  let send = wv ? (m => wv.postMessage(m)) : null;
  const programs = new Map();   // key → normalised template (cache, keeps the worker fast)
  let queue = Promise.resolve();

  const E = () => PM.engine, V = () => PM.vision;
  const post = m => { if (send) try { send(m); } catch (e) { console.error("host send", e); } };
  const log = (level, text) => post({ type: "log", level, text: String(text) });

  /** Same normalisation as opening a program in the app (Program tab → Open program…). */
  function normalise(t) {
    if (!t || t.app !== "PhotoMeasure") throw new Error("not a PhotoMeasure program (missing app tag)");
    const base = E().newTemplate();
    return { ...base, ...t, ref: { ...base.ref, ...t.ref }, datum: { ...base.datum, ...t.datum }, proc: V().procOf(t.proc) };
  }
  async function programOf(job) {
    if (job.program && typeof job.program === "object") {
      const key = "inline:" + (job.program.id || "") + ":" + (job.program.modified || "") + ":" + (job.programHash || "");
      if (!programs.has(key)) programs.set(key, normalise(job.program));
      return programs.get(key);
    }
    if (job.programUrl) {
      const key = "url:" + job.programUrl + ":" + (job.programHash || "");
      if (!programs.has(key)) {
        const r = await fetch(job.programUrl, { cache: "no-store" });
        if (!r.ok) throw new Error(`program ${job.programUrl}: HTTP ${r.status}`);
        programs.set(key, normalise(await r.json()));
      }
      return programs.get(key);
    }
    throw new Error("no program in the job");
  }
  async function fileOf(src, name) {
    if (src instanceof Blob) return new File([src], name || src.name || "image", { type: src.type });
    const r = await fetch(src, { cache: "no-store" });
    if (!r.ok) throw new Error(`image ${src}: HTTP ${r.status}`);
    const b = await r.blob();
    return new File([b], name || String(src).split(/[\\/]/).pop().split("?")[0] || "image", { type: b.type, lastModified: Date.now() });
  }

  /** One dimension in a form a C# program can use without knowing PhotoMeasure. */
  function dimOut(t, dm, r) {
    const Eg = E(), sp = Eg.specOf(dm), k = Eg.DIMS[dm.kind] || {};
    const n = x => (x == null || x === "" || isNaN(+x) ? null : +x);
    let low = null, high = null;
    if (sp.op === "tol" && n(dm.nom) != null) { const p = n(dm.tolP) ?? n(dm.tolM) ?? 0, m = n(dm.tolM) ?? n(dm.tolP) ?? 0; low = n(dm.nom) - m; high = n(dm.nom) + p; }
    else if (sp.op === "range") { low = n(sp.v1); high = n(sp.v2); }
    else if (sp.op === ">=" || sp.op === ">") low = n(sp.v1);
    else if (sp.op === "<=" || sp.op === "<") high = n(sp.v1);
    return {
      id: dm.id, name: dm.name || dm.id, kind: dm.kind, unit: k.unit ?? "",
      value: r ? r.v ?? null : null, status: r ? r.status : "ERR", error: r?.err || null,
      nominal: n(dm.nom), tolPlus: n(dm.tolP), tolMinus: n(dm.tolM), low, high, spec: Eg.specText(dm), dev: r?.dev ?? null,
    };
  }

  /** Measure one image with one program – the same steps as the Measure tab. */
  async function measure(job) {
    const t0 = performance.now(), T = {};
    const t = await programOf(job);
    await V().whenCv();
    const fixed = E().modeOf(t) === "cal";
    const file = await fileOf(job.image, job.name);
    const p = await V().loadPhoto(file, job.maxDim || 6000, t.proc);
    T.load = performance.now() - t0;
    p.cands = fixed ? [] : await V().findCircles(p, t.proc);
    T.circles = performance.now() - t0 - T.load;
    const station = fixed && PM.calib ? PM.calib.active(t.ref.station || "files") : null;
    const res = await E().measure(t, p, { masterPatch: t.master?.patch, user: job.user || "host", timing: T, station, meta: { serial: job.cameraSerial || null } });
    T.total = performance.now() - t0;
    const r = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(v)]));
    return {
      program: t.name || "", programId: t.id || "", image: file.name, w: p.w, h: p.h, loadScale: p.loadScale,
      status: res.status, serial: job.serial || res.dm || null, dm: res.dm ?? null,
      dims: (t.dims || []).map(dm => dimOut(t, dm, res.dims?.[dm.id])),
      warnings: res.warnings || [],
      cal: res.cal ? { ok: !!res.cal.ok, error: res.cal.error || null, pxPerMm: res.cal.pxPerMm ?? null, ncc: res.cal.ncc ?? null, mode: E().modeOf(t) } : null,
      sharpness: res.quality?.sharpness ?? null,
      ms: r.total, timing: r,
    };
  }

  /** The 3 golden photos of the self-test through the host path (P0 acceptance: values = self-test). */
  async function selftest() {
    if (!window.PM_SELFTEST) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "selftest/selftest-data.js"; s.onload = ok; s.onerror = () => bad(new Error("selftest/selftest-data.js not found")); document.head.appendChild(s); });
    const D = window.PM_SELFTEST, out = [];
    const tolFor = (kind, ref) => (kind === "color" || kind === "colordiff" ? 0.5 : kind === "angle" ? 0.05 : Math.max(0.01, Math.abs(ref) * 0.002));
    for (const ph of D.photos) {
      const bin = atob(ph.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const blob = new Blob([u], { type: ph.type });
      // the self-test measures at 4096 px like selftest.html
      const r = await measure({ program: D.program, image: blob, name: ph.name, maxDim: 4096, user: "selftest" });
      const exp = ph.expect, bad = [];
      if (r.status !== exp.status) bad.push(`status ${r.status} ≠ ${exp.status}`);
      if ((r.dm ?? null) !== (exp.dm ?? null)) bad.push(`2D code ${r.dm} ≠ ${exp.dm}`);
      for (const [id, e] of Object.entries(exp.dims)) {
        const a = r.dims.find(d => d.id === id);
        let ok = a && a.status === e.status;
        if (a && typeof e.v === "number") { if (!(Math.abs((a.value ?? NaN) - e.v) <= tolFor(a.kind, e.v))) ok = false; }
        else if (a && a.value !== e.v) ok = false;
        if (!ok) bad.push(`${id}: ${a ? JSON.stringify(a.value) + " " + a.status : "missing"} ≠ ${JSON.stringify(e.v)} ${e.status}`);
      }
      out.push({ name: ph.name, status: r.status, expected: exp.status, pass: bad.length === 0, bad, ms: r.ms, dims: r.dims.map(d => ({ id: d.id, value: d.value, status: d.status })) });
    }
    return { pass: out.every(x => x.pass), reference: D.version, photos: out };
  }

  async function handle(m) {
    if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { return; } }
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") return post({ type: "ready", app: "PhotoMeasure", version: VERSION, protocol: PROTOCOL });
    if (m.type !== "measure" && m.type !== "selftest") return post({ type: "result", id: m.id ?? null, ok: false, error: `unknown message type '${m.type}'` });
    // one job at a time, in the order received
    queue = queue.then(async () => {
      try { post({ type: "result", id: m.id ?? null, ok: true, result: m.type === "measure" ? await measure(m) : await selftest() }); }
      catch (e) { console.error(e); post({ type: "result", id: m.id ?? null, ok: false, error: String(e && e.message || e) }); }
    });
    return queue;
  }

  /** For tests and other hosts: replace the transport (fn receives every message the page sends). */
  function connect(fn) { send = fn; }

  if (wv) {
    wv.addEventListener("message", ev => handle(ev.data));
    document.documentElement.classList.add("pm-host");
    // tell the host when the vision engine is ready
    const announce = () => post({ type: "ready", app: "PhotoMeasure", version: VERSION, protocol: PROTOCOL });
    if (document.readyState === "complete") V().whenCv().then(announce); else window.addEventListener("load", () => V().whenCv().then(announce));
  }

  return { active: !!wv, VERSION, PROTOCOL, handle, connect, measure, selftest, log };
})();
