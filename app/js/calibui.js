// Station calibration card (Calibration tab, always visible – also inside CodeVerifyStation): grab or load a picture of a calibration plate, measure the scale,
// save it for the station (camera serial), check it again later (daily check), history.
"use strict";
PM.calibUi = (() => {
  const A = PM.app, C = PM.calib, V = PM.vision, I = PM.i18n, esc = A.esc, S = A.S;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const GEOM = ["Width", "Height", "OffsetX", "OffsetY", "BinningHorizontal", "BinningVertical", "DecimationHorizontal", "DecimationVertical", "ReverseX", "ReverseY"];
  let last = null; // {res, photo, station, serial, model, source}

  // camera of this PC: Camera Bridge, or inside CodeVerifyStation the station's camera (cam.status: name, serial)
  const cam = () => {
    const st = PM.camera?.state;
    if (PM.host?.active) return st?.hostCam?.connected && st.hostCam.serial ? { serial: st.hostCam.serial, name: st.hostCam.name || "", model: "" } : null;
    return st?.cam?.connected ? st.cam.camera : null;
  };
  const curStation = () => cam()?.serial || last?.station || "files";
  const f3 = v => (v == null || isNaN(v) ? "—" : v.toFixed(3));
  const day = d => new Date(d).toLocaleString();

  function sizeLabel() { $("#calSizeLbl").textContent = $("#calMethod").value === "dots" ? I.t("calPitch") : I.t("calDia"); }
  $("#calMethod").addEventListener("change", sizeLabel);

  function renderActive() {
    const stn = curStation(), rec = C.active(stn), s = C.stateOf(rec);
    $("#calState").innerHTML = !rec ? `<span class="warn">${esc(I.t("calNone"))}</span>` : s.state === "expired" ? `<span class="bad">${esc(I.t("calExpired"))}</span>` : s.state === "soon" ? `<span class="warn">${esc(I.t("calSoon"))}</span>` : `<span class="ok">✔ ${esc(I.t("calValidLbl"))}</span>`;
    if (!rec) { $("#calActive").innerHTML = `${esc(stn === "files" ? "Photos from files" : "Camera " + stn)}: ${esc(I.t("calNoneHint"))}`; renderList(); return; }
    const chk = rec.checks?.[rec.checks.length - 1];
    let geo = "";
    const feats = PM.camera?.state?.feats || [], fw = feats.find(f => f.name === "Width")?.value, fh = feats.find(f => f.name === "Height")?.value;
    if (cam() && rec.station === cam().serial && fw && fh && (Math.abs(fw - rec.W0) > 2 || Math.abs(fh - rec.H0) > 2)) geo = `<br><span class="bad">Camera image is now ${fw}×${fh} px, the calibration was made at ${rec.W0}×${rec.H0} px: calibrate again.</span>`;
    $("#calActive").innerHTML = `<b>${esc(rec.name || rec.station)}</b> · ${esc(day(rec.date))}${rec.by ? " · " + esc(rec.by) : ""}<br>` +
      `<b>${(rec.s0 * 1000).toFixed(3)} µm/px</b> (${(1 / rec.s0).toFixed(2)} px/mm) · ${rec.W0}×${rec.H0} px · ${rec.method === "dots" ? `${rec.n} dots, pitch ${rec.size} mm` : `gauge Ø${rec.size} mm`}` +
      `<br>Grid error RMS ${rec.rmsUm != null ? rec.rmsUm.toFixed(1) : "—"} µm · max ${rec.maxUm != null ? rec.maxUm.toFixed(1) : "—"} µm${rec.validDays > 0 ? ` · valid ${rec.validDays} days${s.days != null ? ` (${s.days >= 0 ? Math.floor(s.days) + " left" : "expired"})` : ""}` : ""}` +
      (chk ? `<br>Last check ${esc(day(chk.date))}: <span class="${chk.ok ? "ok" : "bad"}">${chk.diffPct >= 0 ? "+" : ""}${chk.diffPct.toFixed(3)} % ${chk.ok ? "OK" : "NG"}</span>` : "") + geo;
    renderList();
  }
  function renderList() {
    const all = C.list().sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    $("#calList").innerHTML = all.length ? `<table class="tbl small"><tr><th>Station</th><th>Date</th><th class="num">µm/px</th><th class="num">RMS µm</th><th></th></tr>` +
      all.map(r => `<tr><td>${esc(r.name || r.station)}<div class="muted">${esc(r.station)}</div></td><td>${esc(new Date(r.date).toLocaleDateString())}<div class="muted">${esc(r.by || "")}</div></td><td class="num">${(r.s0 * 1000).toFixed(3)}</td><td class="num">${r.rmsUm != null ? r.rmsUm.toFixed(1) : "—"}</td><td>${A.isAdmin() ? `<button class="btn sm danger" data-cdel="${esc(r.id)}" title="Delete">✕</button>` : ""}</td></tr>`).join("") + "</table>" : `<span class="muted">${esc(I.t("calNone"))}</span>`;
    $$("#calList [data-cdel]").forEach(b => b.addEventListener("click", () => {
      const r = C.get(b.dataset.cdel); if (!r || !A.isAdmin()) return;
      if (!confirm(`Delete the station calibration of ${day(r.date)}? Programs then use the next newest calibration of this station.`)) return;
      C.del(r.id); renderActive(); A.stationChanged();
    }));
  }

  async function runPlate(file, source, shot) {
    const method = $("#calMethod").value, size = +$("#calSize").value;
    if (!(size > 0)) { A.toast(method === "dots" ? I.t("calPitch") + "?" : I.t("calDia") + "?", true); return; }
    A.busy(true, "Measuring the calibration plate…");
    try {
      await V.whenCv();
      const photo = await V.loadPhoto(file, 8000, V.defaultProc());
      const t0 = performance.now();
      const res = await C.measurePlate(photo, method, size);
      res.ms = performance.now() - t0;
      const c = cam();
      const station = source === "camera" ? (shot?.serial || c?.serial || "files") : (c ? c.serial : "files");
      last = { res, photo, station, serial: source === "camera" ? shot?.serial || c?.serial || "" : c?.serial || "", model: shot?.model || c?.model || "", source };
      draw(); showRes();
      $("#calSave").disabled = !A.isAdmin(); $("#calCheck").disabled = !C.active(station);
    } catch (e) { console.error(e); last = null; $("#calRes").innerHTML = `<span class="bad">${esc(e.message || String(e))}</span>`; $("#calView").hidden = true; $("#calSave").disabled = true; $("#calCheck").disabled = true; }
    A.busy(false);
  }
  function showRes() {
    const r = last.res, rec = C.active(last.station);
    const cmp = rec ? C.compare(rec, r) : null;
    $("#calRes").innerHTML = `<table class="tbl small" style="width:100%">
      <tr><td>Scale</td><td class="num"><b>${(r.s0 * 1000).toFixed(4)} µm/px</b> · ${(1 / r.s0).toFixed(3)} px/mm</td></tr>
      <tr><td>Image</td><td class="num">${r.W0}×${r.H0} px · ${esc(last.station === "files" ? "photos from files" : "camera " + last.station)}</td></tr>
      ${r.method === "dots" ? `<tr><td>Dots used</td><td class="num">${r.n} of ${r.found} (${r.polarity}) · plate covers ${r.cover} %</td></tr>
      <tr><td>X / Y scale</td><td class="num">${(r.sU * 1000).toFixed(4)} / ${(r.sV * 1000).toFixed(4)} µm/px (${r.aniso >= 0 ? "+" : ""}${r.aniso.toFixed(3)} %)</td></tr>
      <tr><td>Squareness · angle</td><td class="num">${r.skewDeg.toFixed(3)}° · plate turned ${r.rotDeg.toFixed(2)}°</td></tr>
      <tr><td>Dot error RMS / max</td><td class="num">${r.rmsUm.toFixed(2)} / ${r.maxUm.toFixed(2)} µm (${r.rmsPx.toFixed(2)} px RMS)</td></tr>
      <tr><td>Lens distortion (corner)</td><td class="num">${r.distPct.toFixed(3)} %</td></tr>
      <tr><td>Tilt (scale change across image)</td><td class="num">${r.tiltPct.toFixed(3)} %</td></tr>` : `<tr><td>Gauge</td><td class="num">Ø ${r.size} mm · edge RMS ${r.rmsUm.toFixed(2)} µm</td></tr>`}
      ${cmp ? `<tr><td>vs saved (${esc(new Date(rec.date).toLocaleDateString())})</td><td class="num ${cmp.ok ? "ok" : "bad"}">${cmp.diffPct >= 0 ? "+" : ""}${cmp.diffPct.toFixed(3)} % (limit ±${cmp.limitPct} %)</td></tr>` : ""}
      <tr><td>Time</td><td class="num">${Math.round(r.ms)} ms</td></tr></table>` +
      (r.warn.length ? `<div class="warn" style="margin-top:4px">⚠ ${r.warn.map(esc).join("<br>⚠ ")}</div>` : `<div class="ok" style="margin-top:4px">✔ ${esc(I.t("calGood"))}</div>`);
  }
  function draw() {
    const cv = $("#calView"), p = last.photo, r = last.res;
    cv.hidden = false;
    const W = 600, k = W / p.w, H = Math.round(p.h * k);
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.drawImage(p.canvas, 0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, 0, W, H);
    if (r.draw.circle) { const c = r.draw.circle; g.strokeStyle = "#22c55e"; g.lineWidth = 2; g.beginPath(); g.arc(c.cx * k, c.cy * k, c.r * k, 0, 7); g.stroke(); return; }
    const rms = Math.max(1e-6, r.rmsUm / (r.s0 * 1000) * (p.loadScale || 1)), mag = 0.25 * W / Math.sqrt(r.n) / (3 * Math.max(rms, 0.02) * k);
    for (const d of r.draw.dots) {
      const col = d.res < 2 * rms ? "#22c55e" : d.res < 4 * rms ? "#f59e0b" : "#ef4444";
      g.fillStyle = col; g.beginPath(); g.arc(d.x * k, d.y * k, 2.2, 0, 7); g.fill();
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(d.x * k, d.y * k); g.lineTo(d.x * k - d.ex * k * mag, d.y * k - d.ey * k * mag); g.stroke();
    }
    g.fillStyle = "#fff"; g.font = "12px sans-serif"; g.fillText(`dot errors ×${Math.round(mag)} (lines)`, 6, H - 6);
  }

  function settingsSnapshot() {
    const out = {}; for (const f of PM.camera?.state?.feats || []) if (GEOM.includes(f.name) && f.value != null) out[f.name] = f.value;
    return out;
  }
  $("#calSave").addEventListener("click", () => {
    if (!last || !A.isAdmin()) return;
    const r = last.res;
    if (r.method === "dots" && r.warn.length && !confirm("The calibration has warnings:\n- " + r.warn.join("\n- ") + "\n\nSave anyway?")) return;
    const rec = {
      id: "cal" + Date.now().toString(36), name: $("#calName").value.trim() || (cam()?.name || ""), station: last.station, serial: last.serial, model: last.model,
      W0: r.W0, H0: r.H0, s0: r.s0, sU: r.sU, sV: r.sV, skewDeg: r.skewDeg, rotDeg: r.rotDeg, rmsUm: r.rmsUm, maxUm: r.maxUm, distPct: r.distPct,
      n: r.n, size: r.size, method: r.method, cover: r.cover, date: new Date().toISOString(), by: S.user?.name || "", validDays: Math.max(0, +$("#calDays").value || 0),
      settings: last.source === "camera" ? settingsSnapshot() : {}, checks: [], warn: r.warn,
    };
    C.put(rec);
    A.toast(`Station calibration saved: ${(rec.s0 * 1000).toFixed(4)} µm/px for ${rec.station === "files" ? "photos from files" : "camera " + rec.station}. Programs of this station use it from now on.`);
    $("#calCheck").disabled = false;
    renderActive(); showRes(); A.stationChanged();
  });
  $("#calCheck").addEventListener("click", () => {
    if (!last) return;
    const rec = C.active(last.station); if (!rec) return;
    const cmp = C.compare(rec, last.res);
    rec.checks = [...(rec.checks || []), { date: new Date().toISOString(), by: S.user?.name || "", diffPct: cmp.diffPct, ok: cmp.ok, s0: last.res.s0 }].slice(-50);
    C.put(rec);
    A.toast(cmp.ok ? `Calibration check OK: ${cmp.diffPct.toFixed(3)} % (limit ±${cmp.limitPct} %).` : `Calibration check NG: ${cmp.diffPct.toFixed(3)} % (limit ±${cmp.limitPct} %). Find the cause (focus, height, camera moved), then calibrate again.`, !cmp.ok);
    renderActive();
  });
  $("#calFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) runPlate(f, "file"); });
  $("#calGrab").addEventListener("click", async () => {
    if (!PM.camera) return;
    const r = await PM.camera.grab({ measure: false }); if (!r) return;
    const ext = r.blob.type === "image/png" ? "png" : "bmp";
    await runPlate(new File([r.blob], `plate_${r.shot.shotId}.${ext}`, { type: r.blob.type }), "camera", r.shot);
  });

  A.hooks.tab.push(n => { if (n === "calib" || n === "camera") renderActive(); });
  A.hooks.role.push(() => renderActive());
  sizeLabel(); renderActive();
  return { renderActive, get last() { return last; } };
})();
