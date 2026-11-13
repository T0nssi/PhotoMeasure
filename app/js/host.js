// Host mode: PhotoMeasure inside another program (CodeVerifyStation) through WebView2 messages.
// The host sends JSON jobs with window.chrome.webview.postMessage; this file runs them with the normal
// measuring engine (PM.engine.measure) and answers with a compact result. Stand-alone use is not affected:
// without a host nothing here is active.
//
// Browser mode (macOS / Linux, no WebView2): the host serves this page on http://127.0.0.1:<port>/ and the page
// is opened in the normal browser with ?bridge=ws&k=<key>. The same messages then go over a WebSocket
// (ws://127.0.0.1:<port>/ws?k=<key>); the connection is opened again when it drops.
//
// Protocol 2 (all messages are JSON objects with "type"):
//   host → page  {type:"hello"}                                   page → host {type:"ready", app, version, protocol}
//   host → page  {type:"session", user:{name, role, hostRole}}    the logged-in user of the host (no own login)
//   page → host  {type:"call", id, method, args}                  host → page {type:"reply", id, ok, result | error}
//                methods: lib.list, lib.get {id}, lib.put {rec}, lib.del {id}   (programs = files of the host)
//                         cam.status, cam.grab                                 (the host's camera)
//   host → page  {type:"measure", id, program | programUrl, image, name?, maxDim?, serial?}
//                                                                 page → host {type:"result", id, ok, result | error}
//   host → page  {type:"selftest", id}   (the 3 golden photos of selftest/selftest-data.js through the same path)
//                                                                 page → host {type:"result", id, ok, result | error}
//   page → host  {type:"log", level, text}
"use strict";
window.PM = window.PM || {};

PM.host = (() => {
  const VERSION = "0.6.1", PROTOCOL = 2;
  const wv = (window.chrome && window.chrome.webview) || null;
  const q0 = new URLSearchParams(location.search);
  const bridge = !wv && q0.get("bridge") === "ws" && q0.get("k") ? q0.get("k") : null;   // browser mode key
  const hosted = !!(wv || bridge);
  let send = wv ? (m => wv.postMessage(m)) : null;
  let socket = null;
  const programs = new Map();   // key → normalised template (cache, keeps the worker fast)
  let queue = Promise.resolve();
  const calls = new Map();      // page → host calls waiting for a reply
  let nextCall = 0;
  const q = new URLSearchParams(location.search);
  // user of the host: first from the address (known before the app starts), later from "session" messages
  let user = hosted && q.get("user") ? { name: q.get("user"), role: q.get("role") === "admin" ? "admin" : "operator", hostRole: q.get("hostRole") || "" } : null;

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
    p.cands = fixed ? [] : await V().findCircles(p, t.proc, E().refArea(t));   // only inside the REF search area, if set
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

  /** Ask the host (page → host). Resolves with the result, rejects with the host's error. */
  function call(method, args = {}, timeoutMs = 30000) {
    if (!send) return Promise.reject(new Error("no host"));
    const id = "c" + (++nextCall);
    return new Promise((ok, bad) => {
      const timer = setTimeout(() => { calls.delete(id); bad(new Error(`host did not answer ${method}`)); }, timeoutMs);
      calls.set(id, { ok: v => { clearTimeout(timer); ok(v); }, bad: e => { clearTimeout(timer); bad(e); } });
      post({ type: "call", id, method, args });
    });
  }

  /** Program library in the host's folder (replaces the browser library in host mode; same functions). */
  const library = {
    list: () => call("lib.list"),
    get: id => call("lib.get", { id }),
    async put(t, by) {
      const rec = {
        id: t.id, name: t.name || "part", partNo: t.partNo || "", modified: new Date().toISOString(), by: by || "",
        elements: t.elements.filter(e => e.tool !== "ref").length, dims: t.dims.length, data: JSON.parse(JSON.stringify(t)),
      };
      return call("lib.put", { rec });   // the host sets the version and answers with the stored record
    },
    del: id => call("lib.del", { id }),
    putRecord: rec => call("lib.put", { rec, keepVersion: true }),
  };

  function setUser(u) {
    user = u ? { name: String(u.name || "operator"), role: u.role === "admin" ? "admin" : "operator", hostRole: u.hostRole || "" } : null;
    if (PM.app && PM.app.setUser) PM.app.setUser(user);
  }

  async function handle(m) {
    if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { return; } }
    if (!m || typeof m !== "object") return;
    if (m.type === "hello") return post({ type: "ready", app: "PhotoMeasure", version: VERSION, protocol: PROTOCOL });
    if (m.type === "session") return setUser(m.user);
    if (m.type === "reply") {
      const c = calls.get(m.id); if (!c) return;
      calls.delete(m.id);
      return m.ok ? c.ok(m.result) : c.bad(new Error(m.error || "host error"));
    }
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

  /** Browser mode: connect to the host's WebSocket, again and again when it drops (host restarted, sleep …). */
  function openBridge() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?k=${encodeURIComponent(bridge)}`;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { setTimeout(openBridge, 2000); return; }
    socket = ws;
    ws.onopen = () => {
      send = m => ws.send(JSON.stringify(m));
      bridgeBanner("");
      if (document.readyState === "complete") V().whenCv().then(announce);
    };
    ws.onmessage = ev => handle(ev.data);
    ws.onclose = () => {
      if (socket !== ws) return;
      send = null;
      bridgeBanner("Connection to CodeVerifyStation lost – reconnecting … (is the program running?)");
      setTimeout(openBridge, 2000);
    };
  }
  function bridgeBanner(text) {
    let b = document.getElementById("pmHostBanner");
    if (!b && text) {
      b = document.createElement("div");
      b.id = "pmHostBanner";
      b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;padding:8px 12px;background:#b42318;color:#fff;font:600 14px system-ui,sans-serif;text-align:center";
      document.body.appendChild(b);
    }
    if (b) { b.textContent = text; b.style.display = text ? "block" : "none"; }
  }
  const announce = () => post({ type: "ready", app: "PhotoMeasure", version: VERSION, protocol: PROTOCOL });

  if (hosted) {
    if (wv) wv.addEventListener("message", ev => handle(ev.data));
    else openBridge();
    document.documentElement.classList.add("pm-host");
    // the host owns users and programs: no own login, programs are files of the host
    if (PM.library) PM.library = library;
    if (PM.auth) {
      PM.auth.current = () => user;
      PM.auth.logout = () => { };
    }
    // tell the host when the vision engine is ready (browser mode: also after every reconnect)
    if (document.readyState === "complete") V().whenCv().then(announce); else window.addEventListener("load", () => V().whenCv().then(announce));
  }

  return { active: hosted, browser: !!bridge, VERSION, PROTOCOL, handle, connect, measure, selftest, log, call, library, user: () => user, setUser };
})();
