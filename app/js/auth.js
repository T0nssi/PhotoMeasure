// Users and roles (admin / operator) stored on this PC. Passwords are salted SHA-256 hashes.
// Note: this is a browser-only program; it keeps honest users in their role but is not a
// protection against someone with access to the PC's browser developer tools.
"use strict";
window.PM = window.PM || {};
PM.auth = (() => {
  const KEY = "pm.users", SKEY = "pm.session";
  const ROLES = { admin: "Admin", operator: "Operator" };

  // ---- SHA-256 (crypto.subtle when available, small JS fallback otherwise) ----
  async function sha256hex(text) {
    const data = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle) {
      try { const h = await crypto.subtle.digest("SHA-256", data); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); } catch (e) { /* fall through */ }
    }
    return sha256js(data);
  }
  function sha256js(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb);
    m.set(bytes); m[l] = 0x80;
    const bits = l * 8; for (let i = 0; i < 8; i++) m[nb - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
    const W = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
    }
    return H.map(v => v.toString(16).padStart(8, "0")).join("");
  }
  const salt = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");

  // ---- storage ----
  function users() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
  const find = name => users().find(u => u.name.toLowerCase() === String(name).trim().toLowerCase());

  async function add(name, role, password) {
    name = String(name || "").trim();
    if (!name) throw new Error("enter a user name");
    if (!ROLES[role]) throw new Error("unknown role");
    if (String(password || "").length < 4) throw new Error("password must have at least 4 characters");
    if (find(name)) throw new Error(`user "${name}" already exists`);
    const s = salt(), list = users();
    list.push({ name, role, salt: s, hash: await sha256hex(s + ":" + password), created: new Date().toISOString() });
    save(list);
  }
  async function setPassword(name, password) {
    if (String(password || "").length < 4) throw new Error("password must have at least 4 characters");
    const list = users(), u = list.find(x => x.name === name); if (!u) throw new Error("no such user");
    u.salt = salt(); u.hash = await sha256hex(u.salt + ":" + password); save(list);
  }
  function setRole(name, role) {
    const list = users(), u = list.find(x => x.name === name); if (!u) return;
    if (u.role === "admin" && role !== "admin" && list.filter(x => x.role === "admin").length < 2) throw new Error("keep at least one admin");
    u.role = role; save(list);
  }
  function remove(name) {
    const list = users(), u = list.find(x => x.name === name); if (!u) return;
    if (u.role === "admin" && list.filter(x => x.role === "admin").length < 2) throw new Error("keep at least one admin");
    save(list.filter(x => x !== u));
  }
  async function login(name, password) {
    const u = find(name);
    if (!u || (await sha256hex(u.salt + ":" + password)) !== u.hash) throw new Error("wrong user name or password");
    const ses = { name: u.name, role: u.role, at: new Date().toISOString() };
    sessionStorage.setItem(SKEY, JSON.stringify(ses));
    return ses;
  }
  function logout() { sessionStorage.removeItem(SKEY); }
  function current() {
    try { const s = JSON.parse(sessionStorage.getItem(SKEY) || "null"); if (!s) return null; const u = find(s.name); return u ? { name: u.name, role: u.role } : null; } catch (e) { return null; }
  }
  /** Adds users from a backup (with their password hashes); existing names are kept. Returns the number added. */
  function importUsers(list) {
    const cur = users(); let n = 0;
    for (const u of list || []) {
      if (!u || !u.name || !u.hash || !u.salt || !ROLES[u.role]) continue;
      if (cur.some(x => x.name.toLowerCase() === u.name.toLowerCase())) continue;
      cur.push({ name: u.name, role: u.role, salt: u.salt, hash: u.hash, created: u.created || new Date().toISOString() }); n++;
    }
    save(cur); return n;
  }
  return { ROLES, users, add, importUsers, setPassword, setRole, remove, login, logout, current, sha256hex, sha256js };
})();
