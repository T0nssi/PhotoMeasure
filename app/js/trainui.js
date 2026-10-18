// Training tab: character images saved when measuring (or imported), labels, training and managing the
// trained character readers (PM.charml). Everything stays on this PC (browser storage); export for backup.
"use strict";
PM.trainUi = (() => {
  const A = PM.app, S = A.S, C = PM.charml, esc = A.esc, toast = A.toast;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  let recs = [], shown = [], sel = new Set(), cur = -1, anchor = -1, loaded = false, training = false, lastModel = null;
  const PAGE = 1500;
  const stateOf = r => r.label === "?" || !r.label ? "unl" : r.verified ? "ok" : "auto";
  const day = d => d ? new Date(d).toLocaleString() : "";

  // ---------------- data ----------------
  async function load() {
    try { recs = await C.chars.all(); } catch (e) { toast("Cannot open the training storage: " + e.message, true); recs = []; }
    recs.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : (a.pos || 0) - (b.pos || 0)));
    loaded = true; fillFilters(); render();
  }
  function fillFilters() {
    const keep = (id, html) => { const el = $(id), v = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === v)) el.value = v; };
    const progs = [...new Set(recs.map(r => (r.program || "—") + "\u0001" + (r.el || "")))].sort();
    keep("#trProg", `<option value="">All programs (${recs.length})</option>` + progs.map(k => { const [p, e] = k.split("\u0001"); return `<option value="${esc(k)}">${esc(p)}${e ? " · " + esc(e) : ""} (${recs.filter(r => (r.program || "—") + "\u0001" + (r.el || "") === k).length})</option>`; }).join(""));
    const labels = [...new Set(recs.map(r => r.label || "?"))].filter(l => l !== "?").sort();
    keep("#trLabel", `<option value="">All labels</option><option value="?">? (no label)</option>` + labels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join(""));
  }
  const guess = new Map(); // "model id|record id" -> class read by the reader
  function disagrees(r) {
    const m = C.models.get($("#trModelSel")?.value || "") || C.models.list()[0];
    if (!m || !r.label || r.label === "?") return false;
    const k = m.id + "|" + r.id; if (!guess.has(k)) guess.set(k, C.classify(m, r).c);
    return guess.get(k) !== r.label;
  }
  function filtered() {
    const pg = $("#trProg").value, lb = $("#trLabel").value, st = $("#trState").value, sr = $("#trSrc").value;
    if (st === "dis" && !C.models.list().length) toast("Train a reader first: it shows the images whose label it disagrees with.", true);
    return recs.filter(r => (!pg || (r.program || "—") + "\u0001" + (r.el || "") === pg) && (!lb || (r.label || "?") === lb) && (!sr || r.src === sr) && (!st || (st === "dis" ? disagrees(r) : stateOf(r) === st)));
  }

  // ---------------- grid ----------------
  function render() {
    if (!loaded) return;
    shown = filtered();
    for (const id of [...sel]) if (!shown.some(r => r.id === id)) sel.delete(id);
    if (cur >= shown.length) cur = shown.length - 1;
    const g = $("#trGrid"), n = Math.min(shown.length, PAGE);
    g.innerHTML = shown.length ? shown.slice(0, n).map((r, i) => `<div class="chc ${sel.has(r.id) ? "sel" : ""} ${i === cur ? "cur" : ""}" data-i="${i}" title="${esc(`${r.program || ""} ${r.el || ""} · ${r.photo || ""}${r.serial ? " · " + r.serial : ""}\n${day(r.time)}${r.conf != null ? ` · OCR ${Math.round(r.conf)} %` : ""} · ${{ unl: "no label", auto: "label from reading, not checked", ok: "checked" }[stateOf(r)]}`)}"><span class="st ${stateOf(r)}"></span><img src="${r.thumb}" alt=""><span class="lb">${esc(r.label || "?")}</span></div>`).join("") +
      (shown.length > n ? `<div class="muted small" style="grid-column:1/-1">${shown.length - n} more – narrow the filter to see them.</div>` : "")
      : `<div class="muted" style="grid-column:1/-1;padding:20px">${recs.length ? "No images match the filter." : "No character images yet. Measure photos with a program that has a text (OCR) area and press 💾 Save characters, or import images."}</div>`;
    renderCounts(); renderSelInfo(); renderClasses();
  }
  function renderCounts() {
    const by = {}; for (const r of recs) { const l = r.label || "?"; by[l] = by[l] || { n: 0, ok: 0 }; by[l].n++; if (r.verified) by[l].ok++; }
    const min = +$("#trMin").value || 5, lb = $("#trLabel").value;
    $("#trCounts").innerHTML = Object.keys(by).sort((a, b) => (a === "?") - (b === "?") || (a < b ? -1 : 1)).map(l => `<span class="cnt ${l !== "?" && by[l].ok < min ? "low" : ""} ${lb === l ? "on" : ""}" data-l="${esc(l)}" title="${by[l].n} images, ${by[l].ok} checked">${esc(l)} ${by[l].ok}/${by[l].n}</span>`).join("") || '<span class="muted small">label · checked/all</span>';
  }
  function renderSelInfo() { $("#trSelInfo").textContent = `${sel.size} selected · ${shown.length} shown · ${recs.length} in total`; }
  function selectIdx(i, ev) {
    if (i < 0 || i >= shown.length) return;
    const id = shown[i].id;
    if (ev && ev.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; if (!ev.ctrlKey && !ev.metaKey) sel.clear(); for (let k = a; k <= b; k++) sel.add(shown[k].id); }
    else if (ev && (ev.ctrlKey || ev.metaKey)) { sel.has(id) ? sel.delete(id) : sel.add(id); anchor = i; }
    else { sel.clear(); sel.add(id); anchor = i; }
    cur = i; paintSel();
  }
  function paintSel() {
    $$("#trGrid .chc").forEach(el => { const i = +el.dataset.i; el.classList.toggle("sel", sel.has(shown[i]?.id)); el.classList.toggle("cur", i === cur); });
    const c = $(`#trGrid .chc[data-i="${cur}"]`); if (c) c.scrollIntoView({ block: "nearest" });
    renderSelInfo();
  }
  $("#trGrid").addEventListener("click", e => { const c = e.target.closest(".chc"); if (!c) return; selectIdx(+c.dataset.i, e); $("#trGrid").focus(); });
  $("#trGrid").addEventListener("keydown", async e => {
    if (e.target !== $("#trGrid")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { selectIdx(Math.max(0, Math.min(shown.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))), e.shiftKey ? e : null); e.preventDefault(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSel(); return; }
    if (!sel.size) return;
    if (e.key === "Enter") { e.preventDefault(); await update(r => { if (r.label && r.label !== "?") r.verified = true; }); next(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") { e.preventDefault(); const L = e.key.toUpperCase(); await update(r => { r.label = L; r.verified = true; r.auto = false; }); next(); }
  });
  function next() { // after labelling: the next image after the current one that was not just labelled
    const ids = new Set(sel); let nid = null;
    for (let k = cur + 1; k < shown.length; k++) if (!ids.has(shown[k].id)) { nid = shown[k].id; break; }
    render();
    let i = nid ? shown.findIndex(r => r.id === nid) : -1;
    if (i < 0) i = Math.min(cur, shown.length - 1);
    if (i >= 0) selectIdx(i);
  }
  async function update(fn) {
    const ch = recs.filter(r => sel.has(r.id)); if (!ch.length) return;
    ch.forEach(fn);
    try { await C.chars.put(ch); } catch (e) { toast("Saving failed: " + e.message, true); }
    fillFilters(); renderCounts();
  }
  async function delSel() {
    if (!sel.size) return;
    if (sel.size > 1 && !confirm(`Delete ${sel.size} character images?`)) return;
    const ids = [...sel]; await C.chars.del(ids);
    recs = recs.filter(r => !sel.has(r.id)); sel.clear(); fillFilters(); render();
    $("#trGrid").focus();
  }

  ["#trProg", "#trLabel", "#trState", "#trSrc"].forEach(s => $(s).addEventListener("change", () => { cur = -1; render(); }));
  $("#trCounts").addEventListener("click", e => { const c = e.target.closest(".cnt"); if (!c) return; $("#trLabel").value = $("#trLabel").value === c.dataset.l ? "" : c.dataset.l; cur = -1; render(); });
  $("#trSelAll").addEventListener("click", () => { shown.forEach(r => sel.add(r.id)); paintSel(); });
  $("#trSelNone").addEventListener("click", () => { sel.clear(); paintSel(); });
  $("#trSetLabel").addEventListener("click", async () => { const L = $("#trLabelIn").value.trim().toUpperCase(); if (!L) { toast("Type the character first.", true); return; } if (!sel.size) { toast("Select images first.", true); return; } await update(r => { r.label = L; r.verified = true; r.auto = false; }); render(); });
  $("#trVerify").addEventListener("click", async () => { if (!sel.size) { toast("Select images first.", true); return; } let skip = 0; await update(r => { if (r.label && r.label !== "?") r.verified = true; else skip++; }); render(); if (skip) toast(`${skip} images without a label were not marked.`, true); });
  $("#trDelete").addEventListener("click", delSel);
  $("#trPredict").addEventListener("click", async () => {
    const m = C.models.get($("#trModelSel")?.value || "") || C.models.list()[0];
    if (!m) { toast("Train a reader first.", true); return; }
    if (!sel.size) { toast("Select images first.", true); return; }
    let n = 0; await update(r => { if (r.label === "?" || !r.label) { const p = C.classify(m, r); r.label = p.c; r.verified = false; r.auto = true; n++; } });
    render(); toast(`${n} images pre-labelled with "${m.name}". Check them (Enter = correct, or type the right character).`);
  });

  // ---------------- import / export ----------------
  const labelFromPath = f => {
    const parts = (f.webkitRelativePath || f.name).split("/"), dir = parts.length > 1 ? parts[parts.length - 2] : "", base = parts[parts.length - 1];
    if (dir.length === 1) return dir.toUpperCase();
    const m = /^([A-Za-z0-9])(?:[_\-. ]|$)/.exec(base); return m ? m[1].toUpperCase() : "?";
  };
  async function importFiles(files) {
    files = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|bmp|gif|webp)$/i.test(f.name)); if (!files.length) return;
    A.busy(true, `Importing ${files.length} images…`);
    const out = [], time = new Date().toISOString();
    for (const f of files) {
      try { const r = await C.fromImageFile(f), L = labelFromPath(f); out.push({ id: C.uid(), label: L, auto: false, verified: L !== "?", src: "import", program: "import", el: (f.webkitRelativePath || "").split("/")[0] || "", photo: f.name, serial: "", time, conf: null, pos: 0, img: C.b64(r.img), thumb: r.thumb }); }
      catch (e) { console.warn(f.name, e); }
    }
    A.busy(false);
    await C.chars.put(out); toast(`${out.length} images imported (${out.filter(r => r.label === "?").length} without label).`);
    await load();
  }
  $("#trImpFiles").addEventListener("change", e => { importFiles(e.target.files); e.target.value = ""; });
  $("#trImpDir").addEventListener("change", e => { importFiles(e.target.files); e.target.value = ""; });
  $("#trImpJson").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.type === "pm-reader" && d.model?.W1) {
        const m = d.model; if (C.models.get(m.id) && !confirm(`Reader "${m.name}" exists. Replace it?`)) return;
        await C.models.put(m); renderModels(); A.readersChanged(); toast(`Reader "${m.name}" imported (${m.classes.length} characters).`);
      } else if (d.type === "pm-chars" && Array.isArray(d.chars)) {
        const have = new Set(recs.map(r => r.id)), add = d.chars.filter(r => r && r.id && r.img && !have.has(r.id));
        await C.chars.put(add); toast(`${add.length} character images imported (${d.chars.length - add.length} were already here).`); await load();
      } else toast("Not a PhotoMeasure character data or reader file.", true);
    } catch (err) { toast("Import failed: " + err.message, true); }
  });
  $("#trExport").addEventListener("click", () => {
    if (!recs.length) { toast("No character images.", true); return; }
    A.download(new Blob([JSON.stringify({ type: "pm-chars", version: 1, date: new Date().toISOString(), chars: recs })], { type: "application/json" }), `PhotoMeasure_chars_${new Date().toISOString().slice(0, 10)}.json`);
  });

  // ---------------- training ----------------
  function candidates() {
    const base = $("#trOnlyShown").checked ? shown : recs;
    return base.filter(r => r.label && r.label !== "?" && (!$("#trOnlyOk").checked || r.verified));
  }
  function renderClasses() {
    const cs = candidates(), by = {}; cs.forEach(r => { by[r.label] = (by[r.label] || 0) + 1; });
    const min = +$("#trMin").value || 5, keys = Object.keys(by).sort(), use = keys.filter(k => by[k] >= min), low = keys.filter(k => by[k] < min);
    $("#trClasses").innerHTML = !cs.length ? `<span class="warn">No labelled images${$("#trOnlyOk").checked ? " marked ✔ checked" : ""} yet.</span>` :
      `${cs.length} images → <b>${use.length} characters</b>: ${use.map(k => `<b class="mono">${esc(k)}</b><span class="muted">×${by[k]}</span>`).join(" · ")}` +
      (low.length ? `<br><span class="warn">Left out (fewer than ${min}): ${low.map(k => `${esc(k)} ${by[k]}`).join(", ")}</span>` : "") +
      (use.length && Math.min(...use.map(k => by[k])) < 30 ? `<br><span class="muted">Fewer than 30 images for some characters: the test result will be rough. 50+ per character is better.</span>` : "");
  }
  ["#trOnlyOk", "#trOnlyShown", "#trMin"].forEach(s => $(s).addEventListener("change", () => { renderClasses(); renderCounts(); }));

  function drawChart(hist, epochs) {
    const c = $("#trChart"), x = c.getContext("2d"), W = c.width, H = c.height, L = 34, R = 8, T = 18, B = 22;
    c.style.display = "";
    const css = getComputedStyle(document.body), col = n => css.getPropertyValue(n).trim() || "#888";
    x.clearRect(0, 0, W, H); x.font = "11px sans-serif";
    const X = e => L + (e - 1) / Math.max(1, epochs - 1) * (W - L - R), Y = v => T + (1 - v) * (H - T - B);
    x.strokeStyle = col("--line"); x.fillStyle = col("--muted"); x.lineWidth = 1;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) { x.beginPath(); x.moveTo(L, Y(v)); x.lineTo(W - R, Y(v)); x.stroke(); x.fillText(Math.round(v * 100) + "%", 2, Y(v) + 4); }
    x.fillText("1", L - 2, H - 6); x.fillText(`${epochs} epochs`, X(epochs) - 52, H - 6);
    const line = (k, color, dash) => { x.strokeStyle = color; x.setLineDash(dash); x.lineWidth = 2; x.beginPath(); hist.forEach((h, i) => { if (h[k] == null) return; i ? x.lineTo(X(h.epoch), Y(h[k])) : x.moveTo(X(h.epoch), Y(h[k])); }); x.stroke(); x.setLineDash([]); };
    line("train", col("--muted"), [5, 4]); line("val", col("--accent"), []);
    const l = hist[hist.length - 1];
    x.fillStyle = col("--muted"); x.fillText(`training ${l.train != null ? (100 * l.train).toFixed(1) : "—"} %`, L + 4, 12);
    x.fillStyle = col("--accent"); x.fillText(`validation ${l.val != null ? (100 * l.val).toFixed(1) : "—"} %`, L + 130, 12);
  }
  $("#trGo").addEventListener("click", async () => {
    if (training) return;
    const cs = candidates();
    const name = $("#trName").value.trim() || `Reader ${new Date().toLocaleDateString()}`;
    training = true; $("#trGo").disabled = true; $("#trStop").disabled = false; $("#trResult").innerHTML = ""; $("#trProgress").textContent = "starting…";
    const hist = [];
    try {
      const m = await C.train(cs, { name, hidden: +$("#trHidden").value, epochs: +$("#trEpochs").value || 60, aug: $("#trAug").checked, minPerClass: +$("#trMin").value || 5, verifiedOnly: $("#trOnlyOk").checked, by: S.user?.name || "",
        onEpoch: (r, ep) => { hist.push(r); drawChart(hist, ep); $("#trProgress").textContent = `epoch ${r.epoch}/${ep} · ${(r.ms / 1000).toFixed(0)} s`; } });
      m.trainIds = cs.map(r => r.id); // images this reader has seen (incl. its own validation / test images)
      await C.models.put(m); lastModel = m;
      $("#trProgress").textContent = `done in ${(m.ms / 1000).toFixed(1)} s · best epoch ${m.bestEpoch}`;
      showResult(m); renderModels(); A.readersChanged();
      toast(`Reader "${m.name}" saved: test ${(100 * m.testAcc).toFixed(1)} %.`);
    } catch (e) { $("#trProgress").textContent = ""; $("#trResult").innerHTML = `<span class="${/stopped/.test(e.message) ? "muted" : "bad"}">${esc(e.message)}</span>`; }
    training = false; $("#trGo").disabled = false; $("#trStop").disabled = true;
  });
  $("#trStop").addEventListener("click", () => { C.stop(); training = false; $("#trGo").disabled = false; $("#trStop").disabled = true; $("#trProgress").textContent = "stopped"; });

  const pct = v => v == null ? "—" : (100 * v).toFixed(1) + " %";
  function verdict(m) {
    const gap = m.trainAcc - m.valAcc;
    const out = [];
    const errs = Math.round((1 - m.testAcc) * m.nTest);
    const bound = errs === 0 ? 3 / m.nTest : Math.min(1, (1 - m.testAcc) + 2 * Math.sqrt(m.testAcc * (1 - m.testAcc) / m.nTest));
    out.push(`${errs} wrong in ${m.nTest} test images: the real error rate may still be up to about ${(100 * bound).toFixed(bound < 0.01 ? 2 : 1)} %${errs === 0 ? " (3 ÷ number of test images)" : ""}.${m.nTest < 300 ? " More images make this sure." : ""}`);
    if (gap > 0.05) out.push(`Training ${pct(m.trainAcc)} vs validation ${pct(m.valAcc)}: the reader remembers its images more than it learned the shapes (overfitting). More varied images help most.`);
    if (m.testAcc < 0.95) out.push("Below 95 %: check the labels of the mistakes below first – wrong labels are the most common cause.");
    if (out.length === 1 && m.testAcc >= 0.95) out.push("Test it on new photos (Measure tab) before you use it in production. Use the filter \"Reader disagrees with label\" to find wrong labels.");
    return out;
  }
  function showResult(m) {
    const thumbs = id => recs.find(r => r.id === id)?.thumb || "";
    $("#trResult").innerHTML = `<div class="kv"><span class="k">Images</span><span>${m.n} (${m.nTrain} train · ${m.nVal} validation · ${m.nTest} test) · ${m.classes.length} characters</span>
      <span class="k">Accuracy</span><span>training <b>${pct(m.trainAcc)}</b> · validation <b>${pct(m.valAcc)}</b> · test <b>${pct(m.testAcc)}</b></span></div>
      <div style="margin-top:4px">${verdict(m).map(s => "• " + esc(s)).join("<br>")}</div>
      ${m.pairs.length ? `<div style="margin-top:4px"><b>Confused</b> (true → read, test set): ${m.pairs.map(p => `<span class="mono">${esc(p.t)}→${esc(p.p)}</span> ×${p.n}`).join(", ")}</div>` : ""}
      ${m.mistakes.length ? `<div style="margin-top:4px"><b>Test mistakes</b> <span class="muted">(click = show the image to check its label)</span><br>${m.mistakes.map(q => `<span class="mist" data-id="${esc(q.id)}"><img src="${thumbs(q.id)}" alt="">${esc(q.label)}→${esc(q.read)}</span>`).join("")}</div>` : ""}
      ${m.skipped?.length ? `<div class="muted" style="margin-top:4px">Left out: ${m.skipped.map(esc).join(", ")}</div>` : ""}`;
    $$("#trResult .mist").forEach(el => el.addEventListener("click", () => showRec(el.dataset.id)));
    if (m.hist?.length) drawChart(m.hist, m.settings?.epochs || m.hist.length);
  }
  function showRec(id) {
    ["#trProg", "#trLabel", "#trState", "#trSrc"].forEach(s => { $(s).value = ""; });
    render(); const i = shown.findIndex(r => r.id === id);
    if (i < 0) { toast("That image was deleted.", true); return; }
    if (i >= PAGE) { $("#trLabel").value = shown[i].label; render(); }
    const j = shown.findIndex(r => r.id === id); selectIdx(j); $("#trGrid").focus();
  }

  // ---------------- trained readers ----------------
  function users(m) { // text elements of the open program that use this reader
    return (S.t.elements || []).filter(e => e.tool === "ocr" && e.reader === m.id).map(e => e.id);
  }
  function renderModels() {
    const ms = C.models.list();
    const ocrEls = (S.t.elements || []).filter(e => e.tool === "ocr");
    $("#trModels").innerHTML = ms.length ? `<tr><th>Name</th><th class="num">Chars</th><th class="num">Test</th><th>Date</th><th></th></tr>` + ms.map(m => `<tr class="click ${$("#trModelSel")?.value === m.id ? "sel" : ""}" data-id="${esc(m.id)}"><td><input type="radio" name="trM" ${lastModel?.id === m.id ? "checked" : ""}> ${esc(m.name)}${users(m).length ? ` <span class="pill OK" title="used by ${esc(users(m).join(", "))} in the open program">in use</span>` : ""}</td><td class="num">${m.classes.length}</td><td class="num">${pct(m.testAcc)}</td><td>${esc(new Date(m.date).toLocaleDateString())}</td><td><button class="x" data-del title="Delete">✕</button></td></tr>`).join("")
      : `<tr><td class="muted">No trained reader yet.</td></tr>`;
    let pick = lastModel && C.models.get(lastModel.id) ? lastModel : ms[0];
    $("#trModelInfo").innerHTML = !pick ? "" : `<input type="hidden" id="trModelSel" value="${esc(pick.id)}">
      <div class="kv"><span class="k">Reader</span><span><b>${esc(pick.name)}</b> · ${esc(day(pick.date))}${pick.by ? " · " + esc(pick.by) : ""}</span>
      <span class="k">Characters</span><span class="mono">${esc(pick.classes.join(" "))}</span>
      <span class="k">Result</span><span>test ${pct(pick.testAcc)} · validation ${pct(pick.valAcc)} · ${pick.n} images · network ${pick.hidden}</span></div>
      <div class="row" style="margin-top:6px">
        ${ocrEls.length ? `<select id="trUseEl">${ocrEls.map(e => `<option value="${e.id}">${e.id} ${esc(e.name || "")}${e.reader === pick.id ? " (uses it)" : ""}</option>`).join("")}</select><button class="btn sm primary" id="trUse" title="Read this text element of the open program with this reader">Use in program</button><button class="btn sm" id="trUnuse">Built-in OCR</button>` : `<span class="muted">Open a program with a text element to use it.</span>`}
      </div>
      <div class="row" style="margin-top:6px"><button class="btn sm" id="trShow">Result</button><button class="btn sm" id="trTest" title="Accuracy on the images shown that this reader has never seen (new photos)">Test on new images</button><button class="btn sm" id="trExportM">⬇ Export reader</button><button class="btn sm" id="trRename">Rename</button></div>
      <div id="trTestRes" class="small" style="margin-top:4px"></div>`;
    $$("#trModels tr[data-id]").forEach(tr => {
      tr.addEventListener("click", e => { if (e.target.closest("[data-del]")) return; lastModel = C.models.get(tr.dataset.id); renderModels(); });
      tr.querySelector("[data-del]")?.addEventListener("click", async () => {
        const m = C.models.get(tr.dataset.id); if (!m) return;
        const u = users(m); if (!confirm(`Delete reader "${m.name}"?${u.length ? ` ${u.join(", ")} of the open program use it and will read with the built-in OCR.` : ""}`)) return;
        await C.models.del(m.id); (S.t.elements || []).forEach(e => { if (e.reader === m.id) delete e.reader; }); A.saveLocal(); if (lastModel?.id === m.id) lastModel = null; renderModels(); A.readersChanged();
      });
    });
    if (!pick) return;
    $("#trUse")?.addEventListener("click", () => { const el = S.t.elements.find(e => e.id === $("#trUseEl").value); if (!el) return; el.reader = pick.id; A.saveLocal(); A.readersChanged(); renderModels(); toast(`${el.id} now reads with "${pick.name}". Save the program to the library so operators get it.`); });
    $("#trUnuse")?.addEventListener("click", () => { const el = S.t.elements.find(e => e.id === $("#trUseEl").value); if (!el) return; delete el.reader; A.saveLocal(); A.readersChanged(); renderModels(); toast(`${el.id} reads with the built-in OCR again.`); });
    $("#trShow").addEventListener("click", () => showResult(pick));
    $("#trExportM").addEventListener("click", () => { const m = { ...pick }; delete m._net; A.download(new Blob([JSON.stringify({ type: "pm-reader", version: 1, model: m })], { type: "application/json" }), `PhotoMeasure_reader_${A.safeName(pick.name)}.json`); });
    $("#trRename").addEventListener("click", async () => { const n = prompt("Name of the reader", pick.name); if (!n) return; pick.name = n.trim(); await C.models.put(pick); renderModels(); A.readersChanged(); });
    $("#trTest").addEventListener("click", () => {
      const seen = new Set(pick.trainIds || []);
      const pool = shown.filter(r => !seen.has(r.id) && r.label && r.label !== "?");
      const okOnly = pool.filter(r => r.verified);
      const res = C.evaluate(pick, okOnly.length ? okOnly : pool);
      $("#trTestRes").innerHTML = !res.n ? `<span class="muted">No new labelled images in the filter (images used for training are left out). Save characters of new photos, check their labels, then test.</span>` :
        `${res.n} new images${okOnly.length ? " (checked)" : " (labels not checked!)"}: <b>${pct(res.acc)}</b> correct, ${res.wrong.length} wrong` + (res.wrong.length ? `<br>${res.wrong.slice(0, 40).map(q => `<span class="mist" data-id="${esc(q.id)}"><img src="${recs.find(r => r.id === q.id)?.thumb || ""}" alt="">${esc(q.label)}→${esc(q.read)}</span>`).join("")}` : "");
      $$("#trTestRes .mist").forEach(el => el.addEventListener("click", () => showRec(el.dataset.id)));
    });
  }

  // ---------------- automatic saving while measuring ----------------
  try { $("#trAuto").checked = localStorage.getItem("pm.train.autoSave") === "1"; } catch (e) { }
  $("#trAuto").addEventListener("change", e => { try { localStorage.setItem("pm.train.autoSave", e.target.checked ? "1" : "0"); } catch (x) { } toast(e.target.checked ? "Characters of every measured photo will be saved." : "Automatic saving off."); });
  A.hooks.measured.push(it => {
    let on = false; try { on = localStorage.getItem("pm.train.autoSave") === "1"; } catch (e) { }
    if (!on || it.charsSaved || !it.res?.cal?.ok || !(S.t.elements || []).some(e => e.tool === "ocr")) return;
    A.saveChars(it, { quiet: true }).catch(e => console.warn("auto save chars", e));
  });
  A.hooks.chars.push(rs => { if (!loaded) return; recs = recs.concat(rs); fillFilters(); render(); });
  A.hooks.tab.push(name => { if (name === "train") { if (!loaded) load(); else render(); renderModels(); } });
  A.hooks.program.push(() => renderModels());
  C.models.ready().then(() => { renderModels(); A.readersChanged(); });

  return { load, render, get recs() { return recs; }, get shown() { return shown; }, select: ids => { sel = new Set(ids); paintSel(); }, showResult, renderModels };
})();
