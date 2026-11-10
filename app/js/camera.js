// Camera tab: talks to the PhotoMeasure Camera Bridge (local .NET service, http://127.0.0.1:5090).
// Connection, camera setup, live view, grab -> measure, recording. Without a bridge this module stays hidden.
"use strict";
PM.camera = (() => {
  const A = PM.app, I = PM.i18n, S = A.S;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = A.esc, t = k => I.t(k);
  const BASE = location.protocol.startsWith("http") ? "" : "http://127.0.0.1:5090";
  // Host mode (inside CodeVerifyStation, js/host.js): the host owns the camera; no Camera Bridge, no Camera tab.
  const HOST = !!(PM.host && PM.host.active);
  const GROUPS = ["Exposure", "Gain", "Colour", "Image area", "Timing", "Output"];
  const AUTO = { ExposureAuto: "exposure", GainAuto: "gain", BalanceWhiteAuto: "balance" };
  const PROFILE = ["PixelFormat", "BinningHorizontal", "BinningVertical", "DecimationHorizontal", "DecimationVertical", "ReverseX", "ReverseY", "Width", "Height", "OffsetX", "OffsetY", "CenterX", "CenterY", "ShutterMode",
    "AcquisitionFrameRateEnable", "AcquisitionFrameRate", "ExposureAuto", "ExposureTime", "GainAuto", "Gain", "BlackLevel", "GammaEnable", "Gamma", "BalanceWhiteAuto", "LightSourcePreset",
    "BalanceRatio:Red", "BalanceRatio:Green", "BalanceRatio:Blue", "TriggerMode", "TriggerSource", "TriggerActivation", "TriggerDelay", "LineSource:Line2", "LineInverter:Line2"];

  const st = {
    bridge: null, cam: null, cams: [], feats: [], ws: null, wsOk: false, liveOn: true, liveSent: null,
    frameCanvas: null, imgData: null, fullW: 0, fullH: 0, frozen: false, still: null, stillShot: null,
    view: { z: 1, cx: 0, cy: 0, fit: true }, stats: null, focus: [], settings: null, grabbing: false,
    queue: Promise.resolve(), lastShot: null, lastItem: null, seq: null, drawPending: false,
  };
  window.PMCam = st; // tests / debugging

  // ---------------- bridge API ----------------
  async function api(path, opt = {}) {
    const o = { method: opt.method || (opt.body !== undefined ? "POST" : "GET"), headers: {} };
    if (opt.body !== undefined) {
      if (opt.raw) o.body = opt.body; else { o.body = JSON.stringify(opt.body); o.headers["Content-Type"] = "application/json"; }
    }
    const r = await fetch(BASE + path, o);
    if (!r.ok) { let m = r.status + " " + r.statusText; try { m = (await r.json()).error || m; } catch (e) { } throw new Error(m); }
    if (opt.blob) return r.blob();
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? r.json() : r.text();
  }
  const camOn = () => (HOST ? !!st.hostCam?.connected : !!(st.cam && st.cam.connected));
  const feat = n => st.feats.find(f => f.name === n);

  // ---------------- connection to the bridge ----------------
  let wsTimer = null;
  function connectWs() {
    clearTimeout(wsTimer);
    let ws;
    try { ws = new WebSocket(BASE ? "ws://127.0.0.1:5090/ws" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); }
    catch (e) { wsTimer = setTimeout(connectWs, 5000); return; }
    ws.binaryType = "arraybuffer";
    st.ws = ws;
    ws.onopen = () => { st.wsOk = true; st.everOk = true; st.liveSent = null; sendLive(); };
    ws.onmessage = ev => { if (typeof ev.data === "string") onEvent(JSON.parse(ev.data)); else onFrame(ev.data); };
    ws.onclose = () => {
      const was = st.wsOk; st.wsOk = false; st.ws = null;
      if (was) { st.bridge = null; st.cam = null; updateUi(); }
      wsTimer = setTimeout(connectWs, was ? 1500 : st.everOk ? 3000 : 15000);
    };
    ws.onerror = () => { };
  }

  function onEvent(m) {
    if (m.type === "hello") {
      const first = !st.bridge;
      st.bridge = m.status; st.cam = m.status.camera; updateUi();
      if (first) { loadSettings(); refreshCams(); if (camOn()) loadFeatures(); }
    } else if (m.type === "state") {
      const was = camOn(), id = st.cam?.camera?.id;
      st.cam = m.status; updateUi();
      if (camOn() && (!was || id !== st.cam.camera?.id)) { loadFeatures().then(() => applyProgram(S.t, true)); }
    } else if (m.type === "stats") {
      st.stats = m; drawStats(); statusBar();
    } else if (m.type === "shot") {
      if ($("#cAuto").checked) st.queue = st.queue.then(() => handleShot(m.shot, { measure: $("#cMeasure").checked, show: true })).catch(e => A.toast(e.message, true));
    } else if (m.type === "record") {
      st.seq = m.running ? m : null;
      $("#cRecMsg").textContent = m.done ? `Sequence finished: ${m.n} of ${m.total} images saved.` : `Recording ${m.n}/${m.total}: ${m.file || ""}`;
      $("#cSeqGo").textContent = m.running ? "■ Stop" : t("camSeq");
      if (m.done) refreshRecList();
    } else if (m.type === "error") A.toast(m.message, true);
  }

  // ---------------- UI state ----------------
  function updateUi() {
    if (HOST) {
      const on = camOn(), chip = $("#camChip");
      $("#tabCameraBtn").hidden = true;
      $$(".camOnly").forEach(b => (b.hidden = !on));
      $("#btnGrabMaster").hidden = !on || !A.isAdmin();
      $("#mGrab").disabled = !on || st.grabbing;
      chip.hidden = !st.hostCam;
      if (st.hostCam) { chip.textContent = on ? `📷 ${st.hostCam.name || "camera"}` : "📷 no camera"; chip.className = "pill camChip " + (on ? "on" : "off"); chip.title = "Camera of CodeVerifyStation"; }
      return;
    }
    const has = !!st.bridge, on = camOn(), c = st.cam;
    $("#tabCameraBtn").hidden = !has;
    if (!has && A.activeTab() === "camera") A.showTab("measure");
    $$(".camOnly").forEach(b => (b.hidden = !on));
    $("#btnGrabMaster").hidden = !on || !A.isAdmin();
    const chip = $("#camChip");
    chip.hidden = !has;
    if (has) {
      chip.textContent = on ? `📷 ${c.camera.name || c.camera.model}` : c?.reconnecting ? "📷 reconnecting…" : "📷 no camera";
      chip.className = "pill camChip " + (on ? "on" : "off");
    }
    const hw = on && c.trigger === "hardware";
    $("#cAutoWrap").hidden = !hw;
    $("#cGrab").disabled = !on || hw; $("#mGrab").disabled = !on || hw;
    $("#cGrab").title = hw ? "Hardware trigger mode: images come from the trigger" : "Grab one full-resolution image (Space)";
    $("#cConnState").innerHTML = !has ? "Camera Bridge not running." :
      on ? `<span class="ok">● ${esc(t("camConnected"))}</span> <b>${esc(c.camera.name || c.camera.model)}</b> · ${esc(c.camera.serial)} · ${esc(c.camera.interface)}${c.trigger !== "free" ? ` · trigger: ${esc(c.trigger)}` : ""}`
        : c?.reconnecting ? `<span class="warn">● reconnecting…</span> ${esc(c.camera?.model || "")}` : `<span class="warn">● ${esc(t("camNotConnected"))}</span>`;
    $("#cConnState").innerHTML += has ? `<div class="muted">Bridge ${esc(st.bridge.version)} · ${esc(st.bridge.runtime || "")}${(st.bridge.drivers || []).filter(d => !d.available && d.name === "pylon").map(d => `<br><span class="warn">pylon: ${esc(d.error)}</span>`).join("")}</div>` : "";
    $("#cDiag").href = BASE + "/api/diag";
    $("#cHint").textContent = !has ? "" : on ? (st.frameCanvas || st.still ? "" : st.liveOn ? "Waiting for images…" : "Live view is off. Press Live or Grab.") : "No camera connected." + (A.isAdmin() ? " Choose the camera and press Connect." : " Ask an admin to connect the camera.");
    $("#cLive").classList.toggle("on", st.liveOn);
    renderInfo(); statusBar(); sendLive();
  }

  function renderInfo() {
    const c = st.cam?.camera, rows = [];
    if (c && camOn()) {
      const f = n => feat(n)?.value;
      rows.push(["Model", c.model], ["Serial", c.serial]);
      if (f("DeviceFirmwareVersion")) rows.push(["Firmware", f("DeviceFirmwareVersion")]);
      if (f("DeviceTemperature") != null) rows.push(["Temperature", (+f("DeviceTemperature")).toFixed(1) + " °C"]);
      let usb = f("BslUSBSpeedMode");
      if (!usb && f("DeviceLinkSpeed")) usb = +f("DeviceLinkSpeed") >= 2e8 ? "SuperSpeed (USB 3)" : "High speed (USB 2)";
      if (usb) rows.push(["USB", /high/i.test(usb) && !/super/i.test(usb) ? `<span class="bad">${esc(usb)} – use a USB 3.0 port!</span>` : esc(usb)]);
      rows.push(["Driver", c.driver === "sim" ? "Simulator" : "Basler pylon"]);
      if (st.stats) rows.push(["Image", `${st.stats.w} × ${st.stats.h} px · ${esc(st.stats.pixelFormat || "")}`]);
    }
    $("#cInfo").innerHTML = rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${typeof v === "string" && v.startsWith("<span") ? v : esc(v)}</td></tr>`).join("");
    if (c && document.activeElement !== $("#cName")) $("#cName").value = c.name || "";
  }

  async function refreshCams() {
    try {
      st.cams = await api("/api/cameras");
      const cur = st.cam?.camera?.id;
      $("#cCamSel").innerHTML = st.cams.length ? st.cams.map(c => `<option value="${esc(c.id)}" ${c.id === cur ? "selected" : ""}>${esc(c.name || c.model)} (${esc(c.serial)}) · ${esc(c.interface)}</option>`).join("") : `<option value="">${esc(t("camNone"))}</option>`;
    } catch (e) { A.toast(e.message, true); }
  }

  // ---------------- live view ----------------
  function sendLive() {
    if (!st.ws || !st.wsOk) return;
    const on = camOn() && st.liveOn && A.activeTab() === "camera" && !document.hidden;
    const r = $("#cBox").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const maxDim = Math.round(Math.min(1600, Math.max(480, Math.max(r.width, r.height) * dpr)) / 32) * 32;
    const key = `${on}|${maxDim}`;
    if (key === st.liveSent) return;
    st.liveSent = key;
    try { st.ws.send(JSON.stringify({ type: "live", on, maxDim, fps: 10 })); } catch (e) { }
  }

  function onFrame(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 24 || dv.getUint32(0, false) !== 0x504d4c56) return; // "PMLV"
    const w = dv.getInt32(4, true), h = dv.getInt32(8, true), fullW = dv.getInt32(20, true) || w;
    $("#cHint").textContent = "";
    if (!st.frameCanvas || st.frameCanvas.width !== w || st.frameCanvas.height !== h) {
      st.frameCanvas = document.createElement("canvas"); st.frameCanvas.width = w; st.frameCanvas.height = h;
      st.imgData = st.frameCanvas.getContext("2d").createImageData(w, h);
    }
    const rgb = new Uint8Array(buf, 24), d = st.imgData.data, n = w * h, sat = $("#cSat").checked;
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 3, k += 4) {
      const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2];
      if (sat && (r >= 250 || g >= 250 || b >= 250)) { d[k] = 255; d[k + 1] = 0; d[k + 2] = 0; }
      else { d[k] = r; d[k + 1] = g; d[k + 2] = b; }
      d[k + 3] = 255;
    }
    st.frameCanvas.getContext("2d").putImageData(st.imgData, 0, 0);
    const fh = Math.round(h * fullW / w);
    st.liveW = fullW; st.liveH = fh;
    if (st.frozen) return; // keep showing the grabbed image; live frames are kept for "Resume"
    if (st.fullW !== fullW || st.fullH !== fh) { st.fullW = fullW; st.fullH = fh; st.view.fit = true; }
    requestDraw();
  }

  function requestDraw() { if (st.drawPending) return; st.drawPending = true; requestAnimationFrame(() => { st.drawPending = false; draw(); }); }

  const canvas = $("#cCanvas");
  function fitView() {
    const r = $("#cBox").getBoundingClientRect();
    if (!st.fullW || !r.width) return;
    st.view.z = Math.min(r.width / st.fullW, r.height / st.fullH) * 0.98; st.view.cx = st.fullW / 2; st.view.cy = st.fullH / 2; st.view.fit = true;
  }
  const toScreen = (x, y) => { const r = canvas.getBoundingClientRect(); return { x: (x - st.view.cx) * st.view.z + r.width / 2, y: (y - st.view.cy) * st.view.z + r.height / 2 }; };
  const toImg = (sx, sy) => { const r = canvas.getBoundingClientRect(); return { x: (sx - r.width / 2) / st.view.z + st.view.cx, y: (sy - r.height / 2) / st.view.z + st.view.cy }; };
  /** Master image of the open program, if it has the camera's aspect ratio (same camera / framing). */
  function masterMatch() {
    const m = S.master; if (!m || !st.fullW) return null;
    return Math.abs(m.w / m.h - st.fullW / st.fullH) < 0.02 ? m : null;
  }

  function draw() {
    const box = $("#cBox"), r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = PM.viewer.bg; ctx.fillRect(0, 0, W, H);
    const src = st.frozen && st.still ? st.still : st.frameCanvas;
    if (!src || !st.fullW) return;
    if (st.view.fit) fitView();
    const z = st.view.z;
    ctx.setTransform(z * dpr, 0, 0, z * dpr, (r.width / 2 - st.view.cx * z) * dpr, (r.height / 2 - st.view.cy * z) * dpr);
    ctx.imageSmoothingEnabled = z < 1.5;
    ctx.drawImage(src, 0, 0, st.fullW, st.fullH);
    const m = masterMatch(), ghost = +$("#cGhost").value / 100;
    if (m && ghost > 0) { ctx.globalAlpha = ghost; ctx.drawImage(m.canvas, 0, 0, st.fullW, st.fullH); ctx.globalAlpha = 1; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p0 = toScreen(0, 0), p1 = toScreen(st.fullW, st.fullH);
    ctx.lineWidth = 1;
    if ($("#cGrid").checked) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath();
      for (let i = 1; i < 10; i++) {
        const x = p0.x + (p1.x - p0.x) * i / 10, y = p0.y + (p1.y - p0.y) * i / 10;
        ctx.moveTo(x, p0.y); ctx.lineTo(x, p1.y); ctx.moveTo(p0.x, y); ctx.lineTo(p1.x, y);
      }
      ctx.stroke();
    }
    if ($("#cCross").checked) {
      const c = toScreen(st.fullW / 2, st.fullH / 2);
      ctx.strokeStyle = "rgba(0,255,120,0.9)"; ctx.beginPath(); ctx.moveTo(p0.x, c.y); ctx.lineTo(p1.x, c.y); ctx.moveTo(c.x, p0.y); ctx.lineTo(c.x, p1.y); ctx.stroke();
    }
    if (m && $("#cRefs").checked && S.t.master) {
      const k = st.fullW / m.w;
      for (const [key, lab] of [["c1", "REF1"], ["c2", "REF2"]]) {
        const c = S.t.master[key]; if (!c) continue;
        const q = toScreen(c.cx * k, c.cy * k), rr = c.r * k * z;
        ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(4, rr), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#22d3ee"; ctx.font = "bold 13px system-ui"; ctx.fillText(lab, q.x + rr + 4, q.y - rr - 2);
      }
      ctx.lineWidth = 1;
    }
    if (st.frozen && st.still) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(8, r.height - 28, 210, 20); ctx.fillStyle = "#fde68a"; ctx.font = "12px system-ui"; ctx.fillText(st.stillShot ? `Grabbed ${new Date(st.stillShot.time).toLocaleTimeString()}` : "Frozen", 14, r.height - 14); }
  }

  // pan / zoom
  let drag = null;
  canvas.addEventListener("wheel", e => {
    if (!st.fullW) return; e.preventDefault();
    const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, m = toImg(sx, sy);
    st.view.z = Math.max(0.02, Math.min(16, st.view.z * Math.pow(1.0015, -e.deltaY)));
    st.view.cx = m.x - (sx - r.width / 2) / st.view.z; st.view.cy = m.y - (sy - r.height / 2) / st.view.z; st.view.fit = false; requestDraw();
  }, { passive: false });
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, cx: st.view.cx, cy: st.view.cy }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => { if (!drag) return; st.view.cx = drag.cx - (e.clientX - drag.x) / st.view.z; st.view.cy = drag.cy - (e.clientY - drag.y) / st.view.z; st.view.fit = false; requestDraw(); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  $("#cFit").addEventListener("click", () => { st.view.fit = true; requestDraw(); });
  $("#c100").addEventListener("click", () => { const dpr = window.devicePixelRatio || 1; st.view.z = 1 / dpr; st.view.fit = false; requestDraw(); });
  ["#cGrid", "#cCross", "#cRefs"].forEach(s => $(s).addEventListener("change", requestDraw));
  $("#cGhost").addEventListener("input", requestDraw);
  window.addEventListener("resize", () => { if (A.activeTab() === "camera") { requestDraw(); sendLive(); } });
  document.addEventListener("visibilitychange", sendLive);

  $("#cLive").addEventListener("click", () => { st.liveOn = !st.liveOn; if (st.liveOn) setFrozen(false); updateUi(); });
  $("#cFreeze").addEventListener("click", () => setFrozen(!st.frozen));
  function setFrozen(on) {
    st.frozen = on;
    if (!on) {
      st.still?.close?.(); st.still = null; st.stillShot = null;
      if (st.liveW && (st.fullW !== st.liveW || st.fullH !== st.liveH)) { st.fullW = st.liveW; st.fullH = st.liveH; st.view.fit = true; }
    }
    $("#cFreeze").innerHTML = on ? `<span data-i18n="camResume">${esc(t("camResume"))}</span>` : `<span data-i18n="camFreeze">${esc(t("camFreeze"))}</span>`;
    $("#cFreeze").classList.toggle("on", on);
    requestDraw();
  }

  // ---------------- statistics ----------------
  function statusBar() {
    const s = st.stats, on = camOn();
    if (!st.bridge) { $("#cStatus").textContent = "Camera Bridge not running"; return; }
    if (!on) { $("#cStatus").textContent = "No camera"; return; }
    const parts = [st.liveOn && A.activeTab() === "camera" ? `<b class="ok">● LIVE</b>` : "○ live off"];
    if (s) {
      parts.push(`${s.fps} fps`, `${s.w}×${s.h}`, esc(s.pixelFormat));
      const ex = feat("ExposureTime")?.value, g = feat("Gain")?.value;
      if (ex != null) parts.push(`exposure ${Math.round(ex)} µs`);
      if (g != null) parts.push(`gain ${(+g).toFixed(1)} dB`);
      parts.push(`mean ${s.mean}`, `<span class="${s.sat > 1 ? "bad" : ""}">over-exposed ${s.sat} %</span>`, `focus ${s.focus}`);
      if (s.errors) parts.push(`<span class="warn">${s.errors} errors</span>`);
    }
    if (st.lastItem?.timing) parts.push(`⏱ last ${Math.round(st.lastItem.timing.cycle ?? st.lastItem.timing.total)} ms`);
    $("#cStatus").innerHTML = parts.join(" · ");
  }

  function drawStats() {
    const s = st.stats; if (!s) return;
    const hc = $("#cHist"), ctx = hc.getContext("2d"), max = Math.max(...s.hist.map(v => Math.sqrt(v))) || 1;
    ctx.clearRect(0, 0, hc.width, hc.height);
    s.hist.forEach((v, i) => { const h = Math.sqrt(v) / max * (hc.height - 2); ctx.fillStyle = i >= 62 ? "#ef4444" : "#60a5fa"; ctx.fillRect(i * 4, hc.height - h, 3, h); });
    $("#cHistTxt").innerHTML = `mean ${s.mean} / 255 · <span class="${s.sat > 1 ? "bad" : ""}">over-exposed ${s.sat} %</span>`;
    st.focus.push(s.focus); if (st.focus.length > 150) st.focus.shift();
    const fc = $("#cFocus"), fx = fc.getContext("2d"), fmax = Math.max(...st.focus) || 1;
    fx.clearRect(0, 0, fc.width, fc.height); fx.strokeStyle = "#34d399"; fx.lineWidth = 1.5; fx.beginPath();
    st.focus.forEach((v, i) => { const x = i / 149 * (fc.width - 1), y = fc.height - 2 - v / fmax * (fc.height - 4); i ? fx.lineTo(x, y) : fx.moveTo(x, y); });
    fx.stroke();
    $("#cFocusTxt").innerHTML = `Focus <b>${s.focus}</b> (best of last 15 s: ${Math.round(fmax * 10) / 10}) – turn the lens to the highest value`;
  }

  // ---------------- camera setup ----------------
  async function loadFeatures() {
    if (!camOn()) return;
    try { st.feats = await api("/api/camera/features"); renderFeatures(); renderInfo(); statusBar(); } catch (e) { A.toast(e.message, true); }
  }

  const fmtNum = (v, f) => v == null || isNaN(v) ? "" : f.type === "int" ? String(Math.round(v)) : String(+(+v).toFixed(Math.abs(v) >= 100 ? 1 : 3));
  function sliderOf(f) {
    if (!(f.type === "float" || f.type === "int") || f.min == null || f.max == null || !(f.max > f.min)) return null;
    if (f.name === "ExposureTime") { const lo = Math.max(1, f.min), hi = Math.min(f.max, 1e6); return { log: true, lo, hi }; }
    if (f.max - f.min > 1e5) return null;
    return { log: false, lo: f.min, hi: f.max };
  }
  const toSlider = (sl, v) => sl.log ? Math.round(1000 * Math.log(Math.max(sl.lo, v) / sl.lo) / Math.log(sl.hi / sl.lo)) : Math.round(1000 * (v - sl.lo) / (sl.hi - sl.lo));
  const fromSlider = (sl, x) => sl.log ? sl.lo * Math.pow(sl.hi / sl.lo, x / 1000) : sl.lo + (sl.hi - sl.lo) * x / 1000;

  function renderFeatures() {
    const box = $("#cFeat");
    if (!camOn()) { box.innerHTML = `<div class="muted small">${esc(t("camNotConnected"))}</div>`; return; }
    let h = "";
    for (const g of GROUPS) {
      const list = st.feats.filter(f => f.group === g && f.type !== "command");
      if (!list.length) continue;
      h += `<details class="fgroup" data-g="${esc(g)}" ${g === "Exposure" || g === "Gain" || g === "Colour" ? "open" : ""}><summary>${esc(g)}</summary>`;
      for (const f of list) {
        const dis = f.writable ? "" : "disabled";
        let ctl = "";
        if (f.type === "enum") ctl = `<select data-f="${esc(f.name)}" ${dis}>${(f.options || []).map(o => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` + (AUTO[f.name] && f.writable ? ` <button class="btn sm" data-once="${AUTO[f.name]}" title="Let the camera adjust once, then keep the value">Auto once</button>` : "");
        else if (f.type === "bool") ctl = `<input type="checkbox" data-f="${esc(f.name)}" ${f.value ? "checked" : ""} ${dis}>`;
        else if (f.type === "float" || f.type === "int") {
          const sl = sliderOf(f);
          ctl = (sl && f.writable ? `<input type="range" min="0" max="1000" data-sl="${esc(f.name)}" value="${toSlider(sl, f.value)}">` : "") +
            `<input type="number" data-f="${esc(f.name)}" value="${fmtNum(f.value, f)}" ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} step="${f.inc || (f.type === "int" ? 1 : "any")}" ${dis}>`;
        } else ctl = `<span>${esc(f.value ?? "")}</span>`;
        const range = (f.type === "float" || f.type === "int") && f.min != null && f.max != null ? ` <span class="muted">${fmtNum(f.min, f)} … ${fmtNum(f.max, f)}</span>` : "";
        h += `<div class="feat"><label title="${esc(f.node)}">${esc(f.label)}${range}</label><div class="fv">${ctl}</div></div>`;
      }
      h += `</details>`;
    }
    const open = new Set($$("#cFeat details[open]").map(d => d.dataset.g));
    box.innerHTML = h;
    if (open.size) $$("#cFeat details").forEach(d => (d.open = open.has(d.dataset.g)));
    $$("#cFeat [data-f]").forEach(el => el.addEventListener("change", () => {
      const f = feat(el.dataset.f);
      const v = el.type === "checkbox" ? el.checked : f.type === "enum" ? el.value : +el.value;
      setFeatures({ [f.name]: v });
    }));
    $$("#cFeat [data-sl]").forEach(el => {
      const f = feat(el.dataset.sl), sl = sliderOf(f), num = el.parentElement.querySelector("input[type=number]");
      el.addEventListener("input", () => { num.value = fmtNum(fromSlider(sl, +el.value), f); });
      el.addEventListener("change", () => setFeatures({ [f.name]: fromSlider(sl, +el.value) }));
    });
    $$("#cFeat [data-once]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "…";
      try { const r = await api("/api/camera/auto", { body: { what: b.dataset.once } }); st.feats = r.features; if (!r.done) A.toast("The camera did not finish the auto adjustment.", true); renderFeatures(); statusBar(); }
      catch (e) { A.toast(e.message, true); b.disabled = false; b.textContent = "Auto once"; }
    }));
    const us = feat("UserSetSelector");
    $("#cUserSet").innerHTML = (us?.options || ["UserSet1"]).map(o => `<option ${o === us?.value ? "selected" : ""}>${esc(o)}</option>`).join("");
    const sd = feat("UserSetDefault");
    $("#cUsStart").title = `Camera starts with this user set after power-on${sd ? ` (now: ${sd.value})` : ""}`;
    progInfo();
  }

  async function setFeatures(values, quiet) {
    try {
      const r = await api("/api/camera/features", { method: "PUT", body: values });
      st.feats = r.features;
      const errs = Object.entries(r.errors || {});
      if (errs.length && !quiet) A.toast(errs.map(([k, v]) => `${k}: ${v}`).join(" · "), true);
      renderFeatures(); renderInfo(); statusBar();
      return errs;
    } catch (e) { A.toast(e.message, true); return [["", e.message]]; }
  }

  // camera profile stored in the program
  function profileValues() {
    const v = {};
    for (const n of PROFILE) { const f = feat(n); if (f && f.writable && f.value != null && f.value !== "Once") v[n] = f.value; }
    return v;
  }
  function progInfo() {
    const c = S.t.camera;
    $("#cProgInfo").textContent = c ? `Program "${S.t.name || "part"}" has camera settings (${Object.keys(c.values || {}).length} values, ${c.model || ""} ${c.serial || ""}, saved ${c.saved ? new Date(c.saved).toLocaleString() : "?"}${c.by ? " by " + c.by : ""}).` : `Program "${S.t.name || "part"}" has no camera settings yet.`;
    $("#cFromProg").disabled = !c || !camOn();
  }
  async function storeProfile() {
    if (HOST) return;   // camera settings belong to CodeVerifyStation (Basler Setting page)
    if (!st.feats.length) await loadFeatures();
    const cam = st.cam?.camera;
    S.t.camera = { model: cam?.model || "", serial: cam?.serial || "", saved: new Date().toISOString(), by: S.user?.name || "", values: profileValues() };
    A.saveLocal(); progInfo();
  }
  $("#cToProg").addEventListener("click", async () => {
    if (!A.isAdmin() || !camOn()) return;
    await storeProfile();
    A.toast(`Camera settings stored in program "${S.t.name || "part"}". Press "Save to library" in the program tab to keep them.`);
  });
  $("#cFromProg").addEventListener("click", () => applyProgram(S.t, false));
  async function applyProgram(tpl, auto) {
    progInfo();
    if (!tpl?.camera?.values || !camOn()) return;
    const errs = await setFeatures(tpl.camera.values, true);
    const c = st.cam?.camera, other = tpl.camera.serial && c && tpl.camera.serial !== c.serial;
    if (errs.length) A.toast(`Camera settings of the program applied with ${errs.length} problem(s): ${errs.map(e => e[0]).join(", ")}`, true);
    else if (!auto || other) A.toast(`Camera settings of program "${tpl.name}" applied${other ? ` (they were saved on camera ${tpl.camera.serial})` : ""}.`);
  }

  $("#cReload").addEventListener("click", loadFeatures);
  $("#cUsLoad").addEventListener("click", () => userSet("load"));
  $("#cUsSave").addEventListener("click", () => { if (confirm(`Save the current settings into ${$("#cUserSet").value} in the camera?`)) userSet("save"); });
  $("#cUsStart").addEventListener("click", () => userSet("startup"));
  async function userSet(action) {
    try { const r = await api("/api/camera/userset", { body: { action, set: $("#cUserSet").value } }); st.feats = r.features; renderFeatures(); A.toast(`User set ${$("#cUserSet").value}: ${action} done.`); }
    catch (e) { A.toast(e.message, true); }
  }
  $("#cPfsOut").addEventListener("click", async () => {
    try { const b = await api("/api/camera/config", { blob: true }); const c = st.cam?.camera; A.download(b, `${A.safeName(c?.model || "camera")}_${c?.serial || ""}_${new Date().toISOString().slice(0, 10)}.pfs`); }
    catch (e) { A.toast(e.message, true); }
  });
  $("#cPfsIn").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const r = await api("/api/camera/config", { body: await f.arrayBuffer(), raw: true }); st.feats = r.features; renderFeatures(); A.toast(`Settings loaded from ${f.name}.`); }
    catch (err) { A.toast(err.message, true); }
  });

  // ---------------- connect ----------------
  $("#cRefresh").addEventListener("click", refreshCams);
  $("#cConnect").addEventListener("click", async () => {
    const id = $("#cCamSel").value; if (!id) { await refreshCams(); return; }
    A.busy(true, "Connecting camera…");
    try { st.cam = await api("/api/cameras/open", { body: { id } }); updateUi(); await loadFeatures(); await applyProgram(S.t, true); A.toast("Camera connected."); }
    catch (e) { A.toast(e.message, true); }
    A.busy(false);
  });
  $("#cDisconnect").addEventListener("click", async () => {
    try { st.cam = await api("/api/cameras/close", { body: {} }); st.feats = []; renderFeatures(); updateUi(); } catch (e) { A.toast(e.message, true); }
  });
  $("#cName").addEventListener("change", async e => {
    const c = st.cam?.camera; if (!c) return;
    try { await api("/api/cameras/name", { body: { serial: c.serial, name: e.target.value } }); c.name = e.target.value.trim(); updateUi(); refreshCams(); } catch (err) { A.toast(err.message, true); }
  });
  $("#cTest").addEventListener("click", () => grab({ measure: false }));

  // ---------------- grab & measure ----------------
  async function grab(opt = {}) {
    if (!camOn()) { A.toast(t("camNotConnected"), true); return null; }
    if (st.grabbing) return null;
    st.grabbing = true; ["#cGrab", "#mGrab"].forEach(s => ($(s).disabled = true));
    try {
      const t0 = performance.now();
      const shot = HOST ? await PM.host.call("cam.grab", {}, 30000) : await api("/api/grab", { body: {} });
      return await handleShot(shot, { measure: opt.measure ?? $("#cMeasure").checked, show: A.activeTab() === "camera", t0, grabMs: performance.now() - t0 });
    } catch (e) { A.toast(e.message, true); return null; }
    finally { st.grabbing = false; updateUi(); }
  }

  async function handleShot(shot, { measure, show, t0, grabMs }) {
    // hardware-triggered image: the cycle starts when the bridge received the frame
    if (t0 == null) t0 = performance.now() - Math.max(0, Date.now() - Date.parse(shot.time));
    const tb = performance.now();
    const blob = HOST ? await hostBlob(shot.url) : await api(shot.url, { blob: true });
    const steps = { transfer: performance.now() - tb };
    if (grabMs != null) steps.grab = grabMs;
    if (shot.timing) { if (shot.timing.waitMs != null) steps.wait = shot.timing.waitMs; if (shot.timing.convertMs != null) steps.convert = shot.timing.convertMs; }
    st.lastShot = shot;
    if (show) {
      st.still?.close?.(); st.still = await createImageBitmap(blob); st.stillShot = shot;
      if (st.fullW !== shot.w || st.fullH !== shot.h) { st.fullW = shot.w; st.fullH = shot.h; st.view.fit = true; }
      setFrozen(true); st.still = st.still || null;
    }
    if (!measure) { banner(null, shot); return { shot, blob }; }
    if (!A.ready()) { A.toast(t("camNoProgram"), true); banner(null, shot); return { shot, blob }; }
    const ext = blob.type === "image/png" ? "png" : "bmp";
    const file = new File([blob], `cam_${shot.shotId}.${ext}`, { type: blob.type, lastModified: Date.parse(shot.time) });
    const it = A.addShot(file, { src: HOST ? shot.url : BASE + shot.url, shotId: shot.shotId, time: shot.time, camera: shot.camera, serial: shot.serial, select: true, timing: { t0, steps } });
    banner({ status: "WAIT" }, shot);
    const done = await Promise.race([it.done, new Promise(r => setTimeout(() => r(null), 180000))]);
    if (!done) return { shot, blob, it };
    st.lastItem = it;
    banner(it, shot); showResult(it);
    await autoSave(it, shot).catch(e => A.toast("Auto-save failed: " + e.message, true));
    return { shot, blob, it };
  }

  function banner(it, shot) {
    const b = $("#cBanner");
    if (!it) { b.hidden = true; return; }
    b.hidden = false;
    if (it.status === "WAIT") { b.className = "camBanner WAIT"; b.innerHTML = `<div class="big">…</div><div>${esc(t("camMeasuring"))}</div>`; return; }
    const ng = Object.entries(it.res?.dims || {}).filter(([, d]) => d.status && d.status !== "OK").slice(0, 5);
    const dm = id => S.t.dims.find(x => x.id === id);
    b.className = "camBanner " + it.status;
    b.innerHTML = `<div class="big">${esc(I.t(it.status))}</div><div><b>${esc(A.label(it))}</b> · ${new Date(shot.time).toLocaleTimeString()}</div>` +
      ng.map(([id, d]) => `<div class="small">${esc(id)} ${esc(dm(id)?.name || "")}: ${d.v != null ? esc(PM.viewer.fmtV(d.v, dm(id)?.kind)) : "—"} <span class="muted">${dm(id) ? esc(PM.engine.specText(dm(id))) : ""}</span></div>`).join("") +
      (it.res?.warnings?.length && it.status !== "OK" ? `<div class="small warn">${esc(it.res.warnings[0])}</div>` : "") +
      (it.timing ? `<div class="small ${PM.timing && PM.timing.limit > 0 && (it.timing.cycle ?? it.timing.total) > PM.timing.limit ? "bad" : "muted"}">⏱ ${Math.round(it.timing.cycle ?? it.timing.total)} ms</div>` : "");
  }

  function showResult(it) {
    $("#cResCard").hidden = false;
    const rows = S.t.dims.map(d => { const x = it.res?.dims?.[d.id]; return `<tr class="${x?.status === "NG" ? "bad" : ""}"><td>${esc(d.id)}</td><td>${esc(d.name || "")}</td><td class="num">${x?.v != null ? esc(PM.viewer.fmtV(x.v, d.kind)) : "—"}</td><td><span class="pill ${x?.status || ""}">${esc(x?.status || "")}</span></td></tr>`; }).join("");
    $("#cResult").innerHTML = `<div class="row" style="justify-content:space-between"><span><span class="pill ${it.status}">${esc(I.t(it.status))}</span> <b>${esc(A.label(it))}</b></span><button class="btn sm" id="cOpenMeasure">${esc(t("camOpenMeasure"))}</button></div>` +
      `<div class="scrollY" style="max-height:220px;margin-top:6px"><table class="tbl small">${rows}</table></div>`;
    $("#cOpenMeasure").addEventListener("click", () => { A.showTab("measure"); A.selectItem(it); });
  }

  $("#cGrab").addEventListener("click", () => grab());
  $("#mGrab").addEventListener("click", () => grab());
  $("#btnGrabMaster").addEventListener("click", async () => {
    if (!A.isAdmin() || !camOn()) return;
    if (S.t.master && !confirm("Replace the master image of this program with a new camera image? REF1/REF2 must be set again.")) return;
    const r = await grab({ measure: false }); if (!r) return;
    const ext = r.blob.type === "image/png" ? "png" : "bmp";
    await A.loadMaster(new File([r.blob], `master_${r.shot.shotId}.${ext}`, { type: r.blob.type, lastModified: Date.parse(r.shot.time) }));
    await storeProfile();
    A.showTab("template");
    A.toast("Master grabbed from the camera; the camera settings were stored in the program. Click REF1.");
  });
  document.addEventListener("keydown", e => {
    if (e.code !== "Space" || e.repeat || e.target.matches("input, select, textarea, #cGrab, #mGrab") || $("#loginDlg").classList.contains("show")) return;
    const tab = A.activeTab();
    if ((tab === "camera" || tab === "measure") && camOn() && st.cam.trigger !== "hardware") { e.preventDefault(); grab(); }
  });

  // ---------------- recording ----------------
  async function loadSettings() {
    try {
      st.settings = await api("/api/settings");
      const r = st.settings.record;
      $("#cAutoSave").value = r.autoSave; $("#cFormat").value = r.format; $("#cPattern").value = r.pattern; $("#cFolder").value = r.folder || "";
      $("#cKeep").value = r.keepDays; $("#cSaveRaw").checked = r.saveRaw; $("#cSaveRes").checked = r.saveResult;
      $("#cRecRoot").textContent = `Saved in: ${st.settings.root}\\<date>`;
    } catch (e) { console.warn(e); }
  }
  $("#cRecApply").addEventListener("click", async () => {
    if (!A.isAdmin()) return;
    const record = { autoSave: $("#cAutoSave").value, format: $("#cFormat").value, pattern: $("#cPattern").value.trim(), folder: $("#cFolder").value.trim(), keepDays: +$("#cKeep").value || 0, saveRaw: $("#cSaveRaw").checked, saveResult: $("#cSaveRes").checked };
    try { await api("/api/settings", { method: "PUT", body: { record } }); await loadSettings(); A.toast("Record settings saved."); refreshRecList(); } catch (e) { A.toast(e.message, true); }
  });

  const varsFor = it => ({ program: S.t.name || "", serial: it?.serial || "", status: it?.status || "", user: S.user?.name || "" });
  const stamp = d => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
  const clean = s => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");

  async function saveResultPicture(it, shot) {
    const c = await A.picture(it, 1600);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    const name = [clean(S.t.name), clean(it.serial), stamp(new Date(shot.time)), it.status, "result"].filter(Boolean).join("_") + ".jpg";
    return api(`/api/record/upload?name=${encodeURIComponent(name)}`, { body: blob, raw: true });
  }

  async function autoSave(it, shot) {
    if (HOST) return;   // CodeVerifyStation keeps its own images
    const r = st.settings?.record; if (!r || r.autoSave === "off") return;
    if (r.autoSave === "ng" && it.status === "OK") return;
    const files = [];
    if (r.saveRaw) files.push(...(await api("/api/record", { body: { shotId: shot.shotId, vars: varsFor(it) } })).files);
    if (r.saveResult && it.res) files.push(...(await saveResultPicture(it, shot)).files);
    if (files.length) $("#cRecMsg").textContent = `Saved ${files.map(f => f.split(/[\\/]/).pop()).join(", ")}`;
  }

  $("#cSaveNow").addEventListener("click", async () => {
    if (!camOn() && !st.stillShot) { A.toast(t("camNotConnected"), true); return; }
    try {
      const shot = st.frozen && st.stillShot ? st.stillShot : null;
      const it = shot && st.lastItem?.shotId === shot.shotId ? st.lastItem : null;
      const r = await api("/api/record", { body: { shotId: shot?.shotId || null, vars: varsFor(it) } });
      const files = [...r.files];
      if (it && it.res && st.settings?.record?.saveResult) files.push(...(await saveResultPicture(it, shot)).files);
      $("#cRecMsg").textContent = `Saved ${files.map(f => f.split(/[\\/]/).pop()).join(", ")}`;
      refreshRecList();
    } catch (e) { A.toast(e.message, true); }
  });
  $("#cSeqGo").addEventListener("click", async () => {
    if (st.seq) { await api("/api/record/stop", { body: {} }).catch(() => { }); return; }
    const count = Math.max(2, Math.round(+$("#cSeqN").value || 10)), intervalMs = Math.round((+$("#cSeqT").value || 0) * 1000);
    try { await api("/api/record", { body: { count, intervalMs, vars: { program: S.t.name || "" } } }); st.seq = { n: 0, total: count }; $("#cSeqGo").textContent = "■ Stop"; $("#cRecMsg").textContent = `Recording 0/${count}…`; }
    catch (e) { A.toast(e.message, true); }
  });

  async function refreshRecList() {
    try {
      const d = await api(`/api/record/list?day=${encodeURIComponent($("#cRecDay").value || "")}`);
      const cur = $("#cRecDay").value || d.day;
      const days = d.days.includes(d.day) ? d.days : [d.day, ...d.days];
      $("#cRecDay").innerHTML = days.map(x => `<option ${x === cur ? "selected" : ""}>${x}</option>`).join("");
      $("#cRecCount").textContent = `(${d.files.length})`;
      $("#cRecList").innerHTML = d.files.length ? `<table class="tbl small">${d.files.slice(0, 200).map((f, i) => `<tr><td><a href="${BASE + f.url}" target="_blank">${esc(f.name)}</a></td><td class="num muted">${(f.size / 1e6).toFixed(1)} MB</td><td>${/\.(png|bmp)$/i.test(f.name) ? `<button class="btn sm" data-rm="${i}" title="Add to the Measure tab and measure">${esc(t("camMeasureFile"))}</button>` : ""}</td></tr>`).join("")}</table>` : `<span class="muted">—</span>`;
      $$("#cRecList [data-rm]").forEach(b => b.addEventListener("click", async () => {
        const f = d.files[+b.dataset.rm];
        if (!A.ready()) { A.toast(t("camNoProgram"), true); return; }
        const blob = await api(f.url, { blob: true });
        A.addShot(new File([blob], f.name, { type: blob.type, lastModified: Date.parse(f.time) }), { src: BASE + f.url, source: "file", time: f.time, select: true });
        A.toast(`${f.name} added to the Measure tab.`);
      }));
    } catch (e) { console.warn(e); }
  }
  $("#cRecRefresh").addEventListener("click", refreshRecList);
  $("#cRecDay").addEventListener("change", refreshRecList);
  $("#cRecListBox").addEventListener("toggle", e => { if (e.target.open) refreshRecList(); });

  // ---------------- app hooks ----------------
  A.hooks.tab.push(name => {
    if (name === "camera") { st.view.fit = st.view.fit || !st.fullW; requestDraw(); if (camOn() && !st.feats.length) loadFeatures(); progInfo(); }
    sendLive(); statusBar();
  });
  A.hooks.program.push(tpl => { applyProgram(tpl, true); requestDraw(); });
  A.hooks.role.push(() => updateUi());

  // ---------------- start ----------------
  async function hostBlob(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`camera image: HTTP ${r.status}`);
    return r.blob();
  }
  async function start() {
    if (HOST) {
      const poll = async () => { try { st.hostCam = await PM.host.call("cam.status"); } catch (e) { st.hostCam = null; } updateUi(); };
      await poll(); setInterval(poll, 10000);
      return;
    }
    try { const s = await api("/api/status"); st.bridge = s; st.cam = s.camera; updateUi(); loadSettings(); refreshCams(); if (camOn()) loadFeatures(); }
    catch (e) { st.bridge = null; updateUi(); }
    connectWs();
  }
  start();

  return { grab, api, state: st, isConnected: camOn, base: BASE };
})();
