// Program library on this PC (IndexedDB; falls back to localStorage if IndexedDB is not available).
"use strict";
window.PM = window.PM || {};
PM.library = (() => {
  const DB = "photomeasure", STORE = "programs", LKEY = "pm.library";
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: "id" });
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  const tx = async (mode, fn) => {
    const db = await open();
    if (!db) return null;
    return new Promise((res, rej) => { const t = db.transaction(STORE, mode), st = t.objectStore(STORE), r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  };
  const ls = () => { try { return JSON.parse(localStorage.getItem(LKEY) || "{}"); } catch (e) { return {}; } };

  /** List of {id, name, partNo, modified, by, elements, dims} (no images). */
  async function list() {
    const db = await open();
    let all;
    if (db) all = await tx("readonly", st => st.getAll());
    else all = Object.values(ls());
    return (all || []).map(r => ({ id: r.id, name: r.name, partNo: r.partNo, modified: r.modified, by: r.by, version: r.version, elements: r.elements, dims: r.dims }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  async function get(id) {
    const db = await open();
    if (db) return (await tx("readonly", st => st.get(id))) || null;
    return ls()[id] || null;
  }
  /** Save a program (template object). Returns the stored record. */
  async function put(t, by) {
    const old = t.id ? await get(t.id) : null;
    const rec = {
      id: t.id, name: t.name || "part", partNo: t.partNo || "", modified: new Date().toISOString(), by: by || "",
      version: (old?.version || 0) + 1, elements: t.elements.filter(e => e.tool !== "ref").length, dims: t.dims.length,
      data: JSON.parse(JSON.stringify(t)),
    };
    rec.data.libVersion = rec.version;
    const db = await open();
    if (db) await tx("readwrite", st => st.put(rec));
    else { const all = ls(); all[rec.id] = rec; localStorage.setItem(LKEY, JSON.stringify(all)); }
    return rec;
  }
  async function del(id) {
    const db = await open();
    if (db) await tx("readwrite", st => st.delete(id));
    else { const all = ls(); delete all[id]; localStorage.setItem(LKEY, JSON.stringify(all)); }
  }
  /** Stores a complete library record as it is (used by backup import). */
  async function putRecord(rec) {
    if (!rec || !rec.id || !rec.data) throw new Error("not a program record");
    const db = await open();
    if (db) await tx("readwrite", st => st.put(rec));
    else { const all = ls(); all[rec.id] = rec; localStorage.setItem(LKEY, JSON.stringify(all)); }
  }
  return { list, get, put, del, putRecord };
})();
