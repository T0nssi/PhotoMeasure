// UI controller: part-program editor, batch measurement, report tab.
"use strict";
(() => {
  const E = PM.engine, V = PM.vision, G = PM.geom, VW = PM.viewer, I = PM.i18n;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f3 = v => (v == null || isNaN(v) ? "—" : (+v).toFixed(3));
  const MASTER_MAX = 2600, DISP_MAX = 1600, CAM_MAX = 6000; // camera images are measured at full resolution

  const S = {
    t: E.newTemplate(), master: null, masterRes: null, masterCal: null,
    tool: "pan", draft: null, selEl: null, ocrCache: {},
    items: [], sel: -1, queue: Promise.resolve(), cache: null,
    mview: { cx: 0, cy: 0, z: 1, rot: 0 }, mviewInit: false, pick: null, stale: false,
  };
  window.PMApp = S; // for debugging / tests
  const hooks = { role: [], tab: [], program: [], measured: [], chars: [] }; // used by the camera module (camera.js)

  // ================= common =================
  let toastTimer;
  function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500); }
  let busyN = 0;
  function busy(on, txt) { busyN += on ? 1 : -1; const b = $("#busy"); b.hidden = busyN <= 0; if (txt) b.textContent = txt; }
  const nextFrame = () => new Promise(r => setTimeout(r, 0));
  const later = fn => setTimeout(fn, 0); // re-render after the current input event has finished

  $$("#tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  function showTab(name) {
    if (!isAdmin() && ["template", "users"].includes(name)) name = "measure";
    $$("#tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
    $$("section.tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "template") tv.resize();
    if (name === "measure") { mv.resize(); if (S.sel < 0 && S.items.length) selectItem(0); }
    if (name === "report") renderReportTab();
    if (name === "users") renderUsers();
    if (name === "measure" || name === "template") renderLibrary();
    hooks.tab.forEach(f => { try { f(name); } catch (e) { console.error(e); } });
  }
  $("#uiLang").addEventListener("change", e => { I.setUi(e.target.value); PM.help.render(e.target.value); if ($("#loginDlg").classList.contains("show")) showLogin(); try { localStorage.setItem("pm.ui", e.target.value); } catch (x) { } });
  try { const l = localStorage.getItem("pm.ui"); if (l) { $("#uiLang").value = l; I.setUi(l); } } catch (x) { }
  PM.help.render($("#uiLang").value);

  // ---- theme (dark / light) ----
  function setTheme(th) {
    document.documentElement.dataset.theme = th;
    VW.bg = th === "light" ? "#d9dee5" : "#0b0f13";
    $("#themeName").textContent = th === "light" ? "Light" : "Dark";
    try { localStorage.setItem("pm.theme", th); } catch (x) { }
    S.tv && S.tv.draw(); S.mv && S.mv.draw();
  }
  $("#btnTheme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  const safeName = s => String(s || "part").replace(/[\\/:*?"<>|]+/g, "_").trim() || "part";

  // ================= users / roles =================
  const AU = PM.auth, LIB = PM.library;
  const isAdmin = () => S.user?.role === "admin";
  function applyRole() {
    const u = S.user;
    document.body.classList.toggle("logged-out", !u);
    document.body.classList.toggle("role-operator", !!u && u.role !== "admin");
    $("#userChip").textContent = u ? `👤 ${u.name} · ${AU.ROLES[u.role]}` : "—";
    if (u && !$("#rOperator").value) $("#rOperator").value = u.name;
    if (u && !isAdmin() && ["template", "users"].includes($$("#tabs button.active")[0]?.dataset.tab)) showTab("measure");
    hooks.role.forEach(f => { try { f(u); } catch (e) { console.error(e); } });
  }
  function showLogin() {
    const list = AU.users(), first = !list.length;
    $("#loginDlg").classList.add("show");
    $("#lgNameRow").hidden = first; $("#lgNewRow").hidden = !first; $("#lgPass2Row").hidden = !first; $("#lgRestoreRow").hidden = !first;
    $("#loginSub").textContent = I.t(first ? "loginFirst" : "loginSub");
    $("#btnLogin").textContent = I.t(first ? "lgCreate" : "lgLogin");
    $("#lgName").innerHTML = list.map(u => `<option>${esc(u.name)}</option>`).join("");
    try { const last = localStorage.getItem("pm.lastUser"); if (last && list.some(u => u.name === last)) $("#lgName").value = last; } catch (e) { }
    $("#lgPass").value = ""; $("#lgPass2").value = ""; $("#loginErr").textContent = "";
    setTimeout(() => (first ? $("#lgNew") : $("#lgPass")).focus(), 50);
  }
  async function doLogin() {
    const first = !AU.users().length;
    try {
      if (first) {
        if ($("#lgPass").value !== $("#lgPass2").value) throw new Error("the passwords are different");
        await AU.add($("#lgNew").value, "admin", $("#lgPass").value);
        S.user = await AU.login($("#lgNew").value, $("#lgPass").value);
      } else S.user = await AU.login($("#lgName").value, $("#lgPass").value);
      try { localStorage.setItem("pm.lastUser", S.user.name); } catch (e) { }
      $("#loginDlg").classList.remove("show");
      applyRole(); await afterLogin();
    } catch (err) { $("#loginErr").textContent = err.message; }
  }
  $("#btnLogin").addEventListener("click", doLogin);
  $("#lgPass").addEventListener("keydown", e => { if (e.key === "Enter" && $("#lgPass2Row").hidden) doLogin(); });
  $("#lgPass2").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  $("#btnLogout").addEventListener("click", () => {
    if (S.items.length && !confirm("Log out? Measured photos that are not reported yet stay in this window but the next user will see them.")) return;
    AU.logout(); S.user = null; applyRole(); showLogin();
  });

  // ---- users tab ----
  function renderUsers() {
    const list = AU.users();
    $("#userTable").innerHTML = `<tr><th>Name</th><th>Role</th><th>Created</th><th></th></tr>` + list.map(u => `<tr data-n="${esc(u.name)}"><td><b>${esc(u.name)}</b>${S.user?.name === u.name ? ' <span class="muted">(you)</span>' : ""}</td>
      <td><select data-act="role"><option value="operator" ${u.role === "operator" ? "selected" : ""}>Operator</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option></select></td>
      <td class="muted small">${(u.created || "").slice(0, 10)}</td>
      <td><button class="btn sm" data-act="pw">New password</button> <button class="btn sm danger" data-act="del">Delete</button></td></tr>`).join("");
    $$("#userTable tr[data-n]").forEach(tr => {
      const n = tr.dataset.n;
      tr.querySelector("[data-act=role]").addEventListener("change", e => { try { AU.setRole(n, e.target.value); if (n === S.user.name) { S.user.role = e.target.value; applyRole(); } } catch (err) { toast(err.message, true); } renderUsers(); });
      tr.querySelector("[data-act=pw]").addEventListener("click", async () => { const pw = prompt(`New password for ${n}:`); if (pw == null) return; try { await AU.setPassword(n, pw); toast("Password changed."); } catch (err) { toast(err.message, true); } });
      tr.querySelector("[data-act=del]").addEventListener("click", () => { if (n === S.user.name) { toast("You cannot delete yourself.", true); return; } if (!confirm(`Delete user ${n}?`)) return; try { AU.remove(n); } catch (err) { toast(err.message, true); } renderUsers(); });
    });
  }
  $("#btnUserAdd").addEventListener("click", async () => {
    if (!isAdmin()) return;
    try { await AU.add($("#uName").value, $("#uRole").value, $("#uPass").value); $("#uMsg").textContent = `Added ${$("#uName").value}.`; $("#uName").value = ""; $("#uPass").value = ""; renderUsers(); }
    catch (err) { $("#uMsg").textContent = err.message; }
  });

  // ---- backup: users + all programs in one file (move between PCs, or file:// <-> Camera Bridge) ----
  $("#btnBackupOut").addEventListener("click", async () => {
    if (!isAdmin()) return;
    const progs = [];
    for (const r of await LIB.list()) { const rec = await LIB.get(r.id); if (rec) progs.push(rec); }
    const data = { app: "PhotoMeasure", kind: "backup", version: 1, created: new Date().toISOString(), by: S.user.name, users: AU.users(), programs: progs, stations: PM.calib.list() };
    download(new Blob([JSON.stringify(data)], { type: "application/json" }), `PhotoMeasure_backup_${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Backup: ${data.users.length} users, ${progs.length} programs, ${data.stations.length} station calibrations.`);
  });
  async function restoreBackup(file) {
    const d = JSON.parse(await file.text());
    if (d.app !== "PhotoMeasure" || d.kind !== "backup") throw new Error("not a PhotoMeasure backup file");
    const nu = AU.importUsers(d.users || []);
    let np = 0; const have = new Map((await LIB.list()).map(r => [r.id, r]));
    for (const rec of d.programs || []) { const cur = have.get(rec.id); if (!cur || (rec.version || 0) > (cur.version || 0)) { await LIB.putRecord(rec); np++; } }
    const ns = PM.calib.importList(d.stations || []);
    return { nu, np, ns };
  }
  $("#btnBackupIn").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f || !isAdmin()) return;
    try { const r = await restoreBackup(f); toast(`Restored ${r.nu} users, ${r.np} programs and ${r.ns} station calibrations (existing users and newer programs were kept).`); renderUsers(); renderLibrary(); }
    catch (err) { toast("Restore failed: " + err.message, true); }
  });
  $("#lgRestore").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { const r = await restoreBackup(f); toast(`Restored ${r.nu} users and ${r.np} programs. Log in.`); showLogin(); }
    catch (err) { $("#loginErr").textContent = "Restore failed: " + err.message; }
  });

  // ---- program library ----
  async function renderLibrary() {
    const list = await LIB.list(), cur = S.t.id;
    const opt = r => `<option value="${r.id}" ${r.id === cur ? "selected" : ""}>${esc(r.name)}${r.partNo ? " · " + esc(r.partNo) : ""} (v${r.version || 1})</option>`;
    $("#libSel").innerHTML = list.length ? list.map(opt).join("") : '<option value="">(library is empty)</option>';
    const inLib = list.find(r => r.id === cur);
    $("#progSel").innerHTML = (inLib ? "" : `<option value="" selected>${isAdmin() ? "— working copy (not in library) —" : "— select a program —"}</option>`) + list.map(opt).join("");
    $("#libInfo").textContent = inLib ? `In library as v${inLib.version}, saved ${inLib.modified.slice(0, 16).replace("T", " ")}${inLib.by ? " by " + inLib.by : ""}` : "Not saved in the library yet.";
    $("#progInfo").textContent = inLib ? `v${inLib.version} · ${inLib.elements} tools · ${inLib.dims} dimensions` : (list.length ? "" : (isAdmin() ? "Save the program to the library so operators can use it." : "No programs yet: ask an admin."));
    S.libList = list;
  }
  $("#btnLibSave").addEventListener("click", async () => {
    if (!isAdmin()) return;
    if (!S.t.master?.frame) { toast("Set up the master photo and references first.", true); return; }
    const rec = await LIB.put(S.t, S.user.name); S.t.libVersion = rec.version; saveLocal();
    toast(`Saved "${rec.name}" to the library (v${rec.version}).`); renderLibrary();
  });
  $("#btnLibOpen").addEventListener("click", async () => { const id = $("#libSel").value; if (id) await openFromLibrary(id); });
  $("#btnLibDel").addEventListener("click", async () => {
    const id = $("#libSel").value, r = S.libList?.find(x => x.id === id); if (!r || !isAdmin()) return;
    if (!confirm(`Delete "${r.name}" from the library? Operators can no longer select it.`)) return;
    await LIB.del(id); toast("Deleted from the library."); renderLibrary();
  });
  $("#progSel").addEventListener("change", async e => {
    const id = e.target.value; if (!id) return;
    if (S.items.length && !confirm("Change the program? The photos will be measured again with the new program.")) { renderLibrary(); return; }
    await openFromLibrary(id);
    if (S.items.length) { S.items.forEach(it => { it.ov = {}; it.eov = {}; it.manualRefs = null; enqueue(it); }); renderList(); }
  });
  async function openFromLibrary(id) {
    const rec = await LIB.get(id); if (!rec) { toast("Program not found.", true); return; }
    busy(true, "Opening program…");
    try { await openTemplate(rec.data); try { localStorage.setItem("pm.lastProgram", id); } catch (e) { } toast(`Program "${rec.name}" v${rec.version} opened.`); }
    catch (err) { console.error(err); toast("Cannot open program: " + err.message, true); }
    busy(false); renderLibrary();
  }

  // ================= template editor =================
  const tv = new VW.Viewer($("#tplCanvas"));
  tv.layers = { showRoi: true, showPts: true, labels: true }; S.tv = tv;
  $("#tplRoi").addEventListener("change", e => { tv.layers.showRoi = e.target.checked; tv.draw(); });
  $("#tplPts").addEventListener("change", e => { tv.layers.showPts = e.target.checked; tv.draw(); });
  $("#tplFit").addEventListener("click", () => tplFit());
  function tplFit() {
    const t = S.t;
    if (t.master?.frame && (t.reportBox || t.elements.length > 2)) {
      const b = t.reportBox || E.corrBox(t), mx = 0.1 * (b.x1 - b.x0), my = 0.1 * (b.y1 - b.y0);
      tv.fit({ x0: b.x0 - mx, x1: b.x1 + mx, y0: b.y0 - my, y1: b.y1 + my });
    } else tv.fit();
  }

  $$("#tplTools [data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
  const HINT = {
    pan: "Drag = pan, wheel = zoom, click a tool or element to select it.",
    ref1: "Click inside reference hole 1 (REF1 = origin).", ref2: "Click inside reference hole 2 (REF2 = X direction).",
    circle: "Drag from the circle centre to its edge.", arc: "Click 3 points along the arc: start, middle, end.",
    line: "Drag along the edge from one end to the other. The arrow shows the scan direction (change it in the properties).",
    point: "Drag across the edge: the scan goes from the start to the end of the arrow.",
    ocr: "Drag a box around one line of marked text (corner to corner). Turn it in the properties if the text is vertical.",
    color: "Drag from the centre of a colour spot to the edge of the area to sample. Its colour on the master becomes the reference.",
    code: "Drag from the centre of the DataMatrix to one corner.", rbox: "Drag a rectangle around the part (picture area in reports).",
  };
  function setTool(tool) {
    if (!isAdmin() && tool !== "pan") return;
    if (!S.master && tool !== "pan") { toast("Load a master photo first."); return; }
    if (!S.t.master?.frame && !["pan", "ref1", "ref2"].includes(tool)) {
      if (fixedCal()) { toast(stationRec() ? "Load the master photo again." : "No station calibration: calibrate the station first (Camera tab).", true); return; }
      toast(two() ? "Set REF1 and REF2 first." : "Set REF1 first."); tool = S.t.master?.c1 && two() ? "ref2" : "ref1";
    }
    S.tool = tool; S.draft = null; S.redraw = null;
    $$("#tplTools [data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
    $("#tplHint").textContent = (tool === "ref1" && fixedCal() ? "Click the origin of the program (any point, e.g. a corner of the part). Positions are reported from the datum you choose." : HINT[tool]) || "";
    tv.preview = null; tplScene();
  }
  document.addEventListener("keydown", e => {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "Escape") { if ($("#tab-template").classList.contains("active")) setTool("pan"); S.pick = null; $("#pickHint").textContent = ""; mv.draw(); }
    if ($("#tab-measure").classList.contains("active")) {
      if (e.key === "ArrowRight") { selectItem(Math.min(S.items.length - 1, S.sel + 1)); e.preventDefault(); }
      if (e.key === "ArrowLeft") { selectItem(Math.max(0, S.sel - 1)); e.preventDefault(); }
    }
    if ((e.key === "Delete" || e.key === "Backspace") && $("#tab-template").classList.contains("active") && S.selEl && !S.selEl.startsWith("REF") && !S.selEl.startsWith("#")) deleteElement(S.selEl);
  });

  function tplScene() {
    const t = S.t;
    const proc = $("#tplProc").checked && S.master;
    if (proc && !S.masterProcCanvas) S.masterProcCanvas = V.grayCanvas(S.master.gray, MASTER_MAX);
    tv.set(S.master ? {
      img: proc ? S.masterProcCanvas : S.master.canvas, imgToPx: proc ? VW.A.scale(1 / S.masterProcCanvas.k) : null,
      frame: t.master?.frame || null, template: t.master?.frame ? t : null,
      result: S.masterRes, cands: !t.master?.frame ? S.master.cands : null, selected: S.selEl,
      handles: S.tool === "pan" && t.master?.frame ? handlesFor(t, S.selEl) : null,
    } : null);
    $("#tplBadge").textContent = `${t.name || "part"}${t.partNo ? " · " + t.partNo : ""} · ${t.elements.filter(e => e.tool !== "ref").length} el · ${t.dims.length} dim`;
  }
  $("#tplProc").addEventListener("change", () => tplScene());

  // ---- master photo ----
  $("#masterFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    await loadMaster(f, true);
  });
  async function loadMaster(file, fresh) {
    busy(true, "Loading master…");
    try {
      await V.whenCv();
      let p = await V.loadPhoto(file, MASTER_MAX, S.t.proc);
      let img = null, origW = null, origH = null;
      if (fresh) {
        origW = Math.round(p.w / p.loadScale); origH = Math.round(p.h / p.loadScale); // work on the same JPEG that is stored in the program, so values match after reopening
        img = p.canvas.toDataURL("image/jpeg", 0.88);
        const blob = await (await fetch(img)).blob();
        const date = p.date, ds = p.dateSource;
        p = await V.loadPhoto(new File([blob], file.name, { type: "image/jpeg" }), MASTER_MAX, S.t.proc); p.date = date; p.dateSource = ds;
      }
      if (fresh) { p.loadScale = p.w / origW; } else if (S.t.master?.origW) p.loadScale = p.w / S.t.master.origW;
      p.cands = fixedCal() ? [] : await V.findCircles(p, S.t.proc);
      S.master = p; S.masterRes = null; S.masterProcCanvas = null; S.masterDMKey = null; S.ocrCache = {};
      $("#procInfo").textContent = `${p.cands.length} circles found on the master.`;
      if (fresh) {
        S.t.master = { name: file.name, w: p.w, h: p.h, origW, origH, img, c1: null, c2: null, frame: null, patch: null };
        if (S.t.ref.Lsource !== "drawing") S.t.ref.L = null;
        tv.mode = "aligned";
        if (fixedCal()) {
          S.t.master.c1 = { cx: p.w / 2, cy: p.h / 2, r: 0 };
          const st = stationRec();
          if (!st) toast("Master loaded, but there is no station calibration for this program: calibrate the station first (Camera tab).", true);
          else { const chk = E.checkStation(st, p, null); if (!chk.ok) toast(chk.error, true); else { calibrateMaster(true); tplScene(); tv.fit(); setTool("pan"); toast(`Master loaded: ${origW}×${origH}px, scale from station calibration ${st.name || st.station}. Origin = image centre (change with ◎).`); } }
          if (!S.t.master.frame) { tplScene(); tv.fit(); }
        } else {
          tplScene(); tv.fit(); setTool("ref1");
          toast(`Master loaded: ${p.w}×${p.h}px, ${p.cands.length} circles found (yellow). Click REF1.`);
        }
      }
    } catch (err) { console.error(err); toast("Cannot load photo: " + err.message, true); }
    busy(false);
  }

  const two = () => E.modeOf(S.t) === "2c";
  const fixedCal = () => E.modeOf(S.t) === "cal";
  /** Station calibration used by the open program (newest one of its station). */
  const stationRec = () => (fixedCal() ? PM.calib.active(S.t.ref.station || "files") : null);
  const refsSet = () => { const m = S.t.master; return !!(m && m.c1 && (!two() || m.c2) && (!fixedCal() || (stationRec() && S.master && E.checkStation(stationRec(), S.master, null).ok))); };
  /** Recompute calibration after refs/diameters/mode change. Keeps ROIs on the same image spot. */
  function calibrateMaster(reframe = true) {
    const t = S.t, m = t.master;
    if (!refsSet()) {
      const hadFrame = !!m?.frame;
      if (m) { m.lastFrame = m.frame || m.lastFrame; m.frame = null; }
      S.masterCal = null; S.masterRes = null; updateCalInfo(); tplScene(); if (hadFrame) tv.fit(); return;
    }
    const f0 = m.frame || m.lastFrame;
    let sCal = null;
    if (fixedCal()) { const st = stationRec(); sCal = E.stationScale(st, S.master); t.ref.org = { x: m.c1.cx / S.master.loadScale, y: m.c1.cy / S.master.loadScale }; t.ref.calUsed = E.stationInfo(st); }
    const cal = E.masterCalibration(t, m.c1, two() ? m.c2 : null, sCal);
    if (f0 && reframe) reframeTemplate(t, f0, cal.frame);
    m.frame = cal.frame; m.lastFrame = null;
    S.masterCal = { ...cal, ok: true, auto: false };
    updateMasterRefData();
    remeasureMaster();
    if (!f0) { tplScene(); tv.fit(); }
  }
  /** Master image patches (alignment of new photos) and appearance statistics (comparison). */
  function updateMasterRefData() {
    const t = S.t, m = t.master;
    if (!m?.frame || !S.master) return;
    m.patch = E.masterPatch(t, S.master, m.frame);
    m.stats = E.appearanceOf(t, S.master, S.masterCal);
  }

  function reframeTemplate(t, f0, f1) {
    const mp = p => G.toMm(f1, G.toPx(f0, p)), k = f1.s / f0.s, dth = (f0.th - f1.th) * 180 / Math.PI;
    if (Math.abs(k - 1) < 1e-12 && Math.abs(dth) < 1e-9 && Math.hypot(f0.ox - f1.ox, f0.oy - f1.oy) < 1e-9) return;
    const fix = r => {
      if (!r) return;
      if (r.cx != null) { const c = mp({ x: r.cx, y: r.cy }); r.cx = c.x; r.cy = c.y; r.r *= k; r.band *= k; if (r.a0 != null) { r.a0 += dth; r.a1 += dth; } }
      if (r.p0) { r.p0 = mp(r.p0); r.p1 = mp(r.p1); if (r.hw != null) r.hw *= k; if (r.w != null) r.w *= k; }
    };
    for (const el of t.elements) fix(el.roi);
    for (const it of S.items) for (const r of Object.values(it.ov || {})) fix(r); // per-photo search areas follow the program frame
    if (t.code) { const c = mp(t.code); t.code = { x: c.x, y: c.y, size: t.code.size * k }; }
    if (t.reportBox) {
      const b = t.reportBox, q = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => mp({ x, y }));
      t.reportBox = { x0: Math.min(...q.map(p => p.x)), x1: Math.max(...q.map(p => p.x)), y0: Math.min(...q.map(p => p.y)), y1: Math.max(...q.map(p => p.y)) };
    }
  }

  function remeasureMaster(light = false) {
    if (!S.master || !S.t.master?.frame) return;
    const m = S.t.master;
    S.masterCal = { ...E.frameInfo(S.t, m.c1, two() ? m.c2 : null, m.frame), ok: true, auto: false };
    if (fixedCal() && stationRec()) S.masterCal.station = E.stationInfo(stationRec());
    const rr = E.setRotRef(S.t, S.master, S.masterCal);
    S.rotRefError = rr.ok ? null : rr.error;
    const elements = E.runElements(S.t, S.master, S.masterCal);
    for (const el of S.t.elements) if (el.tool === "ocr" && S.ocrCache[ocrKey(el)]) elements[el.id] = S.ocrCache[ocrKey(el)];
    if (S.masterDMKey !== S.t.master.img?.length + JSON.stringify(S.t.code)) { S.masterDM = E.readCode(S.t, S.master, S.masterCal); S.masterDMKey = S.t.master.img?.length + JSON.stringify(S.t.code); }
    S.masterRes = { cal: S.masterCal, elements, dims: E.evalDims(S.t, elements, { dm: S.masterDM }) };
    E.setAnchors(S.t, elements);
    if (S.t.elements.some(e => e.tool === "ocr" && !S.ocrCache[ocrKey(e)])) setTimeout(masterOcr, 0);
    if (light) { tplScene(); return; }
    updateCalInfo(); renderElements(); renderDims(); renderDatum(); renderRotOptions(); renderSerialOptions(); tplScene(); saveLocal();
    S.stale = S.items.length > 0; renderList();
  }

  function updateCalInfo() {
    const t = S.t, c = S.masterCal, m = t.master;
    const el = $("#calInfo");
    if (fixedCal()) { renderStationInfo(); if (!m || !refsSet()) return; }
    if (!m) { el.textContent = "Load a master photo."; return; }
    if (fixedCal()) {
      const st = stationRec(), age = PM.calib.stateOf(st);
      el.innerHTML = `Scale <b>${c.pxPerMm.toFixed(2)} px/mm</b> (${(c.s * 1000).toFixed(3)} µm/px) from station calibration <b>${esc(st.name || st.station)}</b> · ${new Date(st.date).toLocaleDateString()}${age.state === "expired" ? ' <span class="bad">expired</span>' : age.state === "soon" ? ' <span class="warn">expires soon</span>' : ""}` +
        `<br>Grid error RMS ${st.rmsUm != null ? st.rmsUm.toFixed(1) : "—"} µm · max ${st.maxUm != null ? st.maxUm.toFixed(1) : "—"} µm` +
        `<br>Part position: <b>${{ fixture: "fixture (no search)", shift: "search position", image: "search position + rotation" }[E.posOf(t)]}</b>` +
        (t.datum?.origin === "REF1" ? '<br><span class="warn">Datum origin is the program origin (not a feature of the part): set the datum on measured features for X/Y positions.</span>' : "") +
        (E.posOf(t) !== "fixture" && !t.reportBox ? '<br><span class="muted">Tip: draw the Report area around the part; the part is found by matching that area.</span>' : "");
      return;
    }
    if (!refsSet()) { el.innerHTML = `REF1: ${m.c1 ? "✔" : "click ◎ REF1"}${two() ? ` · REF2: ${m.c2 ? "✔" : "click ◎ REF2"}` : ""}`; return; }
    const lowRes = c.pxPerMm < (t.ref.minPxPerMm || 20);
    const rot = E.rotOf(t), rotTxt = rot === "ref2" ? "REF1 → REF2" : rot === "image" ? "image match with master" : rot === "none" ? "none (photo orientation)" : `element ${rot}`;
    let h = `Scale <b>${c.pxPerMm.toFixed(2)} px/mm</b> (${(c.s * 1000).toFixed(2)} µm/px)${lowRes ? ' <span class="warn">low</span>' : ""}`;
    if (two()) h += ` · L = <b>${f3(t.ref.L)} mm</b> (${t.ref.Lsource === "drawing" ? "from drawing" : "from master photo"})<br>REF1 Ø${(2 * m.c1.r).toFixed(1)}px · REF2 Ø${(2 * m.c2.r).toFixed(1)}px · diameter vs spacing check: <span class="${Math.abs(c.scaleDiffPct) > 3 ? "warn" : "ok"}">${c.scaleDiffPct.toFixed(2)}%</span>`;
    else h += `<br>Scale from REF1 Ø${(2 * m.c1.r).toFixed(1)}px = ${t.ref.d1} mm (one circle: no cross-check; a 1 px error on the diameter = ${(100 / (2 * m.c1.r)).toFixed(1)}% scale error)`;
    h += `<br>Rotation from: <b>${rotTxt}</b>${S.rotRefError ? ` <span class="bad">${esc(S.rotRefError)}</span>` : ""}`;
    if (two() && rot === "ref2" && Math.abs(Math.log(t.ref.ratioD)) < 0.05) h += '<br><span class="warn">REF1 and REF2 look the same size: orientation of new photos is decided by image matching.</span>';
    if (!two() && rot === "image") h += '<br><span class="muted">Tip: draw the Report area around the whole part; the rotation is found by matching that area.</span>';
    el.innerHTML = h;
  }

  // ---- part fields ----
  function fillPartFields() {
    const t = S.t;
    $("#tName").value = t.name || ""; $("#tPartNo").value = t.partNo || "";
    $("#tD1").value = t.ref.d1 ?? ""; $("#tD2").value = t.ref.d2 ?? "";
    $("#tL").value = t.ref.Lsource === "drawing" && t.ref.L ? t.ref.L : "";
    $("#tMinPx").value = t.ref.minPxPerMm || 20;
    $("#tMode").value = E.modeOf(t);
    renderSerialOptions();
    document.body.classList.toggle("mode1c", !two());
    document.body.classList.toggle("modecal", fixedCal());
    if (fixedCal()) { renderStationOptions(); $("#tPos").value = E.posOf(t); $("#tSearch").value = t.ref.searchMm || ""; }
    $$("[data-tool=ref2]").forEach(b => (b.hidden = !two()));
    $("#btnSwap").hidden = !two();
    $("#btnPick").textContent = two() ? I.t("pickRefs") : I.t("pickRef1");
    renderRotOptions(); fillProc();
  }
  function renderSerialOptions() {
    const t = S.t, ocrs = t.elements.filter(e => e.tool === "ocr"), cur = t.serialFrom || "dm";
    $("#tSerial").innerHTML = [["dm", "DataMatrix (2D code)"], ...ocrs.map(e => [e.id, `${e.id} text (OCR)`]), ["dm+" , "DataMatrix, else text"], ["file", "File name"]]
      .map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  }
  $("#tSerial").addEventListener("change", e => { S.t.serialFrom = e.target.value; saveLocal(); S.stale = S.items.length > 0; renderList(); });
  function renderRotOptions() {
    const t = S.t, cur = E.rotOf(t);
    const els = t.elements.filter(e => E.TOOLS[e.tool]?.measured && !["color", "ocr"].includes(e.tool));
    const opts = [...(two() ? [["ref2", "REF1 → REF2 direction"]] : []), ...els.map(e => [e.id, `${e.id} (${e.tool}${e.tool === "line" ? " direction" : ": direction from REF1"})`]), ["image", "Image match with master"], ["none", "None (keep photo orientation)"]];
    $("#tRot").innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  }
  $("#tRot").addEventListener("change", e => { S.t.ref.rotBy = e.target.value; calibrateMaster(true); toast("Rotation reference: " + e.target.selectedOptions[0].textContent); });
  $("#tMode").addEventListener("change", e => {
    const t = S.t, mode = e.target.value;
    if (mode === E.modeOf(t)) return;
    const was = E.modeOf(t);
    if (mode === "1c" || mode === "cal") {
      if (t.elements.some(x => x.id === "REF2") && !removeWithDeps("REF2", true)) { e.target.value = was; return; }
      t.ref.mode = mode;
      if (mode === "1c") { if (E.rotOf(t) === "ref2" || !t.ref.rotBy || t.ref.rotBy === "none" && was === "cal") t.ref.rotBy = "image"; }
      if (t.master) t.master.c2 = null;
      if (t.datum.axis === "REF2") t.datum.axis = "";
      if (mode === "cal") {
        if (!t.ref.station) t.ref.station = PM.calib.stations().find(r => r.station === PM.camera?.state?.cam?.camera?.serial)?.station || PM.calib.stations()[0]?.station || "files";
        if (!t.ref.pos) t.ref.pos = "image";
        if (t.master) { if (!t.master.origW) { t.master.c1 = null; t.master.frame = null; toast("Load the master photo again for the fixed calibration.", true); } else if (S.master) t.master.c1 = t.master.c1 && t.master.c1.r ? { ...t.master.c1, r: 0 } : (t.master.c1 || { cx: S.master.w / 2, cy: S.master.h / 2, r: 0 }); }
      } else if (was === "cal" && t.master) { t.master.c1 = null; t.master.frame = null; }
    } else {
      if (was === "cal" && t.master) { t.master.c1 = null; t.master.frame = null; }
      t.ref.mode = "2c";
      if (!t.elements.some(x => x.id === "REF2")) t.elements.splice(1, 0, { id: "REF2", name: "Reference circle 2", tool: "ref", which: 2 });
      if (t.ref.rotBy === "image" || t.ref.rotBy === "none") t.ref.rotBy = "ref2";
    }
    fillPartFields(); calibrateMaster(true); renderElements(); renderDatum();
    if (!fixedCal() && S.master && !S.master.cands?.length) V.findCircles(S.master, t.proc).then(c => { S.master.cands = c; tplScene(); });
    if (!fixedCal() && S.master && !t.master?.c1) setTool("ref1");
    if (two() && S.master && !t.master?.c2) { setTool("ref2"); toast("Click REF2 on the master photo and check the REF2 hole Ø."); }
  });
  function renderStationOptions() {
    const t = S.t, cur = t.ref.station || "files", all = PM.calib.stations();
    const opts = all.map(r => [r.station, `${r.name || r.station}${r.station !== "files" ? " · " + r.station : ""} (${new Date(r.date).toLocaleDateString()})`]);
    if (!opts.some(o => o[0] === cur)) opts.unshift([cur, `${cur === "files" ? "Photos from files" : "Camera " + cur} – not calibrated`]);
    $("#tStation").innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  }
  function renderStationInfo() {
    const st = stationRec(), el = $("#calInfo");
    if (!st) { el.innerHTML = `<span class="bad">No station calibration for "${esc(S.t.ref.station || "files")}".</span> Calibrate the station with a calibration plate (Camera tab → Station calibration), then load the master photo.`; return; }
    if (!S.t.master) { el.textContent = "Load a master photo (from the same camera and settings as the calibration)."; return; }
    if (S.master) { const chk = E.checkStation(st, S.master, null); if (!chk.ok) { el.innerHTML = `<span class="bad">${esc(chk.error)}</span>`; return; } }
    if (!S.t.master.origW) el.innerHTML = '<span class="warn">Load the master photo again (its original size is needed for the fixed calibration).</span>';
  }
  $("#tStation").addEventListener("change", e => { S.t.ref.station = e.target.value; if (S.master && S.t.master?.origW && !S.t.master.c1) S.t.master.c1 = { cx: S.master.w / 2, cy: S.master.h / 2, r: 0 }; calibrateMaster(true); updateCalInfo(); saveLocal(); });
  $("#tPos").addEventListener("change", e => { S.t.ref.pos = e.target.value; calibrateMaster(false); updateCalInfo(); saveLocal(); S.stale = S.items.length > 0; renderList(); });
  $("#tSearch").addEventListener("change", e => { S.t.ref.searchMm = +e.target.value > 0 ? +e.target.value : null; saveLocal(); S.stale = S.items.length > 0; renderList(); });
  $("#tName").addEventListener("input", e => { S.t.name = e.target.value; tplScene(); saveLocal(); });
  $("#tPartNo").addEventListener("input", e => { S.t.partNo = e.target.value; tplScene(); saveLocal(); });
  $("#tMinPx").addEventListener("change", e => { S.t.ref.minPxPerMm = +e.target.value || 20; updateCalInfo(); saveLocal(); });
  for (const id of ["#tD1", "#tD2", "#tL"]) $(id).addEventListener("change", () => {
    const d1 = +$("#tD1").value, d2 = two() ? +$("#tD2").value : (S.t.ref.d2 || d1), L = +$("#tL").value;
    if (!(d1 > 0) || !(d2 > 0)) { toast("Hole diameters must be > 0", true); return; }
    S.t.ref.d1 = d1; S.t.ref.d2 = d2;
    if (L > 0) { S.t.ref.L = L; S.t.ref.Lsource = "drawing"; } else { S.t.ref.Lsource = "master"; }
    calibrateMaster(true);
  });

  // ---- image processing settings ----
  function fillProc() {
    const P = S.t.proc = V.procOf(S.t.proc);
    $$("#procCard [data-p]").forEach(i => { const k = i.dataset.p; if (i.type === "checkbox") i.checked = !!P[k]; else i.value = P[k]; });
    $$("#procCard [data-o]").forEach(o => (o.textContent = P[o.dataset.o]));
    $$("#procCard [data-d]").forEach(i => (i.value = P.det[i.dataset.d]));
    $$("#procCard [data-r]").forEach(i => (i.value = P.ref[i.dataset.r]));
  }
  $$("#procCard [data-p]").forEach(i => {
    i.addEventListener("input", () => { const o = $(`#procCard [data-o=${i.dataset.p}]`); if (o) o.textContent = i.value; });
    i.addEventListener("change", () => {
      const k = i.dataset.p, P = S.t.proc;
      P[k] = i.type === "checkbox" ? i.checked : i.tagName === "SELECT" ? i.value : +i.value;
      if (k === "matchMaster") { saveLocal(); S.stale = S.items.length > 0; renderList(); return; }
      applyProc();
    });
  });
  $$("#procCard [data-d]").forEach(i => i.addEventListener("change", () => { S.t.proc.det[i.dataset.d] = +i.value; applyProc(); }));
  $$("#procCard [data-r]").forEach(i => i.addEventListener("change", () => { S.t.proc.ref[i.dataset.r] = +i.value; applyProc(); }));
  $("#btnProcReset").addEventListener("click", () => { S.t.proc = V.defaultProc(); fillProc(); applyProc(); });
  let procT;
  function applyProc() {
    clearTimeout(procT);
    procT = setTimeout(async () => {
      saveLocal();
      S.items.forEach(it => { it.procDisp = null; }); S.stale = S.items.length > 0; renderList();
      if (!S.master) return;
      busy(true, "Processing…"); await nextFrame();
      try {
        V.makeGray(S.master, S.t.proc); S.masterProcCanvas = null;
        S.master.cands = await V.findCircles(S.master, S.t.proc);
        const m = S.t.master, P = S.t.proc;
        for (const k of ["c1", "c2"]) if (m?.[k]) { const c = V.refineCircle(S.master.gray, m[k], P.ref); if (c && Math.abs(c.r - m[k].r) < 0.3 * m[k].r) m[k] = { cx: c.cx, cy: c.cy, r: c.r, rms: c.rms, coverage: c.coverage }; }
        $("#procInfo").textContent = `${S.master.cands.length} circles found on the master with these settings.`;
        calibrateMaster(true);
      } catch (err) { console.error(err); toast("Processing failed: " + err.message, true); }
      busy(false);
    }, 250);
  }

  // ---- drawing on the master ----
  tv.onTool = (type, m, e) => {
    const t = S.t, tool = S.tool, f = t.master?.frame;
    const zoomMm = Math.hypot(...tv.T().slice(0, 2)) / (window.devicePixelRatio || 1); // css px per world unit
    const pxToMm = f ? f.s : 1;
    if (tool === "pan") {
      if (type === "down") {
        const h = f && hitHandle(tv, handlesFor(t, S.selEl), e);
        if (h) { S.hdrag = { k: h.k, id: S.selEl, m0: m, roi0: JSON.parse(JSON.stringify(roiOf(t, S.selEl))) }; return true; }
        return false;
      }
      if (type === "move" && S.hdrag) {
        setRoi(t, S.hdrag.id, applyHandle(kindOf(t, S.hdrag.id), S.hdrag.roi0, S.hdrag.k, m, S.hdrag.m0));
        cancelAnimationFrame(S.hraf); S.hraf = requestAnimationFrame(() => remeasureMaster(true));
        return true;
      }
      if (type === "up" && S.hdrag) {
        const id = S.hdrag.id; S.hdrag = null;
        if (id === "#rbox") { updateMasterRefData(); toast("Report area changed."); }
        if (id === "#code") testCode();
        remeasureMaster(); renderProps();
        return true;
      }
      if (type === "click") { const id = hitTest(t, S.masterRes?.elements, m, 10 / zoomMm, true); selectElement(id ?? null); }
      return false;
    }
    if (tool === "ref1" || tool === "ref2") {
      if (type === "down") return true;
      if (type !== "up") return true;
      const px = f ? G.toPx(f, m) : m;
      if (fixedCal()) { t.master.c1 = { cx: px.x, cy: px.y, r: 0 }; calibrateMaster(true); setTool("pan"); tplScene(); toast("Program origin moved."); return true; }
      const c = snapCircle(S.master, px, tool === "ref1" ? t.master.c2 : t.master.c1);
      if (!c) { toast("No circle edge found there. Click inside the hole, close to its centre.", true); return true; }
      if (tool === "ref1") t.master.c1 = c; else t.master.c2 = c;
      if (two() && t.master.c1 && t.master.c2 && Math.hypot(t.master.c1.cx - t.master.c2.cx, t.master.c1.cy - t.master.c2.cy) < t.master.c1.r) { toast("REF1 and REF2 are the same hole.", true); if (tool === "ref2") t.master.c2 = null; else t.master.c1 = null; return true; }
      calibrateMaster(true);
      if (tool === "ref1" && two() && !t.master.c2) setTool("ref2"); else setTool("pan");
      tplScene();
      return true;
    }
    if (!f) return false;
    // shape tools (world = mm)
    if (tool === "arc") {
      if (type === "down") return true;
      if (type === "up") {
        S.draft = S.draft || { pts: [] }; S.draft.pts.push(m);
        if (S.draft.pts.length === 3) { const [a, b, c] = S.draft.pts; S.draft = null; tv.preview = null; createArc(a, b, c); }
      }
      if (type === "hover" && S.draft) { S.draft.hover = m; }
      drawDraft(); return true;
    }
    if (type === "down") { S.draft = { a: m, b: m }; drawDraft(); return true; }
    if (type === "move" && S.draft) { S.draft.b = m; drawDraft(); return true; }
    if (type === "up" && S.draft) {
      const { a } = S.draft, b = m; S.draft = null; tv.preview = null;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L * zoomMm < 6) { tplScene(); return true; }
      if (tool === "ocr") addOcr({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), ang: 0 });
      else if (tool === "color") addColor({ cx: a.x, cy: a.y, r: L });
      else if (tool === "circle") addMeasured("circle", { cx: a.x, cy: a.y, r: L, band: Math.max(0.2 * L, 8 * pxToMm) }, { ...E.defaultEdge(), dir: "in" });
      else if (tool === "line") addMeasured("line", { p0: a, p1: b, hw: Math.max(0.12 * L, 10 * pxToMm), side: 1 }, { ...E.defaultEdge(), select: "strongest" });
      else if (tool === "point") addMeasured("point", { p0: a, p1: b, w: 5 * pxToMm }, { ...E.defaultEdge() });
      else if (tool === "code") { const s = 2 * Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); t.code = { x: a.x, y: a.y, size: s }; testCode(); S.selEl = "#code"; setTool("pan"); saveLocal(); }
      else if (tool === "rbox") { t.reportBox = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }; updateMasterRefData(); setTool("pan"); remeasureMaster(); toast("Report area set (also used to match new photos with the master)."); }
      return true;
    }
    return true;
  };

  function drawDraft() {
    const d = S.draft, tool = S.tool;
    if (!d) { tv.preview = null; tv.draw(); return; }
    tv.preview = (ctx, P, dpr) => {
      ctx.save(); ctx.strokeStyle = "#fde047"; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([5, 4]);
      if (tool === "arc") {
        const pts = [...d.pts, d.hover].filter(Boolean).map(P);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.fillStyle = "#fde047"; d.pts.map(P).forEach(p => ctx.fillRect(p.x - 3 * dpr, p.y - 3 * dpr, 6 * dpr, 6 * dpr));
      } else {
        const a = P(d.a), b = P(d.b), L = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.beginPath();
        if (tool === "circle" || tool === "color") ctx.arc(a.x, a.y, L, 0, 7);
        else if (tool === "code") { const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.rect(a.x - s, a.y - s, 2 * s, 2 * s); }
        else if (tool === "rbox" || tool === "ocr") ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        else { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        ctx.stroke();
      }
      ctx.restore();
    };
    tv.draw();
  }

  function createArc(a, b, c) {
    const k = G.circle3(a, b, c);
    if (!k) { toast("The 3 points are on a line.", true); return; }
    const ang = p => Math.atan2(p.y - k.cy, p.x - k.cx) * 180 / Math.PI;
    let s = ang(a), m = ang(b), e = ang(c);
    const norm = x => ((x % 360) + 360) % 360;
    let a0, a1;
    if (norm(m - s) < norm(e - s)) { a0 = s; a1 = s + norm(e - s); } else { a0 = e; a1 = e + norm(s - e); }
    const f = S.t.master.frame;
    addMeasured("arc", { cx: k.cx, cy: k.cy, r: k.r, band: Math.max(0.2 * k.r, 8 * f.s), a0, a1 }, { ...E.defaultEdge(), dir: "in" });
  }

  function snapCircle(photo, px, other) {
    // a found candidate containing the click, else local refinement with a guessed radius
    let best = null;
    for (const c of photo.cands || []) {
      const d = Math.hypot(c.cx - px.x, c.cy - px.y);
      if (d < c.r * 1.05 && (!best || c.r < best.r)) best = c;
    }
    if (best) return { cx: best.cx, cy: best.cy, r: best.r, rms: best.rms, coverage: best.coverage };
    for (const r of [other ? other.r : 40, 25, 60, 90, 15]) {
      const c = V.refineCircle(photo.gray, { cx: px.x, cy: px.y, r }, { inner: 0.3, outer: 1.8 });
      if (c && c.coverage > 0.6 && Math.hypot(c.cx - px.x, c.cy - px.y) < c.r) return { cx: c.cx, cy: c.cy, r: c.r, rms: c.rms, coverage: c.coverage };
    }
    return null;
  }

  function addMeasured(tool, roi, edge) {
    const t = S.t;
    if (S.redraw) { // replace ROI of an existing element
      const el = t.elements.find(e => e.id === S.redraw && e.tool === tool);
      if (el) { el.roi = roi; S.redraw = null; S.selEl = el.id; remeasureMaster(); setTool("pan"); return; }
    }
    const id = E.nextId(t, E.PREFIX[tool], "el");
    const names = { circle: "Circle", arc: "Arc", line: "Line", point: "Edge point" };
    t.elements.push({ id, name: `${names[tool]} ${id}`, tool, roi, edge, n: tool === "circle" ? 72 : tool === "arc" ? 36 : tool === "line" ? 30 : 1 });
    S.selEl = id;
    remeasureMaster();
    const r = S.masterRes.elements[id];
    if (r?.error) toast(`${id}: ${r.error}. Adjust the search area or edge settings.`, true);
  }

  function addOcr(roi) {
    const t = S.t;
    if (roi.w < 0.2 || roi.h < 0.1) { toast("Draw the box around the text.", true); return; }
    if (S.redraw) { const el = t.elements.find(e => e.id === S.redraw && e.tool === "ocr"); if (el) { el.roi = { ...roi, ang: el.roi.ang || 0 }; S.redraw = null; S.selEl = el.id; remeasureMaster(); setTool("pan"); return; } }
    const id = E.nextId(t, "T", "el");
    t.elements.push({ id, name: `Text ${id}`, tool: "ocr", roi, format: "", lines: 1, polarity: "auto", autoDim: true });
    S.selEl = id; remeasureMaster(); setTool("pan");
    toast(`${id}: reading the text… (the OCR engine loads on first use, a few seconds)`);
  }
  /** OCR on the master (async, cached): fills S.masterRes text results, then re-renders. */
  const ocrKey = el => JSON.stringify([S.t.master?.img?.length, el.roi, el.format, el.lines, el.polarity, el.reader || "", el.reader ? PM.charml?.models.get(el.reader)?.date : 0]);
  async function masterOcr() {
    const els = S.t.elements.filter(e => e.tool === "ocr" && !S.ocrCache[ocrKey(e)]);
    if (!els.length || !S.master || !S.masterCal || S.ocrBusy) return;
    S.ocrBusy = true; busy(true, "Reading text…");
    try {
      for (const el of els) {
        const key = ocrKey(el); // settings at the start: a reading for older settings must not be stored for the new ones
        let r;
        try { r = await E.readOcr(S.master, E.ocrBox(el, S.masterCal), el); } catch (e) { r = { text: "", conf: 0, formatOk: false, error: e.message }; }
        if (key !== ocrKey(el)) continue;
        S.ocrCache[key] = { type: "text", x: el.roi.cx, y: el.roi.cy, w: el.roi.w, h: el.roi.h, ang: el.roi.ang || 0, text: r.text, raw: r.raw, conf: r.conf, formatOk: r.formatOk, image: r.image, mode: r.mode || null, reader: el.reader || "", ...(r.text ? {} : { error: r.error || "no text found" }) };
        if (el.autoDim) { // first reading: suggest a format and add a text check
          el.autoDim = false;
          if (r.text && !el.format) { el.format = r.text.replace(/[A-Z]/g, "A").replace(/[0-9]/g, "9").replace(/[^A9]/g, "?"); delete S.ocrCache[key]; }
          const did = E.nextId(S.t, "D", "dim");
          S.t.dims.push({ id: did, name: `Text ${el.id}`, kind: "text", a: el.id, b: null, spec: { op: "format" } });
          toast(`${el.id} read "${r.text}" (${Math.round(r.conf)} %). Format set to ${el.format}; check "${did}" added. Change it to = text, {DM} etc. in Dimensions.`);
        }
      }
    } catch (err) { console.error(err); toast("OCR failed: " + err.message, true); }
    S.ocrBusy = false; busy(false);
    remeasureMaster();
    if (S.t.elements.some(e => e.tool === "ocr" && !S.ocrCache[ocrKey(e)])) masterOcr();
  }

  function addColor(roi) {
    const t = S.t;
    if (S.redraw) { const el = t.elements.find(e => e.id === S.redraw && e.tool === "color"); if (el) { el.roi = roi; S.redraw = null; S.selEl = el.id; remeasureMaster(); setTool("pan"); return; } }
    const id = E.nextId(t, "K", "el");
    const el = { id, name: `Colour ${id}`, tool: "color", roi };
    t.elements.push(el);
    remeasureMaster(false);
    if (E.teachColor(el, S.masterRes.elements[id])) {
      const did = E.nextId(t, "D", "dim");
      t.dims.push({ id: did, name: `Colour ${id}`, kind: "color", a: id, b: null, tolP: 10 });
    }
    S.selEl = id; remeasureMaster(); setTool("pan");
    const r = S.masterRes.elements[id];
    toast(r && !r.error ? `${id} taught: RGB ${r.rgb.map(v => Math.round(v)).join(", ")}. Dimension "Colour ${id}" added (ΔE ≤ 10).` : `${id}: ${r?.error}`, !!r?.error);
  }

  function testCode() {
    const t = S.t;
    const txt = E.readCode(t, S.master, S.masterCal);
    toast(txt ? `DataMatrix read: ${txt}` : "No DataMatrix decoded in that area (it will still try the whole photo).", !txt);
  }

  /** Element (or "#code" / "#rbox" area) under the point m (mm). res = measured results. */
  function hitTest(t, res, m, tolMm, areas) {
    res = res || {};
    let best, bd = tolMm;
    for (const el of t.elements) {
      const r = res[el.id]; let d = Infinity;
      if (r && !r.error) {
        if (r.type === "circle") d = Math.min(Math.abs(Math.hypot(m.x - r.cx, m.y - r.cy) - r.r), Math.hypot(m.x - r.cx, m.y - r.cy));
        else if (r.type === "line") { const q = Math.max(r.t0, Math.min(r.t1, (m.x - r.px) * r.dx + (m.y - r.py) * r.dy)); d = Math.hypot(m.x - r.px - q * r.dx, m.y - r.py - q * r.dy); }
        else if (r.type === "point") d = Math.hypot(m.x - r.x, m.y - r.y);
        else if (r.type === "color") d = Math.max(0, Math.hypot(m.x - r.x, m.y - r.y) - r.r);
        else if (r.type === "text") d = Math.max(0, Math.hypot(m.x - r.x, m.y - r.y) - Math.min(r.w || 0, r.h || 0) / 2);
      }
      if (el.roi) { const c = el.roi.cx != null ? { x: el.roi.cx, y: el.roi.cy } : { x: (el.roi.p0.x + el.roi.p1.x) / 2, y: (el.roi.p0.y + el.roi.p1.y) / 2 }; d = Math.min(d, Math.hypot(m.x - c.x, m.y - c.y)); }
      if (d < bd) { bd = d; best = el.id; }
    }
    if (best) return best;
    if (areas && t.code && Math.abs(m.x - t.code.x) < t.code.size / 2 && Math.abs(m.y - t.code.y) < t.code.size / 2) return "#code";
    if (areas && t.reportBox) { const b = t.reportBox; const inside = m.x > b.x0 - tolMm && m.x < b.x1 + tolMm && m.y > b.y0 - tolMm && m.y < b.y1 + tolMm;
      const edge = Math.min(Math.abs(m.x - b.x0), Math.abs(m.x - b.x1), Math.abs(m.y - b.y0), Math.abs(m.y - b.y1)); if (inside && edge < tolMm) return "#rbox"; }
    return null;
  }

  // ---- search-area handles (drag to move / resize) ----
  function roiOf(t, id, ov) {
    if (id === "#code") return t.code; if (id === "#rbox") return t.reportBox;
    const el = t.elements.find(e => e.id === id); if (!el || !el.roi) return null;
    return (ov && ov[id]) || el.roi;
  }
  function kindOf(t, id) { if (id === "#code") return "code"; if (id === "#rbox") return "rbox"; return t.elements.find(e => e.id === id)?.tool; }
  function setRoi(t, id, roi) {
    if (id === "#code") t.code = roi; else if (id === "#rbox") t.reportBox = roi;
    else { const el = t.elements.find(e => e.id === id); if (el) el.roi = roi; }
  }
  function handlesFor(t, id, ov) {
    const r = id && roiOf(t, id, ov), k = id && kindOf(t, id); if (!r) return null;
    const H = (kk, x, y) => ({ k: kk, x, y });
    if (k === "circle" || k === "arc") {
      const A = (k === "arc" ? (r.a0 + r.a1) / 2 : -45) * Math.PI / 180, c = Math.cos(A), sn = Math.sin(A);
      const hs = [H("c", r.cx, r.cy), H("r", r.cx + r.r * c, r.cy + r.r * sn), H("b", r.cx + (r.r + r.band) * c, r.cy + (r.r + r.band) * sn)];
      if (k === "arc") for (const [kk, a] of [["a0", r.a0], ["a1", r.a1]]) hs.push(H(kk, r.cx + r.r * Math.cos(a * Math.PI / 180), r.cy + r.r * Math.sin(a * Math.PI / 180)));
      return hs;
    }
    if (k === "line" || k === "point") {
      const mx = (r.p0.x + r.p1.x) / 2, my = (r.p0.y + r.p1.y) / 2, hs = [H("c", mx, my), H("p0", r.p0.x, r.p0.y), H("p1", r.p1.x, r.p1.y)];
      if (k === "line") { const L = Math.hypot(r.p1.x - r.p0.x, r.p1.y - r.p0.y) || 1, nx = -(r.p1.y - r.p0.y) / L, ny = (r.p1.x - r.p0.x) / L; hs.push(H("w", mx + nx * r.hw, my + ny * r.hw)); }
      return hs;
    }
    if (k === "ocr") { const q = VW.rectPts(r.cx, r.cy, r.w, r.h, r.ang || 0); return [H("c", r.cx, r.cy), H("r", q[2].x, q[2].y)]; }
    if (k === "color") return [H("c", r.cx, r.cy), H("r", r.cx + r.r * Math.SQRT1_2, r.cy - r.r * Math.SQRT1_2)];
    if (k === "code") return [H("c", r.x, r.y), H("r", r.x + r.size / 2, r.y + r.size / 2)];
    if (k === "rbox") return [H("c", (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2), H("q00", r.x0, r.y0), H("q10", r.x1, r.y0), H("q11", r.x1, r.y1), H("q01", r.x0, r.y1)];
    return null;
  }
  function hitHandle(viewer, hs, ev) {
    if (!hs) return null;
    const rc = viewer.c.getBoundingClientRect(), dpr = viewer.c.width / rc.width, T = viewer.T();
    const sx = (ev.clientX - rc.left) * dpr, sy = (ev.clientY - rc.top) * dpr;
    let best = null, bd = 11 * dpr;
    for (const h of hs) { const q = VW.A.ap(T, h), d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  /** New ROI after dragging handle k from m0 to m (all mm). */
  function applyHandle(kind, r0, k, m, m0) {
    const r = JSON.parse(JSON.stringify(r0)), dx = m.x - m0.x, dy = m.y - m0.y, deg = (x, y) => Math.atan2(y, x) * 180 / Math.PI;
    if (kind === "circle" || kind === "arc") {
      if (k === "c") { r.cx += dx; r.cy += dy; }
      else if (k === "r") r.r = Math.max(0.05, Math.hypot(m.x - r.cx, m.y - r.cy));
      else if (k === "b") r.band = Math.max(0.02, Math.hypot(m.x - r.cx, m.y - r.cy) - r.r);
      else if (k === "a0" || k === "a1") {
        let a = deg(m.x - r.cx, m.y - r.cy);
        if (k === "a0") { while (a > r.a1) a -= 360; while (a < r.a1 - 359) a += 360; r.a0 = a; }
        else { while (a < r.a0) a += 360; while (a > r.a0 + 359) a -= 360; r.a1 = a; }
      }
    } else if (kind === "line" || kind === "point") {
      if (k === "c") { r.p0 = { x: r.p0.x + dx, y: r.p0.y + dy }; r.p1 = { x: r.p1.x + dx, y: r.p1.y + dy }; }
      else if (k === "p0") r.p0 = { x: m.x, y: m.y };
      else if (k === "p1") r.p1 = { x: m.x, y: m.y };
      else if (k === "w") { const L = Math.hypot(r.p1.x - r.p0.x, r.p1.y - r.p0.y) || 1, nx = -(r.p1.y - r.p0.y) / L, ny = (r.p1.x - r.p0.x) / L; r.hw = Math.max(0.02, Math.abs((m.x - (r.p0.x + r.p1.x) / 2) * nx + (m.y - (r.p0.y + r.p1.y) / 2) * ny)); }
    } else if (kind === "ocr") {
      if (k === "c") { r.cx += dx; r.cy += dy; }
      else { const a = (r.ang || 0) * Math.PI / 180, ux = m.x - r.cx, uy = m.y - r.cy; r.w = Math.max(0.2, 2 * Math.abs(ux * Math.cos(a) + uy * Math.sin(a))); r.h = Math.max(0.1, 2 * Math.abs(-ux * Math.sin(a) + uy * Math.cos(a))); }
    } else if (kind === "color") {
      if (k === "c") { r.cx += dx; r.cy += dy; } else r.r = Math.max(0.05, Math.hypot(m.x - r.cx, m.y - r.cy));
    } else if (kind === "code") {
      if (k === "c") { r.x += dx; r.y += dy; } else r.size = Math.max(0.2, 2 * Math.max(Math.abs(m.x - r.x), Math.abs(m.y - r.y)));
    } else if (kind === "rbox") {
      if (k === "c") { r.x0 += dx; r.x1 += dx; r.y0 += dy; r.y1 += dy; }
      else { if (k[1] === "0") r.x0 = m.x; else r.x1 = m.x; if (k[2] === "0") r.y0 = m.y; else r.y1 = m.y;
        const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1); Object.assign(r, { x0, x1, y0, y1 }); }
    }
    return r;
  }

  function selectElement(id) { S.selEl = id; renderElements(); tplScene(); }

  // ---- element table + properties ----
  function elSummary(r) {
    if (!r) return "";
    if (r.error) return `<span class="bad">${esc(r.error)}</span>`;
    if (r.type === "circle") return `Ø ${f3(2 * r.r)}`;
    if (r.type === "line") return `∠ ${(Math.atan2(r.dy, r.dx) * 180 / Math.PI).toFixed(2)}°`;
    if (r.type === "point") return `${f3(r.x)}, ${f3(r.y)}`;
    if (r.type === "text") return r.pending ? "reading…" : `"${esc(r.text)}" ${Math.round(r.conf)}%`;
    if (r.type === "color") return `<span class="sw" style="background:rgb(${r.rgb.map(Math.round).join(",")})"></span>${r.dE != null ? "ΔE " + r.dE.toFixed(1) : "not taught"}`;
    return "";
  }
  function renderElements() {
    const t = S.t, res = S.masterRes?.elements || {};
    $("#elTable").innerHTML = `<tr><th>ID</th><th>Name</th><th>Tool</th><th class="num">Master</th><th></th></tr>` + t.elements.map(el =>
      `<tr class="click ${S.selEl === el.id ? "sel" : ""}" data-id="${el.id}"><td><b>${el.id}</b></td><td><input class="nm" data-k="name" value="${esc(el.name)}"></td><td>${esc(E.describeElement(el))}</td><td class="num">${elSummary(res[el.id])}</td><td>${el.tool === "ref" ? "" : '<button class="x" title="Delete">✕</button>'}</td></tr>`).join("");
    $$("#elTable tr[data-id]").forEach(tr => {
      const id = tr.dataset.id;
      tr.addEventListener("click", e => { if (e.target.matches("input, button")) return; selectElement(id); });
      tr.querySelector("input").addEventListener("change", e => { t.elements.find(x => x.id === id).name = e.target.value; saveLocal(); });
      tr.querySelector(".x")?.addEventListener("click", () => deleteElement(id));
    });
    renderProps(); renderConsSelects(); renderDimSelects();
  }

  /** Remove an element plus everything built on it (constructions, dimensions). Returns false if cancelled. */
  function removeWithDeps(id, ask) {
    const t = S.t, dead = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const el of t.elements) if (!dead.has(el.id) && (el.args || []).some(a => dead.has(a))) { dead.add(el.id); grew = true; } }
    const dimsGone = t.dims.filter(d => dead.has(d.a) || dead.has(d.b));
    if (ask && (dead.size > 1 || dimsGone.length) && !confirm(`Delete ${[...dead].join(", ")}${dimsGone.length ? " and dimensions " + dimsGone.map(d => d.id).join(", ") : ""}?`)) return false;
    t.elements = t.elements.filter(e => !dead.has(e.id));
    t.dims = t.dims.filter(d => !dimsGone.includes(d));
    if (dead.has(t.datum.origin)) t.datum.origin = "REF1";
    if (dead.has(t.datum.axis)) t.datum.axis = two() && !dead.has("REF2") ? "REF2" : "";
    if (dead.has(t.ref.rotBy)) t.ref.rotBy = two() && !dead.has("REF2") ? "ref2" : "image";
    return true;
  }
  function deleteElement(id) {
    if (!removeWithDeps(id, true)) return;
    S.selEl = null; calibrateMaster(true);
  }

  function renderProps() {
    const box = $("#elProps"), t = S.t, el = t.elements.find(e => e.id === S.selEl);
    if (!el) { box.innerHTML = ""; return; }
    const res = S.masterRes?.elements?.[el.id];
    let h = `<div class="props"><div class="row" style="justify-content:space-between"><b>${el.id} · ${esc(E.describeElement(el))}</b><span class="muted small">${elSummary(res)}</span></div>`;
    if (el.tool === "ref") {
      const c = el.which === 1 ? t.master?.c1 : t.master?.c2;
      h += `<div class="muted small">Ø ${(el.which === 1 ? t.ref.d1 : t.ref.d2)} mm (entered) · ${c ? "Ø " + (2 * c.r).toFixed(1) + " px, fit rms " + (c.rms || 0).toFixed(2) + " px" : "not set"}. Re-pick with ◎ REF${el.which}.</div>`;
    } else if (el.tool === "ocr") {
      const r = el.roi, n = (k, v, st = "0.01") => `<label class="f">${k}<input type="number" step="${st}" data-roi="${k}" value="${(+v).toFixed(3)}"></label>`;
      h += `<div class="form" style="margin-top:6px">${n("cx", r.cx)}${n("cy", r.cy)}${n("w", r.w)}${n("h", r.h)}
        <label class="f">Text direction<select data-o="ang"><option value="0">→ normal</option><option value="90">↓ turned 90°</option><option value="180">← upside down</option><option value="270">↑ turned 270°</option></select></label>
        <label class="f">Format <span class="muted">(A letter, 9 digit, X either, ? any)</span><input data-o="format" value="${esc(el.format || "")}" placeholder="e.g. AAA9"></label>
        <label class="f">Lines<select data-o="lines"><option value="1">1 line</option><option value="2">several lines</option></select></label>
        <label class="f">Text colour<select data-o="polarity"><option value="auto">auto</option><option value="dark">dark text on light</option><option value="light">light text on dark</option></select></label>
        <label class="f" title="Built-in OCR, or a character reader trained on your own images (Training tab)">Reader<select data-o="reader">${readerOptions(el.reader)}</select></label></div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="ocr">Read again</button><button class="btn sm" data-act="redraw">Redraw area</button><button class="btn sm" data-act="savechars" title="Save the characters of the master as training images (Training tab)">💾 Save characters</button>
        <span>${res?.pending ? '<span class="muted">reading…</span>' : res?.text ? `Read: <b class="mono">${esc(res.text)}</b> · ${Math.round(res.conf)} % ${res.formatOk ? '<span class="ok">format OK</span>' : el.format ? '<span class="warn">format not met</span>' : ""}` : '<span class="bad">no text</span>'}</span></div>
        ${res?.image ? `<img src="${res.image}" alt="" style="margin-top:6px;max-width:100%;border:1px solid var(--line);border-radius:4px;background:#fff">` : ""}
        ${el.reader ? (() => { const m = PM.charml?.models.get(el.reader); if (!m) return `<div class="bad small" style="margin-top:4px">The trained reader of this element is not on this PC: import it in the Training tab (⬆ Data / reader…), or choose another reader.</div>`; const miss = [...new Set((res?.text || "").replace(/\s/g, ""))].filter(c => !m.classes.includes(c)); return `<div class="small" style="margin-top:4px">Reader <b>${esc(m.name)}</b> knows <span class="mono">${esc(m.classes.join(" "))}</span> · test ${m.testAcc != null ? (100 * m.testAcc).toFixed(1) + " %" : "—"}${/[9X?]/.test(el.format || "?") && !m.classes.some(c => /[0-9]/.test(c)) ? ' <span class="warn">· knows no digits</span>' : ""}${/[AX?]/.test(el.format || "?") && !m.classes.some(c => /[A-Z]/.test(c)) ? ' <span class="warn">· knows no letters</span>' : ""}. It can only answer with characters it was trained on.</div>`; })() : ""}
        <div class="muted small" style="margin-top:4px">The format makes the reading reliable: it limits the characters and fixes look-alikes (0/O, 2/Z, 5/S, 8/B…). The picture shows what the OCR read${el.reader ? " (boxes = characters found by the trained reader; red = unsure)" : ""}.</div>`;
    } else if (el.tool === "color") {
      const r = el.roi, n = (k, v) => `<label class="f">${k}<input type="number" step="0.01" data-roi="${k}" value="${(+v).toFixed(3)}"></label>`;
      const rgb = c => `rgb(${c.map(Math.round).join(",")})`;
      h += `<div class="form" style="margin-top:6px">${n("cx", r.cx)}${n("cy", r.cy)}${n("r", r.r)}</div>
        <div class="row" style="margin-top:8px">Taught: ${el.ref ? `<span class="sw" style="background:${rgb(el.ref.rgb)}"></span> RGB ${el.ref.rgb.map(Math.round).join(", ")} · L*a*b* ${el.ref.lab.map(v => v.toFixed(1)).join(", ")}` : '<span class="warn">not taught</span>'}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-act="teach">Teach from master</button><button class="btn sm" data-act="redraw">Redraw area</button>
        <label class="chk" title="A white or gray spot of known colour: its difference to the master corrects the colours of the other points (lighting / white balance)"><input type="checkbox" data-act="white" ${el.white ? "checked" : ""}> White/gray reference (colour correction)</label></div>
        <div class="muted small" style="margin-top:6px">ΔE*ab: below 2 hard to see · 2–5 visible side by side · above 10 clearly different. Phone photos: use a white reference and a tolerance of about 8–12.</div>`;
    } else if (E.TOOLS[el.tool].measured) {
      const r = el.roi, e = el.edge || E.defaultEdge(), n = (k, v, st = "0.01") => `<label class="f">${k}<input type="number" step="${st}" data-roi="${k}" value="${(+v).toFixed(3)}"></label>`;
      h += `<div class="form" style="margin-top:6px">`;
      if (el.tool === "circle" || el.tool === "arc") h += n("cx", r.cx) + n("cy", r.cy) + n("r", r.r) + n("band", r.band) + (el.tool === "arc" ? n("a0", r.a0, "1") + n("a1", r.a1, "1") : "");
      if (el.tool === "line") h += n("p0x", r.p0.x) + n("p0y", r.p0.y) + n("p1x", r.p1.x) + n("p1y", r.p1.y) + n("hw", r.hw);
      if (el.tool === "point") h += n("p0x", r.p0.x) + n("p0y", r.p0.y) + n("p1x", r.p1.x) + n("p1y", r.p1.y) + n("w", r.w);
      h += `</div><div class="form" style="margin-top:6px">
        <label class="f">Edge polarity<select data-edge="polarity"><option value="any">any</option><option value="d2b">dark → bright</option><option value="b2d">bright → dark</option></select></label>
        <label class="f">Edge choice<select data-edge="select"><option value="strongest">strongest</option><option value="first">first</option><option value="last">last</option></select></label>
        <label class="f">Threshold<input type="number" min="1" step="1" data-edge="thr" value="${e.thr}"></label>
        ${el.tool === "circle" || el.tool === "arc" ? `<label class="f">Scan<select data-edge="dir"><option value="in">outside → in</option><option value="out">inside → out</option></select></label>` : ""}
        ${el.tool !== "point" ? `<label class="f">Scan lines<input type="number" min="4" max="360" step="1" data-k="n" value="${el.n || 30}"></label>` : ""}
        <label class="f">Outlier removal<select data-edge="outliers"><option value="true">on</option><option value="false">off</option></select></label>
      </div><div class="row" style="margin-top:8px">
        ${el.tool === "line" ? '<button class="btn sm" data-act="flip">Flip scan direction</button>' : ""}
        ${el.tool === "point" ? '<button class="btn sm" data-act="flip">Reverse scan</button>' : ""}
        <button class="btn sm" data-act="redraw">Redraw area</button>
        <span class="muted small">${res && !res.error && res.pts ? `${res.pts.length} edge pts${res.rejected ? ", " + res.rejected + " rejected" : ""}` : ""}</span></div>
        <div class="muted small" style="margin-top:6px">Drag the handles on the photo to move (●) or resize the search area.${E.rotOf(t) === el.id ? " <b>This element sets the rotation.</b>" : ""}</div>`;
    } else {
      const spec = E.TOOLS[el.tool];
      h += `<div class="row" style="margin-top:6px">` + spec.args.map((a, i) => `<select data-arg="${i}">${optionsFor(a, el.id).map(o => `<option ${el.args[i] === o ? "selected" : ""}>${o}</option>`).join("")}</select>`).join("") + `</div>`;
    }
    h += `</div>`;
    box.innerHTML = h;
    box.querySelectorAll("[data-edge]").forEach(i => { const k = i.dataset.edge; const v = (el.edge || {})[k]; if (i.tagName === "SELECT") i.value = String(v ?? (k === "outliers" ? true : i.options[0].value)); });
    box.querySelectorAll("[data-roi]").forEach(i => i.addEventListener("change", () => {
      const k = i.dataset.roi, v = +i.value, r = el.roi;
      if (k === "p0x") r.p0.x = v; else if (k === "p0y") r.p0.y = v; else if (k === "p1x") r.p1.x = v; else if (k === "p1y") r.p1.y = v; else r[k] = v;
      later(remeasureMaster);
    }));
    box.querySelectorAll("[data-edge]").forEach(i => i.addEventListener("change", () => {
      el.edge = el.edge || E.defaultEdge(); const k = i.dataset.edge;
      el.edge[k] = k === "thr" ? +i.value : k === "outliers" ? i.value === "true" : i.value; later(remeasureMaster);
    }));
    box.querySelectorAll("[data-k=n]").forEach(i => i.addEventListener("change", () => { el.n = Math.max(4, +i.value | 0); later(remeasureMaster); }));
    box.querySelectorAll("[data-arg]").forEach(i => i.addEventListener("change", () => { el.args[+i.dataset.arg] = i.value; later(remeasureMaster); }));
    box.querySelector("[data-act=flip]")?.addEventListener("click", () => {
      if (el.tool === "line") el.roi.side = -(el.roi.side || 1); else { const p = el.roi.p0; el.roi.p0 = el.roi.p1; el.roi.p1 = p; }
      later(remeasureMaster);
    });
    box.querySelector("[data-act=redraw]")?.addEventListener("click", () => { setTool(el.tool); S.redraw = el.id; toast(`Draw the new search area for ${el.id}.`); });
    box.querySelectorAll("[data-o]").forEach(i => {
      const k = i.dataset.o; i.value = k === "ang" ? String(((Math.round((el.roi.ang || 0) / 90) * 90) % 360 + 360) % 360) : String(el[k] ?? (k === "lines" ? 1 : k === "polarity" ? "auto" : ""));
      i.addEventListener("change", () => { if (k === "ang") el.roi.ang = +i.value; else el[k] = k === "lines" ? +i.value : k === "format" ? i.value.toUpperCase().trim() : i.value; later(remeasureMaster); });
    });
    box.querySelector("[data-act=ocr]")?.addEventListener("click", () => { delete S.ocrCache[ocrKey(el)]; remeasureMaster(); });
    box.querySelector("[data-act=savechars]")?.addEventListener("click", () => saveMasterChars(el));
    box.querySelector("[data-act=teach]")?.addEventListener("click", () => { if (E.teachColor(el, S.masterRes?.elements?.[el.id])) { later(remeasureMaster); toast(`${el.id} re-taught from the master.`); } });
    box.querySelector("[data-act=white]")?.addEventListener("change", e => {
      el.white = e.target.checked;
      if (el.white) { E.teachColor(el, S.masterRes?.elements?.[el.id]); S.t.dims = S.t.dims.filter(d => !(d.kind === "color" && d.a === el.id)); }
      later(remeasureMaster);
    });
  }

  /** <option>s of the OCR "Reader" select: built-in OCR + trained readers on this PC. */
  function readerOptions(cur) {
    const ms = PM.charml ? PM.charml.models.list() : [];
    let h = `<option value="">Built-in OCR (Tesseract)</option>` + ms.map(m => `<option value="${esc(m.id)}">Trained: ${esc(m.name)} (${m.classes.length} chars, test ${m.testAcc != null ? (100 * m.testAcc).toFixed(1) + " %" : "—"})</option>`).join("");
    if (cur && !ms.some(m => m.id === cur)) h += `<option value="${esc(cur)}">⚠ trained reader not on this PC (${esc(cur)})</option>`;
    return h;
  }
  /** Save the characters of the OCR boxes of a measured photo as training images. Returns the number saved. */
  async function saveChars(it, opt = {}) {
    if (!PM.charml) return 0;
    const r = it?.res, cal = r?.cal;
    if (!r || !cal?.ok) { if (!opt.quiet) toast("Measure the photo first (the text position comes from the alignment).", true); return 0; }
    const els = S.t.elements.filter(e => e.tool === "ocr" && (!opt.el || e.id === opt.el));
    if (!els.length) { if (!opt.quiet) toast("This program has no text (OCR) element.", true); return 0; }
    const p = await getPhoto(it);
    let recs = [], unl = 0;
    for (const e0 of els) {
      const el = it.ov?.[e0.id] ? { ...e0, roi: it.ov[e0.id] } : e0, x = r.elements?.[e0.id];
      const rs = PM.charml.charsOf(p, E.ocrBox(el, cal), { program: S.t.name || "", el: e0.id, photo: it.name, serial: it.serial || "", text: x?.text || "", conf: x?.conf, formatOk: x?.formatOk, inv: x?.mode?.inv, polarity: e0.polarity, lines: e0.lines || 1 });
      unl += rs.filter(q => q.label === "?").length; recs = recs.concat(rs);
    }
    if (!recs.length) { if (!opt.quiet) toast("No characters found in the text areas.", true); return 0; }
    await PM.charml.chars.put(recs);
    it.charsSaved = (it.charsSaved || 0) + recs.length;
    if (!opt.quiet) toast(`${recs.length} character images saved${unl ? ` (${unl} without label: the reading was unsure or did not match the characters found – label them in the Training tab)` : " – check the labels in the Training tab"}.`);
    hooks.chars && hooks.chars.forEach(f => { try { f(recs); } catch (e) { console.error(e); } });
    renderInfo();
    return recs.length;
  }
  async function saveMasterChars(el) {
    if (!S.master || !S.masterCal) { toast("Load the master photo first.", true); return; }
    const x = S.masterRes?.elements?.[el.id];
    const rs = PM.charml.charsOf(S.master, E.ocrBox(el, S.masterCal), { program: S.t.name || "", el: el.id, photo: "master", serial: "", text: x?.text || "", conf: x?.conf, formatOk: x?.formatOk, inv: x?.mode?.inv, polarity: el.polarity, lines: el.lines || 1 });
    if (!rs.length) { toast("No characters found in the text area.", true); return; }
    await PM.charml.chars.put(rs);
    hooks.chars && hooks.chars.forEach(f => { try { f(rs); } catch (e) { console.error(e); } });
    toast(`${rs.length} character images of the master saved (Training tab).`);
  }

  const outType = el => E.TOOLS[el.tool]?.out;
  function optionsFor(kind, exclude) {
    const els = S.t.elements.filter(e => e.id !== exclude);
    // only elements defined before 'exclude' can be inputs (evaluation order)
    const idx = exclude ? S.t.elements.findIndex(e => e.id === exclude) : S.t.elements.length;
    const before = els.filter(e => S.t.elements.indexOf(e) < (idx < 0 ? S.t.elements.length : idx));
    if (kind === "pt") return before.filter(e => ["point", "circle"].includes(outType(e))).map(e => e.id);
    if (kind === "any") return before.filter(e => !["color", "text"].includes(outType(e))).map(e => e.id);
    if (kind === "line") return before.filter(e => outType(e) === "line").map(e => e.id);
    if (kind === "circle") return before.filter(e => outType(e) === "circle").map(e => e.id);
    if (kind === "color") return before.filter(e => outType(e) === "color" && !e.white).map(e => e.id);
    if (kind === "text") return before.filter(e => outType(e) === "text").map(e => e.id);
    return before.map(e => e.id);
  }

  // ---- construct ----
  function renderConsSelects() {
    const spec = E.TOOLS[$("#cTool").value];
    ["#cA", "#cB", "#cC"].forEach((s, i) => {
      const sel = $(s), a = spec.args[i];
      sel.hidden = !a;
      if (a) { const keep = sel.value; sel.innerHTML = optionsFor(a).map(o => `<option>${o}</option>`).join(""); if ([...sel.options].some(o => o.value === keep)) sel.value = keep; }
    });
  }
  $("#cTool").addEventListener("change", renderConsSelects);
  $("#btnCons").addEventListener("click", () => {
    if (!S.t.master?.frame) { toast("Set REF1 and REF2 first."); return; }
    const tool = $("#cTool").value, spec = E.TOOLS[tool];
    const args = spec.args.map((_, i) => $(["#cA", "#cB", "#cC"][i]).value);
    if (args.some(a => !a)) { toast("Not enough input elements of the right type.", true); return; }
    if (new Set(args).size !== args.length) { toast("Choose different elements.", true); return; }
    const id = E.nextId(S.t, E.PREFIX[tool], "el");
    const names = { mid: "Midpoint", intersect: "Intersection", foot: "Foot", line2p: "Line", circle3p: "Circle 3P", parallel: "Parallel", perp: "Perpendicular", bisector: "Bisector" };
    S.t.elements.push({ id, name: `${names[tool]} ${id}`, tool, args });
    S.selEl = id; remeasureMaster();
    const r = S.masterRes.elements[id]; if (r?.error) toast(`${id}: ${r.error}`, true);
  });

  // ---- dimensions ----
  $("#dKind").innerHTML = Object.keys(E.DIMS).map(k => `<option value="${k}">${I.t("k_" + k, "en")}</option>`).join("");
  function renderDimSelects() {
    const k = $("#dKind").value, spec = E.DIMS[k];
    const fill = (sel, a) => { sel.hidden = !a; if (!a) return; const opt = a.endsWith("?"); const kind = a.replace("?", ""); const keep = sel.value; sel.innerHTML = (opt ? `<option value="">(datum X axis)</option>` : "") + optionsFor(kind === "any" ? "any" : kind).map(o => `<option>${o}</option>`).join(""); if ([...sel.options].some(o => o.value === keep)) sel.value = keep; };
    fill($("#dA"), spec.args[0]); fill($("#dB"), spec.args[1]);
    $("#dAxis").hidden = k !== "distance";
  }
  $("#dKind").addEventListener("change", renderDimSelects);
  $("#btnDim").addEventListener("click", () => {
    if (!S.masterRes) { toast("Set REF1 and REF2 first."); return; }
    const kind = $("#dKind").value, spec = E.DIMS[kind];
    const a = $("#dA").value, b = spec.args[1] ? $("#dB").value : "";
    if (!a || (spec.args[1] && !spec.args[1].endsWith("?") && !b)) { toast("Choose the element(s).", true); return; }
    if (a === b) { toast("Choose two different elements.", true); return; }
    const id = E.nextId(S.t, "D", "dim");
    const dm = { id, name: `${I.t("k_" + kind, "en")} ${[a, b].filter(Boolean).join("–")}${kind === "distance" && $("#dAxis").value ? " (" + $("#dAxis").value.toUpperCase() + ")" : ""}`, kind, a, b: b || null, axis: kind === "distance" ? $("#dAxis").value : "" };
    S.t.dims.push(dm);
    const r = E.evalDims(S.t, S.masterRes.elements, { dm: S.masterDM })[id];
    if (spec.text) { const el = S.t.elements.find(e => e.id === a); dm.spec = el?.format ? { op: "format" } : { op: "==", v1: r?.v || "" }; }
    else if (spec.form) { dm.tolP = kind === "position" ? 0.2 : kind === "color" || kind === "colordiff" ? 10 : 0.1; dm.spec = { op: "<=", v1: dm.tolP }; }
    else if (r && r.v != null) { dm.nom = +r.v.toFixed(kind === "angle" ? 2 : 3); dm.tolP = kind === "angle" ? 0.5 : 0.1; dm.tolM = dm.tolP; dm.spec = { op: "tol" }; }
    if (kind === "position") { const D = E.datumOf(S.t, S.masterRes.elements), p = G.pointOf(S.masterRes.elements[a]); if (p) { const q = D.fwd(p); dm.nomX = +q.x.toFixed(3); dm.nomY = +q.y.toFixed(3); } }
    remeasureMaster();
  });
  const OP_LABEL = { tol: "nominal ± tol", range: "range min … max", ">": ">", "<": "<", ">=": "≥", "<=": "≤", "==": "= (± eps)", "!=": "≠ (± eps)", none: "info only", contains: "contains", starts: "starts with", ends: "ends with", regex: "matches regex", format: "fits OCR format" };
  /** Spec editor cell: operator + its values. */
  function specCell(d) {
    const k = E.DIMS[d.kind], sp = E.specOf(d);
    const ops = k.text ? E.TEXT_OPS : E.NUM_OPS.filter(o => !(k.form && o === "tol"));
    const inp = (f, v, ph, w = 58, txt = false) => `<input data-s="${f}" ${txt ? "" : 'inputmode="decimal"'} placeholder="${ph}" style="width:${w}px" value="${esc(v ?? "")}">`;
    const lab = o => (k.text && o === "==" ? "= equals" : k.text && o === "!=" ? "≠ not equal" : OP_LABEL[o] || o);
    let h = `<select data-s="op">${ops.map(o => `<option value="${o}" ${o === sp.op ? "selected" : ""}>${lab(o)}</option>`).join("")}</select> `;
    if (d.kind === "position") h += `X<input data-f="nomX" value="${d.nomX ?? ""}"> Y<input data-f="nomY" value="${d.nomY ?? ""}"> `;
    if (k.text) { if (!["format", "none"].includes(sp.op)) h += inp("v1", sp.v1, "text, {DM}, {DM:0-4}", 130, true) + ` <label class="chk" title="ignore upper/lower case"><input type="checkbox" data-s="ci" ${sp.ci ? "checked" : ""}>Aa</label>`; }
    else if (sp.op === "tol") h += `<input data-f="nom" placeholder="nominal" value="${d.nom ?? ""}"> +<input data-f="tolP" value="${d.tolP ?? ""}"> −<input data-f="tolM" value="${d.tolM ?? ""}">`;
    else if (sp.op === "range") h += inp("v1", sp.v1, "min") + " … " + inp("v2", sp.v2, "max");
    else if (sp.op === "==" || sp.op === "!=") h += inp("v1", sp.v1, "value") + " ±" + inp("eps", sp.eps, "0", 46);
    else if (sp.op !== "none") h += inp("v1", sp.v1, "limit");
    return h;
  }
  function changeOp(d, op) {
    const sp = E.specOf(d), nom = E.num(d.nom), tp = E.num(d.tolP), tm = E.num(d.tolM) ?? tp;
    const n = { op, ci: sp.ci };
    if (nom != null && tp != null) {
      if (op === "range") { n.v1 = +(nom - tm).toFixed(4); n.v2 = +(nom + tp).toFixed(4); }
      if (op === "<=" || op === "<") n.v1 = +(nom + tp).toFixed(4);
      if (op === ">=" || op === ">") n.v1 = +(nom - tm).toFixed(4);
      if (op === "==" || op === "!=") { n.v1 = nom; n.eps = tp; }
    } else if (sp.v1 != null) { n.v1 = sp.v1; n.v2 = sp.v2; n.eps = sp.eps; }
    if (op === "tol" && nom == null) { const r = S.masterRes?.dims?.[d.id]; if (typeof r?.v === "number") { d.nom = +r.v.toFixed(3); d.tolP = d.tolM = 0.1; } }
    d.spec = n;
  }
  function renderDims() {
    const t = S.t, res = S.masterRes?.dims || {};
    $("#dimTable").innerHTML = `<tr><th>ID</th><th>Name</th><th>Type</th><th>A–B</th><th>Specification</th><th class="num">Master</th><th></th><th></th></tr>` + t.dims.map((d, i) => {
      const r = res[d.id] || {};
      return `<tr data-i="${i}"><td><b>${d.id}</b></td><td><input class="nm" data-f="name" value="${esc(d.name)}"></td><td>${I.t("k_" + d.kind, "en")}</td><td>${d.a}${d.b ? "–" + d.b : ""}${d.axis ? " " + d.axis.toUpperCase() : ""}</td>
        <td class="spec">${specCell(d)}</td>
        <td class="num" title="${esc(r.err || "")}">${r.v != null ? esc(VW.fmtV(r.v, d.kind)) : '<span class="bad">ERR</span>'}</td><td><span class="pill ${r.status}">${r.status || ""}</span></td>
        <td><button class="x" data-act="up" title="Move up">▲</button><button class="x" data-act="del" title="Delete">✕</button></td></tr>`;
    }).join("");
    $$("#dimTable tr[data-i]").forEach(tr => {
      const d = t.dims[+tr.dataset.i], k = E.DIMS[d.kind];
      tr.querySelectorAll("input[data-f]").forEach(i => i.addEventListener("change", () => { const f = i.dataset.f; d[f] = f === "name" ? i.value : i.value === "" ? null : +i.value; if (f === "tolP" && E.specOf(d).op === "<=" && d.kind === "position") d.spec = { ...E.specOf(d), v1: d.tolP }; later(remeasureMaster); }));
      tr.querySelector("select[data-s=op]").addEventListener("change", e => { changeOp(d, e.target.value); later(remeasureMaster); });
      tr.querySelectorAll("input[data-s]").forEach(i => i.addEventListener("change", () => {
        const f = i.dataset.s, sp = { ...E.specOf(d) };
        if (f === "ci") sp.ci = i.checked; else sp[f] = k.text && f === "v1" ? i.value : (i.value === "" ? null : +i.value);
        d.spec = sp; later(remeasureMaster);
      }));
      tr.querySelector("[data-act=del]").addEventListener("click", () => { t.dims.splice(t.dims.indexOf(d), 1); later(remeasureMaster); });
      tr.querySelector("[data-act=up]").addEventListener("click", () => { const i = t.dims.indexOf(d); if (i > 0) { t.dims.splice(i, 1); t.dims.splice(i - 1, 0, d); later(remeasureMaster); } });
    });
  }

  // ---- datum ----
  function renderDatum() {
    const t = S.t;
    const pts = t.elements.filter(e => ["point", "circle"].includes(outType(e))).map(e => e.id);
    const axes = t.elements.filter(e => e.id !== t.datum.origin).map(e => e.id);
    $("#dtOrigin").innerHTML = pts.map(o => `<option ${o === t.datum.origin ? "selected" : ""}>${o}</option>`).join("");
    $("#dtAxis").innerHTML = `<option value="" ${!t.datum.axis ? "selected" : ""}>(part X axis)</option>` + axes.map(o => `<option ${o === t.datum.axis ? "selected" : ""}>${o}</option>`).join("");
    $("#dtY").value = t.datum.yUp === false ? "down" : "up";
  }
  $("#dtOrigin").addEventListener("change", e => { S.t.datum.origin = e.target.value; remeasureMaster(); });
  $("#dtAxis").addEventListener("change", e => { S.t.datum.axis = e.target.value; remeasureMaster(); });
  $("#dtY").addEventListener("change", e => { S.t.datum.yUp = e.target.value === "up"; remeasureMaster(); });

  // ---- save / open / new ----
  let saveT;
  function saveLocal() {
    clearTimeout(saveT);
    if (!isAdmin()) return;
    saveT = setTimeout(() => { S.t.modified = new Date().toISOString(); try { localStorage.setItem("pm.template", JSON.stringify(S.t)); } catch (e) { console.warn("autosave failed", e); } }, 400);
  }
  $("#btnSaveTpl").addEventListener("click", () => {
    S.t.modified = new Date().toISOString();
    download(new Blob([JSON.stringify(S.t, null, 1)], { type: "application/json" }), safeName(S.t.name) + ".pm.json");
  });
  $("#tplFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { await openTemplate(JSON.parse(await f.text())); toast(`Opened "${S.t.name}".`); } catch (err) { console.error(err); toast("Not a valid program file: " + err.message, true); }
  });
  $("#btnNewTpl").addEventListener("click", () => {
    if (S.t.elements.length > 2 && !confirm("Start a new part program? Unsaved changes are lost.")) return;
    S.t = E.newTemplate(); S.master = null; S.masterRes = null; S.masterCal = null; S.selEl = null;
    fillPartFields(); renderElements(); renderDims(); renderDatum(); updateCalInfo(); tplScene(); saveLocal();
    $("#tplHint").textContent = "Load a master photo to start.";
  });
  async function openTemplate(t) {
    if (t.app !== "PhotoMeasure") throw new Error("missing app tag");
    const base = E.newTemplate();
    S.t = { ...base, ...t, ref: { ...base.ref, ...t.ref }, datum: { ...base.datum, ...t.datum }, proc: V.procOf(t.proc) };
    if (!t.id) S.t.id = base.id;
    S.selEl = null; S.master = null; S.masterRes = null;
    fillPartFields();
    if (S.t.master?.img) {
      const blob = await (await fetch(S.t.master.img)).blob();
      await loadMaster(new File([blob], S.t.master.name || "master.jpg", { type: blob.type }), false);
      if (refsSet()) calibrateMaster(false);
    }
    renderElements(); renderDims(); renderDatum(); updateCalInfo(); tplScene(); tplFit(); setTool("pan");
    S.stale = S.items.length > 0; renderList(); renderLibrary();
    $("#colorCard").hidden = !S.t.elements.some(e => e.tool === "color");
    hooks.program.forEach(f => { try { f(S.t); } catch (e) { console.error(e); } });
  }

  // ================= measure =================
  const mv = new VW.Viewer($("#mCanvas"), { view: S.mview });
  mv.layers = { showRoi: false, showPts: true, labels: true }; S.mv = mv;
  mv.onViewChange = v => { const it = S.items[S.sel]; if (it && !$("#mSync").checked) it.view = { ...v }; };
  $("#mPts").addEventListener("change", e => { mv.layers.showPts = e.target.checked; mv.draw(); });
  $("#mRoi").addEventListener("change", e => { mv.layers.showRoi = e.target.checked; mv.draw(); });
  $("#mCands").addEventListener("change", () => showItem());
  $("#mProc").addEventListener("change", () => showItem());
  $("#mBlend").addEventListener("input", () => showItem());
  $("#mAdjRoi").addEventListener("click", () => setAdjRoi(!S.adjRoi));
  function setAdjRoi(on) {
    S.adjRoi = on; S.mSel = null; S.pick = null;
    $("#mAdjRoi").classList.toggle("on", on); $("#roiCard").hidden = !on;
    $("#mRoi").checked = on || $("#mRoi").checked; mv.layers.showRoi = $("#mRoi").checked;
    showItem();
  }
  $("#btnRoiDone").addEventListener("click", () => setAdjRoi(false));
  $("#btnRoiReset").addEventListener("click", () => { const it = S.items[S.sel]; if (!it) return; it.ov = {}; it.eov = {}; processItem(it, { keepSerial: true }); });
  $("#btnRoiCopy").addEventListener("click", () => {
    const it = S.items[S.sel]; if (!it || ((!it.ov || !Object.keys(it.ov).length) && (!it.eov || !Object.keys(it.eov).length))) { toast("No search area changed on this photo."); return; }
    it.ov = it.ov || {};
    if (!isAdmin()) return;
    if (!confirm(`Copy the search areas${it.eov && Object.keys(it.eov).length ? " and edge settings" : ""} of ${[...new Set([...Object.keys(it.ov), ...Object.keys(it.eov || {})])].join(", ")} from this photo into the part program? All photos will need re-measuring.`)) return;
    for (const [id, roi] of Object.entries(it.ov)) setRoi(S.t, id, JSON.parse(JSON.stringify(roi)));
    for (const [id, e] of Object.entries(it.eov || {})) { const el = S.t.elements.find(x => x.id === id); if (el) el.edge = { ...(el.edge || E.defaultEdge()), ...e }; }
    it.ov = {}; it.eov = {}; remeasureMaster(); processItem(it, { keepSerial: true }); toast("Copied to the program. Press Re-measure all for the other photos.");
  });
  $("#mAligned").addEventListener("click", () => setMode("aligned"));
  $("#mOriginal").addEventListener("click", () => setMode("original"));
  $("#mFit").addEventListener("click", () => fitItem());
  $("#mRot").addEventListener("click", () => { mv.view.rot = ((mv.view.rot || 0) + 90) % 360; fitItem(); });
  $("#mPrev").addEventListener("click", () => selectItem(Math.max(0, S.sel - 1)));
  $("#mNext").addEventListener("click", () => selectItem(Math.min(S.items.length - 1, S.sel + 1)));
  function setMode(m) { mv.mode = m; $("#mAligned").classList.toggle("active", m === "aligned"); $("#mOriginal").classList.toggle("active", m === "original"); fitItem(); }

  $("#photoFiles").addEventListener("change", e => { addFiles([...e.target.files]); e.target.value = ""; });
  for (const z of [$("#dropZone"), $("#photoList")]) {
    z.addEventListener("dragover", e => { e.preventDefault(); $("#dropZone").classList.add("drag"); });
    z.addEventListener("dragleave", () => $("#dropZone").classList.remove("drag"));
    z.addEventListener("drop", e => { e.preventDefault(); $("#dropZone").classList.remove("drag"); addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith("image/"))); });
  }
  $("#btnClear").addEventListener("click", () => { if (S.items.length && !confirm("Remove all photos and results?")) return; S.items = []; S.sel = -1; S.cache = null; S.stale = false; renderList(); showItem(); });
  $("#btnRemeasure").addEventListener("click", () => { if (!ready()) return; S.stale = false; S.items.forEach(it => enqueue(it)); renderList(); });

  function ready() {
    if (!S.t.master?.frame || !S.t.master?.patch) { toast(`Create or open a part program first (master photo with REF1${two() ? " and REF2" : ""}).`, true); return false; }
    return true;
  }
  let uid = 0;
  function addFiles(files) {
    if (!files.length || !ready()) return;
    const first = S.items.length;
    for (const f of files) { const it = { id: ++uid, file: f, name: f.name, status: "WAIT" }; S.items.push(it); enqueue(it); }
    renderList(); if (S.sel < 0) selectItem(first);
    $("#mHint").textContent = "";
  }
  function enqueue(it) {
    it.status = "WAIT"; it.queuedAt = performance.now();
    S.queue = S.queue.then(() => processItem(it)).catch(e => console.error(e));
  }

  /** Image file of an item: kept in memory, or fetched again from the Camera Bridge (camera shots). */
  async function fileOf(it) {
    if (it.file) return it.file;
    if (!it.src) throw new Error("image is no longer available");
    const r = await fetch(it.src); if (!r.ok) throw new Error("cannot load the camera image again (" + r.status + ")");
    const b = await r.blob();
    return new File([b], it.name, { type: b.type, lastModified: it.shotTime || Date.now() });
  }
  async function getPhoto(it) {
    if (S.cache && S.cache.id === it.id) {
      const p = S.cache.photo;
      if (p.procKey !== JSON.stringify([V.procOf(S.t.proc), it.adj || {}])) V.makeGray(p, S.t.proc, it.adj);
      return p;
    }
    const p = await V.loadPhoto(await fileOf(it), it.source === "camera" ? CAM_MAX : 4096, S.t.proc, it.adj);
    if (it.cands && it.candsKey === p.procKey) { p.cands = it.cands; p.candsKey = it.candsKey; }
    S.cache = { id: it.id, photo: p };
    return p;
  }

  async function processItem(it, opt = {}) {
    if (!S.items.includes(it)) return;
    const now = () => performance.now(), T0 = now(), T = {};
    let tl = T0; const lap = k => { const x = now(); T[k] = (T[k] || 0) + (x - tl); tl = x; };
    if (it.queuedAt) { T.queue = T0 - it.queuedAt; it.queuedAt = null; }
    busy(true, `Measuring ${S.items.indexOf(it) + 1}/${S.items.length}…`);
    await nextFrame();
    try {
      await V.whenCv();
      tl = now();
      const p = await getPhoto(it);
      lap("load");
      if (!fixedCal() && (!p.cands || p.candsKey !== p.procKey)) p.cands = await V.findCircles(p, S.t.proc);
      it.cands = p.cands || []; it.candsKey = p.candsKey;
      lap("circles");
      Object.assign(it, { w: p.w, h: p.h, date: it.shotTime ? new Date(it.shotTime) : p.date, dateSource: it.shotTime ? "camera" : p.dateSource, camera: it.cameraName || p.camera, loadScale: p.loadScale });
      const cal = it.manualRefs && !fixedCal() ? E.manualCalibration(S.t, p, it.manualRefs.c1, two() ? it.manualRefs.c2 : null, S.t.master.patch) : null;
      const res = await E.measure(S.t, p, { cal, masterPatch: S.t.master.patch, ov: it.ov && Object.keys(it.ov).length ? it.ov : null, eov: it.eov && Object.keys(it.eov).length ? it.eov : null, user: S.user?.name, timing: T, station: stationRec(), meta: { serial: it.cameraSerial || null } });
      tl = now();
      it.measuredBy = S.user?.name || "";
      if (it.adj && Object.keys(it.adj).some(k => it.adj[k] !== (k === "brightness" ? 0 : 1))) res.warnings.push(`image adjusted for this photo: brightness ${it.adj.brightness ?? 0}, contrast ×${it.adj.contrast ?? 1}, gamma ${it.adj.gamma ?? 1}`);
      if ($("#mProc").checked) it.procDisp = V.grayCanvas(p.gray, DISP_MAX); else it.procDisp = null;
      it.res = res; it.status = res.status; it.measuredAt = new Date();
      if (!it.serialManual && !opt.keepSerial) {
        const code = res.dm !== undefined ? res.dm : E.readCode(S.t, p, res.cal?.ok ? res.cal : null);
        const sf = S.t.serialFrom || "dm", firstText = S.t.elements.find(e => e.tool === "ocr");
        const txtId = sf === "dm+" ? firstText?.id : sf;
        const txt = txtId && res.elements?.[txtId]?.text;
        if (sf === "file") { it.serial = null; it.serialSource = null; }
        else if (sf !== "dm" && sf !== "dm+" && txt) { it.serial = txt; it.serialSource = "OCR " + sf; }
        else if (code) { it.serial = code; it.serialSource = "DataMatrix"; }
        else if (sf === "dm+" && txt) { it.serial = txt; it.serialSource = "OCR " + txtId; }
        else { it.serial = null; it.serialSource = null; }
        it.dm = code;
      }
      lap("sn");
      if (!it.disp) {
        const k = Math.min(1, DISP_MAX / Math.max(p.w, p.h)), c = document.createElement("canvas");
        c.width = Math.round(p.w * k); c.height = Math.round(p.h * k); c.getContext("2d").drawImage(p.canvas, 0, 0, c.width, c.height);
        it.disp = c; it.dispK = k;
        const th = document.createElement("canvas"), tk = 112 / Math.max(p.w, p.h); th.width = Math.round(p.w * tk); th.height = Math.round(p.h * tk);
        th.getContext("2d").drawImage(c, 0, 0, th.width, th.height); it.thumb = th.toDataURL("image/jpeg", 0.7);
      }
      lap("display");
    } catch (err) {
      console.error(err); it.status = "FAIL"; it.res = { status: "FAIL", warnings: [String(err.message || err)], elements: {}, dims: {} };
    }
    busy(false);
    if (it.src && it.file && it.status !== "WAIT") it.file = null; // camera shot: the bridge keeps the image, free the memory
    T.total = now() - T0;
    if (it.camT) { Object.assign(T, it.camT.steps); T.cycle = now() - it.camT.t0; it.camT = null; }
    it.timing = T;
    try { PM.timing && PM.timing.record(it); } catch (e) { console.error(e); }
    renderList();
    if (S.items[S.sel] === it) showItem();
    hooks.measured.forEach(f => { try { f(it); } catch (e) { console.error(e); } });
    if (it._done) { const d = it._done; it._done = null; d(it); }
  }

  function itemLabel(it) { return it.serial || it.name.replace(/\.[^.]+$/, ""); }
  function renderList() {
    const n = S.items.length, c = k => S.items.filter(i => i.status === k).length;
    $("#listInfo").innerHTML = n ? `${n} photos · <span class="ok">${c("OK")} OK</span> · <span class="bad">${c("NG")} NG</span>${c("CHECK") + c("FAIL") ? ` · <span class="warn">${c("CHECK") + c("FAIL")} check</span>` : ""}${c("WAIT") ? ` · ${c("WAIT")} waiting` : ""}${S.stale ? '<br><span class="warn">Program changed: press Re-measure all.</span>' : ""}` : 'Drop photos here or click "Add photos".';
    $("#photoList").innerHTML = S.items.map((it, i) => `<div class="pitem ${i === S.sel ? "sel" : ""}" data-i="${i}">${it.thumb ? `<img src="${it.thumb}" alt="">` : '<div class="ph"></div>'}<div style="min-width:0"><div class="nm">${esc(itemLabel(it))}</div><div class="fn">${esc(it.name)}</div><span class="pill ${it.status}">${it.status}</span></div></div>`).join("");
    $$("#photoList .pitem").forEach(d => d.addEventListener("click", () => selectItem(+d.dataset.i)));
  }

  function selectItem(i) {
    if (i < 0 || i >= S.items.length) return;
    const prev = S.items[S.sel];
    if (prev && !$("#mSync").checked) prev.view = { ...mv.view };
    S.sel = i; S.pick = null; S.mSel = null; $("#pickHint").textContent = "";
    renderList();
    const sel = $("#photoList .pitem.sel"); sel && sel.scrollIntoView({ block: "nearest" });
    showItem(true);
  }

  /** Program as used for this photo (search areas adjusted by hand replace the program's). */
  function effTemplate(it) {
    if (!it.ov || !Object.keys(it.ov).length) return S.t;
    return { ...S.t, elements: S.t.elements.map(e => (it.ov[e.id] ? { ...e, roi: it.ov[e.id] } : e)) };
  }
  function itemScene(it) {
    const res = it.res, ok = res?.cal?.ok, proc = $("#mProc").checked && it.procDisp;
    const alpha = +$("#mBlend").value / 100;
    return {
      img: proc ? it.procDisp : it.disp, imgToPx: proc ? VW.A.scale(1 / it.procDisp.k) : it.dispK ? VW.A.scale(1 / it.dispK) : null,
      frame: ok ? res.cal.frame : null,
      template: ok ? effTemplate(it) : null, result: ok ? res : null, cands: (!ok || $("#mCands").checked || S.pick) ? it.cands : null,
      overlay: ok && alpha > 0 && S.master && S.t.master?.frame ? { img: S.master.canvas, frame: S.t.master.frame, alpha } : null,
      selected: S.adjRoi ? S.mSel : null,
      handles: ok && S.adjRoi && S.mSel ? handlesFor(S.t, S.mSel, it.ov) : null,
    };
  }

  function showItem(fresh) {
    const it = S.items[S.sel];
    if (!it || !it.disp) { mv.set(null); S.shownId = null; renderInfo(); return; }
    if ($("#mProc").checked && !it.procDisp && it.res) { getPhoto(it).then(p => { it.procDisp = V.grayCanvas(p.gray, DISP_MAX); if (S.items[S.sel] === it) showItem(); }); }
    const scene = itemScene(it);
    const hadFrame = !!mv.scene?.frame, changed = S.shownId !== it.id, frameChanged = hadFrame !== !!scene.frame;
    S.shownId = it.id; mv.scene = scene;
    const sync = $("#mSync").checked;
    if (changed || frameChanged || fresh) {
      if (!sync && it.view) Object.assign(mv.view, it.view);
      else if (!sync || !S.mviewInit || frameChanged || !scene.frame || mv.mode !== "aligned") fitItem();
    }
    mv.draw(); renderInfo();
  }
  function fitItem() {
    const it = S.items[S.sel]; if (!it) return;
    if (mv.mode === "aligned" && mv.scene?.frame) {
      const b = S.t.reportBox || E.corrBox(S.t);
      const mx = 0.08 * (b.x1 - b.x0), my = 0.08 * (b.y1 - b.y0);
      mv.fit({ x0: b.x0 - mx, x1: b.x1 + mx, y0: b.y0 - my, y1: b.y1 + my });
      S.mviewInit = true;
    } else mv.fit();
  }

  function renderInfo() {
    const it = S.items[S.sel], box = $("#mInfo");
    if (!it) { box.innerHTML = '<span class="muted">No photo selected.</span>'; $("#mDims").innerHTML = ""; $("#mDiff").innerHTML = "—"; return; }
    const r = it.res, c = r?.cal;
    const dt = it.date ? it.date.toLocaleString() : "—";
    box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><b style="font-size:15px">${esc(itemLabel(it))}</b><span class="pill ${it.status}">${it.status}</span></div>
      <div class="kv">
        <span class="k">${I.t("serial")}</span><span class="row"><input id="iSerial" value="${esc(it.serial || "")}" placeholder="not read" style="flex:1"><span class="muted small">${it.serialManual ? "manual" : it.serialSource || ""}</span></span>
        ${it.dm ? `<span class="k">2D code</span><span class="mono">${esc(it.dm)}</span>` : ""}
        ${S.t.elements.filter(e => e.tool === "ocr").map(e => { const x = r?.elements?.[e.id]; return `<span class="k">${e.id} text</span><span>${x?.text ? `<b class="mono">${esc(x.text)}</b> <span class="muted">${Math.round(x.conf)} %${e.format ? (x.formatOk ? " · format OK" : " · format not met") : ""}</span>` : '<span class="bad">not read</span>'}</span>`; }).join("")}
        <span class="k">${I.t("file")}</span><span>${esc(it.name)}</span>
        <span class="k">${I.t("taken")}</span><span>${dt} <span class="muted">(${it.dateSource || "?"})</span></span>
        ${it.camera ? `<span class="k">Camera</span><span>${esc(it.camera)}</span>` : ""}
        <span class="k">Image</span><span>${it.w || "?"}×${it.h || "?"} px</span>
        ${c?.ok ? `<span class="k">${I.t("scale")}</span><span>${c.pxPerMm.toFixed(2)} px/mm ${c.mode === "1c" ? "(from REF1 Ø)" : c.mode === "cal" && c.station ? `(station calibration ${esc(c.station.name || c.station.serial || "")} · ${new Date(c.station.date).toLocaleDateString()})` : ""}</span>
        ${c.mode === "2c" ? `<span class="k">${I.t("refCheck")}</span><span class="${Math.abs(c.scaleDiffPct) > 3 ? "warn" : ""}">${c.scaleDiffPct.toFixed(2)}% · REF1 Ø${c.d1.toFixed(3)} · REF2 Ø${c.d2.toFixed(3)}</span>` : ""}
        <span class="k">${I.t("angle")}</span><span>${c.angleDeg.toFixed(1)}° <span class="muted">(rotation from ${c.rot === "ref2" ? "REF1→REF2" : c.rot === "image" ? "image match" : c.rot === "none" ? "—" : c.rot})</span></span>
        <span class="k">${c.mode === "cal" ? "Position" : "Refs"}</span><span>${c.mode === "cal" ? ({ fixture: "fixture", shift: "image search", image: "image search + rotation" }[c.pos] || "") : c.auto ? "auto" : "manual"}${c.ncc != null ? ` · match ${c.ncc.toFixed(2)}` : ""}</span>` : ""}
        ${it.timing ? `<span class="k">${I.t("timeLbl")}</span><span title="${esc(PM.timing ? PM.timing.detail(it.timing) : "")}"><b>${Math.round(it.timing.cycle ?? it.timing.total)} ms</b> <span class="muted">${esc(PM.timing ? PM.timing.short(it.timing) : "")}</span></span>` : ""}
      </div>
      ${r?.warnings?.length ? `<div class="warn small" style="margin-top:8px">⚠ ${r.warnings.map(esc).join("<br>⚠ ")}</div>` : ""}
      ${S.t.elements.some(e => e.tool === "ocr") && r?.cal?.ok ? `<div class="row" style="margin-top:8px"><button class="btn sm" id="btnSaveChars" title="Cut the characters out of the text areas of this photo and save them as training images (Training tab)">💾 Save characters</button><span class="muted small">${it.charsSaved ? `${it.charsSaved} saved` : ""}</span></div>` : ""}`;
    $("#btnSaveChars")?.addEventListener("click", async e => { e.target.disabled = true; try { await saveChars(it); } catch (err) { console.error(err); toast("Saving characters failed: " + err.message, true); } e.target.disabled = false; });
    $("#iSerial").addEventListener("change", e => { it.serial = e.target.value.trim() || null; it.serialManual = !!it.serial; renderList(); renderInfo(); });
    renderDiff(it); fillAdj(it); if (S.adjRoi) renderRoiCard(it);
    $("#colorCard").hidden = !S.t.elements.some(e => e.tool === "color");
    const dims = r?.dims || {};
    $("#mDims").innerHTML = `<tr><th>ID</th><th>${I.t("name")}</th><th class="num">Spec</th><th class="num">${I.t("measured")}</th><th class="num">${I.t("dev")}</th><th></th></tr>` +
      S.t.dims.map(d => { const x = dims[d.id] || {}; const fix = x.status === "ERR" && r?.cal?.ok ? ` <button class="btn fix" data-fix="${d.id}" title="${esc(x.err || "")}">🔧 Fix</button>` : ""; return `<tr><td><b>${d.id}</b></td><td>${esc(d.name)}</td><td class="num">${esc(E.specText(d))}</td><td class="num" title="${esc(x.err || "")}">${x.v != null ? esc(VW.fmtV(x.v, d.kind)) : "—"}</td><td class="num">${x.dev != null ? (x.dev >= 0 ? "+" : "") + x.dev.toFixed(3) : ""}</td><td><span class="pill ${x.status}">${x.status || ""}</span>${fix}</td></tr>`; }).join("");
    $$("#mDims [data-fix]").forEach(b => b.addEventListener("click", () => fixDim(it, b.dataset.fix)));
  }
  // ---- ERR -> find and fix the failed measuring tool ----
  function fixDim(it, dimId) {
    const d = S.t.dims.find(x => x.id === dimId); if (!d || !it.res?.cal?.ok) return;
    const roots = E.failedRoots(S.t, it.res.elements, [d.a, d.b].filter(Boolean));
    if (!roots.length) { toast(it.res.dims[dimId]?.err || "No failed element found.", true); return; }
    const id = roots[0];
    if (id.startsWith("REF")) { toast(`${id} was not found: use "Pick REF by hand".`, true); return; }
    if (!S.adjRoi) setAdjRoi(true);
    S.mSel = id;
    // zoom to the search area of that tool
    const roi = roiOf(effTemplate(it), id, it.ov);
    if (roi && mv.mode === "aligned") {
      const pts = handlesFor(S.t, id, it.ov) || [];
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y), pad = 2 + (roi.r || roi.hw || 1) * 2;
      mv.fit({ x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad });
    }
    showItem(); renderRoiCard(it);
    toast(`${id} (${roots.length > 1 ? "and " + roots.slice(1).join(", ") : "used by " + dimId}) failed. Move or widen its search area, change the edge settings, or press Auto search.`);
  }
  function renderRoiCard(it) {
    const id = S.mSel, el = id && S.t.elements.find(e => e.id === id), box = $("#roiEdge");
    if (!it || !el || !E.TOOLS[el.tool]?.measured || el.tool === "color") { box.hidden = true; return; }
    const r = it.res?.elements?.[id], e = { ...E.defaultEdge(), ...(el.edge || {}), ...((it.eov || {})[id] || {}) };
    $("#roiHint").innerHTML = `<b>${id}</b> ${r?.error ? `<span class="bad">${esc(r.error)}</span>` : '<span class="ok">found</span>'} · drag the handles (● = move); edge settings below apply to this photo only.`;
    box.hidden = false;
    box.querySelectorAll("[data-e]").forEach(i => (i.value = e[i.dataset.e]));
  }
  $$("#roiEdge [data-e]").forEach(i => i.addEventListener("change", () => {
    const it = S.items[S.sel], id = S.mSel; if (!it || !id) return;
    it.eov = it.eov || {}; it.eov[id] = { ...(it.eov[id] || {}), [i.dataset.e]: i.dataset.e === "thr" ? +i.value : i.value };
    processItem(it, { keepSerial: true });
  }));
  $("#btnAutoSearch").addEventListener("click", async () => {
    const it = S.items[S.sel]; if (!it?.res?.cal?.ok) return;
    let ids = S.mSel ? [S.mSel] : E.failedRoots(S.t, it.res.elements, S.t.dims.filter(d => it.res.dims[d.id]?.status === "ERR").flatMap(d => [d.a, d.b]).filter(Boolean));
    ids = ids.filter(id => !id.startsWith("REF"));
    if (!ids.length) { toast("Select a measuring tool first (or there is nothing to fix).", true); return; }
    busy(true, "Auto search…"); await nextFrame();
    try {
      const p = await getPhoto(it), out = [];
      for (const id of ids) {
        const el = S.t.elements.find(e => e.id === id);
        const a = E.autoSearch(S.t, p, it.res.cal, el, S.masterRes?.elements?.[id], it.ov);
        if (a?.found) {
          it.ov = it.ov || {}; it.eov = it.eov || {};
          if (a.roiChanged) it.ov[id] = a.roi;
          if (Object.keys(a.edge).length) it.eov[id] = { ...(it.eov[id] || {}), ...a.edge };
          out.push(`${id}: found (${a.roiChanged ? "wider area" : "same area"}${Object.keys(a.edge).length ? ", " + Object.entries(a.edge).map(([k, v]) => k + " " + v).join(", ") : ""})`);
        } else out.push(`${id}: not found in ${a?.tried || 0} tries – move the area by hand`);
      }
      toast(out.join(" · "), out.some(x => x.includes("not found")));
      await processItem(it, { keepSerial: true });
    } catch (err) { console.error(err); toast("Auto search failed: " + err.message, true); }
    busy(false);
  });

  // ---- colour teaching (admin) ----
  function teachFrom(results) {
    const els = S.t.elements.filter(e => e.tool === "color" && !e.white);
    let n = 0;
    for (const el of els) {
      const rs = results.map(r => r?.elements?.[el.id]).filter(r => r && !r.error && r.type === "color");
      if (!rs.length) continue;
      const avg = k => [0, 1, 2].map(i => rs.reduce((s, r) => s + r[k][i], 0) / rs.length);
      if (E.teachColor(el, { type: "color", rgb: avg("rgb"), raw: avg("raw"), lab: avg("lab") })) n++;
    }
    remeasureMaster(); S.stale = S.items.length > 0; renderList();
    toast(`${n} colour point(s) taught from ${results.length} photo(s). Press "Save to library" and Re-measure all.`);
  }
  $("#btnTeachPhoto").addEventListener("click", () => { const it = S.items[S.sel]; if (!isAdmin() || !it?.res?.cal?.ok) return; if (confirm("Use the colours of this photo as the reference?")) teachFrom([it.res]); });
  $("#btnTeachOk").addEventListener("click", () => {
    if (!isAdmin()) return;
    const ok = S.items.filter(i => i.status === "OK" && i.res?.cal?.ok);
    if (!ok.length) { toast("No OK photos.", true); return; }
    if (confirm(`Use the average colours of ${ok.length} OK photo(s) as the reference?`)) teachFrom(ok.map(i => i.res));
  });

  const nomText = d => d.kind === "position" ? `X${d.nomX ?? 0} Y${d.nomY ?? 0}` : "";
  const tolText = d => E.specText(d);

  // ---- comparison with the master ----
  function renderDiff(it) {
    const r = it.res, d = r?.diff, m = S.t.master?.stats, a = r?.appearance, box = $("#mDiff");
    if (!d || !m || !a) { box.innerHTML = r?.cal?.ok ? "Open the program's master again to compare." : "—"; return; }
    const sw = c => `<span class="sw" style="background:rgb(${c.map(v => Math.round(v)).join(",")})"></span>`;
    const flag = (bad, txt) => `<span class="${bad ? "warn" : "ok"}">${txt}</span>`;
    const sc = d.scaleRatio, dist = sc ? 1 / sc : null;
    box.innerHTML = `<table class="diff">
      <tr><td></td><td class="num muted">Master</td><td class="num muted">Photo</td><td class="num muted">Difference</td></tr>
      <tr><td>Brightness</td><td class="num">${m.mean.toFixed(0)}</td><td class="num">${a.mean.toFixed(0)}</td><td class="num">${flag(Math.abs(d.brightnessPct) > 25, (d.brightnessPct >= 0 ? "+" : "") + d.brightnessPct.toFixed(0) + " %")}</td></tr>
      <tr><td>Contrast</td><td class="num">${m.std.toFixed(0)}</td><td class="num">${a.std.toFixed(0)}</td><td class="num">${flag(d.contrastRatio < 0.6 || d.contrastRatio > 1.6, "×" + d.contrastRatio.toFixed(2))}</td></tr>
      <tr><td>Colour</td><td class="num">${sw(m.rgb)}</td><td class="num">${sw(a.rgb)}</td><td class="num">${flag(d.dE > 15, "ΔE " + d.dE.toFixed(1))}</td></tr>
      <tr><td>Size (px/mm)</td><td class="num">${m.pxPerMm.toFixed(1)}</td><td class="num">${a.pxPerMm.toFixed(1)}</td><td class="num">${flag(sc < 0.7 || sc > 1.5, (sc * 100).toFixed(0) + " %")}</td></tr>
      <tr><td>Sharpness</td><td class="num">${m.sharp.toFixed(0)}</td><td class="num">${a.sharp.toFixed(0)}</td><td class="num">${flag(d.sharpRatio < 0.5, "×" + d.sharpRatio.toFixed(2))}</td></tr>
      <tr><td>Rotation</td><td></td><td></td><td class="num">${d.angleDeg.toFixed(1)}°</td></tr>
    </table>
    <div class="muted small" style="margin-top:4px">Camera ≈ ${dist.toFixed(2)}× ${dist >= 1 ? "farther" : "closer"} than for the master${r.match ? ` · edges found after brightness matching (gain ×${r.match.gain.toFixed(2)}, offset ${r.match.offset.toFixed(0)})` : ""}.</div>`;
  }

  // ---- per-photo image adjustment ----
  const ADJ0 = { brightness: 0, contrast: 1, gamma: 1 };
  function fillAdj(it) {
    const a = { ...ADJ0, ...(it.adj || {}) };
    $$("#adjBox [data-a]").forEach(i => (i.value = a[i.dataset.a]));
    $$("#adjBox [data-ao]").forEach(o => (o.textContent = a[o.dataset.ao]));
  }
  $$("#adjBox [data-a]").forEach(i => i.addEventListener("input", () => { $(`#adjBox [data-ao=${i.dataset.a}]`).textContent = i.value; }));
  $("#btnAdjApply").addEventListener("click", () => {
    const it = S.items[S.sel]; if (!it) return;
    it.adj = {}; $$("#adjBox [data-a]").forEach(i => (it.adj[i.dataset.a] = +i.value));
    it.procDisp = null; processItem(it, { keepSerial: true });
  });
  $("#btnAdjReset").addEventListener("click", () => { const it = S.items[S.sel]; if (!it) return; it.adj = null; it.procDisp = null; fillAdj(it); processItem(it, { keepSerial: true }); });
  $("#btnAdjMatch").addEventListener("click", () => {
    const it = S.items[S.sel], d = it?.res?.diff, m = S.t.master?.stats, a = it?.res?.appearance; if (!d || !m || !a) { toast("Measure the photo first.", true); return; }
    const cur = { ...ADJ0, ...(it.adj || {}) };
    const con = Math.max(0.2, Math.min(4, cur.contrast / d.contrastRatio));
    // after the contrast change around mid-gray, shift so the mean lands on the master's mean
    const meanAfter = (a.mean - 128) * (con / cur.contrast) + 128;
    const bri = Math.max(-100, Math.min(100, cur.brightness + (m.mean - meanAfter) / 2.55));
    $("#adjBox [data-a=contrast]").value = con.toFixed(2); $("#adjBox [data-a=brightness]").value = Math.round(bri);
    $$("#adjBox [data-a]").forEach(i => ($(`#adjBox [data-ao=${i.dataset.a}]`).textContent = i.value));
    $("#btnAdjApply").click();
  });

  // ---- reference fixes ----
  $("#btnSwap").addEventListener("click", async () => {
    const it = S.items[S.sel]; if (!it?.res?.cal?.ok) return;
    it.manualRefs = { c1: it.res.cal.c2, c2: it.res.cal.c1 }; await processItem(it, { keepSerial: true });
  });
  $("#btnAuto").addEventListener("click", async () => { const it = S.items[S.sel]; if (!it) return; it.manualRefs = null; await processItem(it, { keepSerial: true }); });
  $("#btnPick").addEventListener("click", () => {
    const it = S.items[S.sel]; if (!it) return;
    if (S.adjRoi) setAdjRoi(false);
    S.pick = { it, c1: null };
    showItem();
    $("#pickHint").textContent = two() ? "Click inside REF1 (yellow = circles found). Esc = cancel." : "Click inside REF1 (yellow = circles found). The rotation is then found from the rotation reference. Esc = cancel.";
  });
  mv.onTool = (type, m, e) => {
    const it = S.items[S.sel];
    if (S.adjRoi && it?.res?.cal?.ok && !S.pick) {
      const f = mv.scene?.frame;
      if (type === "down") {
        const h = hitHandle(mv, handlesFor(S.t, S.mSel, it.ov), e);
        if (h) { S.mdrag = { k: h.k, id: S.mSel, m0: m, roi0: JSON.parse(JSON.stringify(roiOf(S.t, S.mSel, it.ov))) }; return true; }
        return false;
      }
      if (type === "move" && S.mdrag) { it.ov = it.ov || {}; it.ov[S.mdrag.id] = applyHandle(kindOf(S.t, S.mdrag.id), S.mdrag.roi0, S.mdrag.k, m, S.mdrag.m0); showItem(); return true; }
      if (type === "up" && S.mdrag) { S.mdrag = null; processItem(it, { keepSerial: true }); return true; }
      if (type === "click") {
        const zoom = Math.hypot(...mv.T().slice(0, 2)) / (window.devicePixelRatio || 1);
        const id = hitTest(effTemplate(it), it.res.elements, m, 12 / zoom, false);
        S.mSel = id && S.t.elements.find(x => x.id === id)?.roi ? id : null;
        $("#roiHint").textContent = S.mSel ? `${S.mSel}: drag the handles (● = move). Released = measured again.` : "Click a measuring tool (circle, line, point) on the photo.";
        showItem(); renderRoiCard(it);
      }
      return false;
    }
    if (!S.pick) return false;
    if (type === "down") return true;
    if (type !== "up") return true;
    const pk = S.pick, f = mv.scene?.frame;
    const px = f ? G.toPx(f, m) : m;
    getPhoto(pk.it).then(p => {
      const ref = pk.c1 || (pk.it.res?.cal?.ok ? pk.it.res.cal.c1 : null);
      const c = snapCircle(p, px, ref);
      if (!c) { toast("No circle edge found there.", true); return; }
      if (!pk.c1 && two()) { pk.c1 = c; $("#pickHint").textContent = "Now click inside REF2."; }
      else { pk.it.manualRefs = { c1: pk.c1 || c, c2: two() ? c : null }; S.pick = null; $("#pickHint").textContent = ""; processItem(pk.it, { keepSerial: true }); }
    });
    return true;
  };

  // ================= report tab =================
  function reportItems() {
    const w = $("#rWhich").value;
    let list = S.items.filter(i => i.res && i.status !== "WAIT");
    if (w === "ng") list = list.filter(i => i.status !== "OK");
    if (w === "ok") list = list.filter(i => i.status === "OK");
    if (w === "sel") list = S.items[S.sel] ? [S.items[S.sel]] : [];
    return list;
  }
  function renderReportTab() {
    const list = S.items.filter(i => i.res), c = k => list.filter(i => i.status === k).length;
    $("#rKpi").innerHTML = [["total", list.length], ["OK", c("OK")], ["NG", c("NG")], ["CHECK", c("CHECK") + c("FAIL")]].map(([k, v]) => `<div class="kpi"><div class="v ${k === "OK" ? "ok" : k === "NG" ? "bad" : k === "CHECK" ? "warn" : ""}">${v}</div><div class="l">${I.t(k)}</div></div>`).join("");
    const dims = S.t.dims;
    $("#rTable").innerHTML = `<tr><th>#</th><th>${I.t("serial")}</th><th>${I.t("file")}</th><th>${I.t("taken")}</th><th>${I.t("result")}</th>${dims.map(d => `<th class="num" title="${esc(d.name)}">${d.id}<br><span class="muted">${nomText(d)} ${tolText(d)}</span></th>`).join("")}</tr>` +
      list.map((it, i) => `<tr><td>${i + 1}</td><td><b>${esc(itemLabel(it))}</b></td><td>${esc(it.name)}</td><td>${it.date ? it.date.toLocaleString() : ""}</td><td><span class="pill ${it.status}">${it.status}</span></td>${dims.map(d => { const x = it.res.dims?.[d.id]; return `<td class="num ${x?.status === "NG" ? "bad" : ""}">${x?.v != null ? esc(VW.fmtV(x.v, d.kind)) : "—"}</td>`; }).join("")}</tr>`).join("");
  }

  function reportCtx() {
    try { localStorage.setItem("pm.report", JSON.stringify({ op: $("#rOperator").value, co: $("#rCompany").value, lang: $("#rLang").value, detail: $("#rDetail").value })); } catch (e) { }
    return {
      t: S.t, items: reportItems(), lang: $("#rLang").value, operator: $("#rOperator").value, company: $("#rCompany").value,
      pic: $("#rPic").value, imgW: +$("#rImgW").value, label: itemLabel, now: new Date(), detail: $("#rDetail").value,
      loadImage: async it => { const bmp = await createImageBitmap(await fileOf(it), { imageOrientation: "from-image" }); return { img: bmp, imgToPx: VW.A.scale(it.loadScale || 1) }; },
      progress: (i, n) => { $("#rMsg").textContent = `Rendering ${i}/${n}…`; },
    };
  }
  try { const r = JSON.parse(localStorage.getItem("pm.report") || "{}"); $("#rOperator").value = r.op || ""; $("#rCompany").value = r.co || ""; if (r.lang) $("#rLang").value = r.lang; if (r.detail) $("#rDetail").value = r.detail; } catch (e) { }
  async function runReport(kind) {
    const ctx = reportCtx();
    if (!ctx.items.length) { toast("No measured photos to report.", true); return; }
    busy(true, "Building report…"); $$("#tab-report .btn").forEach(b => (b.disabled = true));
    try {
      const { blob, name } = await PM.report[kind](ctx);
      download(blob, name); $("#rMsg").textContent = `Saved ${name} (${(blob.size / 1024).toFixed(0)} kB).`;
    } catch (err) { console.error(err); toast("Report failed: " + err.message, true); $("#rMsg").textContent = ""; }
    $$("#tab-report .btn").forEach(b => (b.disabled = false)); busy(false);
  }
  $("#btnXlsx").addEventListener("click", () => runReport("xlsx"));
  $("#btnPdf").addEventListener("click", () => runReport("pdf"));
  $("#btnDocx").addEventListener("click", () => runReport("docx"));
  $("#btnCsv").addEventListener("click", () => runReport("csv"));
  $("#rWhich").addEventListener("change", renderReportTab);

  /** Load the program for the logged-in user: admin -> working copy; operator -> last library program. */
  async function afterLogin() {
    try {
      if (isAdmin()) {
        const saved = localStorage.getItem("pm.template");
        if (saved) { await openTemplate(JSON.parse(saved)); toast(`Restored last program "${S.t.name}".`); }
        if (!$$("#tabs button.active")[0]?.offsetParent) showTab("template");
      } else {
        const last = localStorage.getItem("pm.lastProgram");
        const list = await LIB.list();
        if (last && list.some(r => r.id === last)) await openFromLibrary(last);
        else if (list.length === 1) await openFromLibrary(list[0].id);
        showTab("measure");
      }
    } catch (e) { console.warn("restore failed", e); }
    renderLibrary();
  }

  // ================= API for the camera module (camera.js) =================
  PM.app = {
    S, hooks, toast, busy, download, safeName, esc,
    isAdmin: () => isAdmin(), showTab: n => showTab(n), saveLocal: () => saveLocal(), two: () => two(),
    ready: () => !!(S.t.master?.frame && S.t.master?.patch),
    activeTab: () => $$("#tabs button.active")[0]?.dataset.tab,
    /** Adds a camera image to the measure list and measures it. Resolves with the item when measured. */
    addShot(file, meta = {}) {
      const it = { id: ++uid, file, name: file.name, status: "WAIT", source: meta.source || "camera", src: meta.src || null, shotId: meta.shotId || null, shotTime: meta.time ? Date.parse(meta.time) : null, cameraName: meta.camera || "", cameraSerial: meta.serial || "", camT: meta.timing || null };
      it.done = new Promise(r => (it._done = r));
      S.items.push(it); enqueue(it); renderList();
      if (S.sel < 0 || meta.select) selectItem(S.items.length - 1);
      $("#mHint").textContent = "";
      return it;
    },
    selectItem: it => { const i = S.items.indexOf(it); if (i >= 0) selectItem(i); },
    loadMaster: f => loadMaster(f, true),
    /** Annotated picture of a measured item (whole image), as a canvas. */
    picture: (it, W = 1600) => PM.report.picture({ t: S.t, pic: "full", loadImage: async x => ({ img: await createImageBitmap(await fileOf(x)), imgToPx: VW.A.scale(x.loadScale || 1) }) }, it, W),
    label: it => itemLabel(it),
    renderLibrary: () => renderLibrary(),
    saveChars: (it, opt) => saveChars(it, opt),
    /** The trained readers changed: refresh the element properties and read the master again. */
    readersChanged: () => { S.ocrCache = {}; renderElements(); if (S.master) remeasureMaster(); },
    /** A station calibration was saved / deleted: re-calibrate the master of a fixed-calibration program. */
    stationChanged: () => { if (!fixedCal()) return; renderStationOptions(); if (S.master && S.t.master?.origW) { if (!S.t.master.c1) S.t.master.c1 = { cx: S.master.w / 2, cy: S.master.h / 2, r: 0 }; calibrateMaster(true); } updateCalInfo(); S.stale = S.items.length > 0; renderList(); },
  };

  // ================= start =================
  (async () => {
    let th = null; try { th = localStorage.getItem("pm.theme"); } catch (x) { }
    setTheme(th || (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
    fillPartFields(); renderElements(); renderDims(); renderDatum(); updateCalInfo(); tplScene();
    busy(true, "Loading OpenCV…");
    try { await V.whenCv(); } catch (e) { toast("OpenCV failed to load: " + e.message, true); }
    busy(false);
    S.user = AU.current(); applyRole();
    if (S.user) await afterLogin(); else showLogin();
    window.PMReady = true;
  })();
})();
