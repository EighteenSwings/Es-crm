/* Eighteen Swings CRM
 * Works offline: every change is saved on this device first.
 * Google Drive holds the master copy (one JSON file in a Drive folder).
 * Sync merges record by record: the most recently edited version of each booking wins,
 * and deletions are remembered so a deleted client doesn't come back from another device.
 */
"use strict";

/* ---------- pure logic (also used by tests) ---------- */
const STAGES = [
  { id: "new", label: "New enquiry" },
  { id: "quoted", label: "Quoted" },
  { id: "booked", label: "Booked" },
  { id: "paid", label: "Paid in full" },
  { id: "done", label: "Completed" },
  { id: "lost", label: "Lost" }
];
const WON = ["booked", "paid", "done"];
const DEFAULT_CONFIG = {
  packages: [
    { id: "front9", name: "The Front Nine", hours: 2.5, price: 695, blurb: "Groom's morning or drinks reception. Up to about 50 players." },
    { id: "full18", name: "The Full Eighteen", hours: 5, price: 1095, blurb: "Morning and reception, or a half-day corporate do. Up to about 100 players." },
    { id: "nineteenth", name: "The Nineteenth Hole", hours: 8, price: 1395, blurb: "All-day hire for big weddings, golf days and corporate events." }
  ],
  extraHour: 125, freeMiles: 40, perMile: 0.6, depositPct: 25,
  updated: "1970-01-01T00:00:00.000Z"
};

function newer(a, b) { return String(a || "") >= String(b || ""); }

/** Merge two data sets. Each booking: latest `updated` wins. Tombstones in `deleted` beat older edits. */
function mergeData(a, b) {
  a = a || {}; b = b || {};
  const deleted = Object.assign({}, a.deleted || {});
  for (const [id, t] of Object.entries(b.deleted || {})) if (!deleted[id] || deleted[id] < t) deleted[id] = t;
  const bookings = {};
  const ids = new Set([...Object.keys(a.bookings || {}), ...Object.keys(b.bookings || {})]);
  for (const id of ids) {
    const x = (a.bookings || {})[id], y = (b.bookings || {})[id];
    const w = !x ? y : !y ? x : (newer(x.updated, y.updated) ? x : y);
    const del = deleted[id];
    if (del && !newer(w.updated, del)) continue;      // deleted after last edit: stays deleted
    if (del) delete deleted[id];                       // edited after deletion: keep it
    bookings[id] = w;
  }
  const ca = a.config, cb = b.config;
  const config = !ca ? cb : !cb ? ca : (newer(ca.updated, cb.updated) ? ca : cb);
  return { bookings, deleted, config: config || DEFAULT_CONFIG };
}

function calcQuote(b, config) {
  const pk = (config.packages || []).find(x => x.id === b.package) || (config.packages || [])[0] || { price: 0, name: "", hours: 0 };
  const extra = (+b.extraHours || 0) * (+config.extraHour || 0);
  const travelMiles = Math.max(0, (+b.miles || 0) - (+config.freeMiles || 0));
  const travel = Math.round(travelMiles * (+config.perMile || 0) * 2);
  const calcTotal = (+pk.price || 0) + extra + travel;
  const hasOverride = b.override !== "" && b.override != null && !isNaN(+b.override);
  const total = hasOverride ? +b.override : calcTotal;
  return { pkg: pk, extra, travel, travelMiles, calcTotal, total, deposit: Math.round(total * (+config.depositPct || 0) / 100) };
}

function toCSV(bookings, config) {
  const cols = ["Name", "Partner/company", "Email", "Phone", "Stage", "Event date", "Start time", "Event type", "Venue", "Postcode", "Guests",
    "Package", "Extra hours", "Miles", "Quote (£)", "Deposit (£)", "Contract signed", "Deposit paid", "Balance paid", "Review asked",
    "Source", "Last contact", "Created", "Reason lost", "Notes", "Last edited", "ID"];
  const stageName = id => (STAGES.find(s => s.id === id) || {}).label || id;
  const q = v => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const yn = v => v ? "Yes" : "No";
  const rows = Object.values(bookings).sort((x, y) => String(x.date || "9999").localeCompare(String(y.date || "9999"))).map(b => {
    const c = calcQuote(b, config);
    return [b.name, b.partner, b.email, b.phone, stageName(b.stage), b.date, b.time, b.type, b.venue, b.postcode, b.guests,
      c.pkg.name, b.extraHours, b.miles, c.total, c.deposit, yn(b.contract), yn(b.deposit), yn(b.balance), yn(b.review),
      b.source, b.lastContact, b.created, b.lost, b.notes, b.updated, b.id].map(q).join(",");
  });
  return [cols.map(q).join(","), ...rows].join("\r\n");
}

if (typeof module !== "undefined") module.exports = { mergeData, calcQuote, toCSV, DEFAULT_CONFIG };

/* ---------- app ---------- */
if (typeof document !== "undefined") (function () {
  const CFG = Object.assign({ googleClientId: "", driveFolderName: "Eighteen Swings CRM", driveFileName: "eighteen-swings-crm.json", sheetName: "Eighteen Swings CRM - Bookings export" }, window.ES_CONFIG || {});
  const LS_KEY = "es-crm-data-v1", LS_META = "es-crm-meta-v1";
  const SCOPE = "https://www.googleapis.com/auth/drive";
  const $ = id => document.getElementById(id);
  const gbp = n => "£" + Math.round(n || 0).toLocaleString("en-GB");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nowISO = () => new Date().toISOString();
  const isoToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysSince = s => s ? Math.floor((midnight() - new Date(s + "T00:00:00")) / 864e5) : null;
  const daysUntil = s => s ? Math.round((new Date(s + "T00:00:00") - midnight()) / 864e5) : null;
  const fmtDate = s => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Date TBC";
  const ago = iso => { if (!iso) return "never"; const m = Math.round((Date.now() - new Date(iso)) / 6e4); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  /* ----- local storage ----- */
  let data = { bookings: {}, deleted: {}, config: DEFAULT_CONFIG };
  let meta = { lastSync: null, dirty: false, fileId: null, folderId: null, sheetId: null, account: "" };
  try { const d = JSON.parse(localStorage.getItem(LS_KEY) || "null"); if (d) data = mergeData(d, {}); } catch (e) { }
  try { const m = JSON.parse(localStorage.getItem(LS_META) || "null"); if (m) meta = Object.assign(meta, m); } catch (e) { }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); localStorage.setItem(LS_META, JSON.stringify(meta)); }
    catch (e) { toast("This device is out of storage space. Sync to Drive and clear old data."); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

  function changed() { meta.dirty = true; persist(); render(); scheduleSync(); }

  /* ----- UI helpers ----- */
  let view = "pipeline", editing = null, query = "";
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }
  function notice(html, cls) { const n = $("notice"); if (!html) { n.hidden = true; return; } n.className = "notice " + (cls || ""); n.innerHTML = html; n.hidden = false; }
  const list = () => Object.values(data.bookings);
  const calc = b => calcQuote(b, data.config);

  function flags(b) {
    const f = [];
    if (b.stage === "new") { const d = daysSince(b.created); if (d !== null && d >= 1) f.push("Reply"); }
    if (b.stage === "quoted") { const d = daysSince(b.lastContact || b.created); if (d !== null && d >= 4) f.push("Chase · " + d + "d"); }
    if (b.stage === "booked") {
      if (!b.contract) f.push("No contract");
      if (!b.deposit) f.push("No deposit");
      const u = daysUntil(b.date); if (!b.balance && u !== null && u <= 30 && u >= 0) f.push("Balance due");
    }
    if (b.stage === "done" && !b.review) f.push("Ask review");
    return f;
  }
  function matches(b) {
    if (!query) return true;
    return [b.name, b.partner, b.venue, b.postcode, b.email, b.phone, b.type].join(" ").toLowerCase().includes(query);
  }

  /* ----- sync status ----- */
  let syncState = "idle", syncMsg = "";
  function setSync(state, msg) { syncState = state; syncMsg = msg || ""; renderSyncPill(); if (view === "settings") renderSettings(); }
  function renderSyncPill() {
    const p = $("syncPill"), t = $("syncText");
    p.className = "sync-pill";
    if (!CFG.googleClientId) { t.textContent = "Saved on this device"; return; }
    if (syncState === "busy") { p.classList.add("busy"); t.textContent = "Syncing…"; return; }
    if (syncState === "error") { p.classList.add("err"); t.textContent = "Sync failed · tap to retry"; return; }
    if (!navigator.onLine) { p.classList.add("pending"); t.textContent = meta.dirty ? "Offline · saved on device" : "Offline"; return; }
    if (!meta.lastSync) { p.classList.add("pending"); t.textContent = "Tap to connect Drive"; return; }
    if (meta.dirty) { p.classList.add("pending"); t.textContent = "Changes to sync"; return; }
    p.classList.add("ok"); t.textContent = "Synced " + ago(meta.lastSync);
  }
  setInterval(renderSyncPill, 60000);

  /* ----- render ----- */
  function renderStats() {
    const all = list();
    $("sOpen").textContent = all.filter(b => b.stage === "new" || b.stage === "quoted").length;
    $("sPipe").textContent = gbp(all.filter(b => b.stage === "quoted").reduce((s, b) => s + calc(b).total, 0));
    $("sBooked").textContent = gbp(all.filter(b => WON.includes(b.stage)).reduce((s, b) => s + calc(b).total, 0));
    const won = all.filter(b => WON.includes(b.stage)).length, lost = all.filter(b => b.stage === "lost").length;
    $("sConv").textContent = (won + lost) ? Math.round(won / (won + lost) * 100) + "%" : "–";
  }
  function cardHTML(b) {
    const c = calc(b), f = flags(b);
    const chips = [`<span class="chip">${esc(b.type || "Event")}</span>`].concat(f.map(x => `<span class="chip flag">${esc(x)}</span>`));
    return `<button type="button" class="card${f.length ? " needs" : ""}" data-id="${esc(b.id)}">
      <div class="top"><span class="who">${esc(b.name || "Unnamed")}${b.partner ? " &amp; " + esc(b.partner) : ""}</span><span class="amt">${gbp(c.total)}</span></div>
      <div class="meta">${esc(fmtDate(b.date))}${b.venue ? " · " + esc(b.venue) : ""}</div>
      <div class="chips">${chips.join("")}</div></button>`;
  }
  function renderPipeline() {
    const items = list().filter(matches);
    const empty = !list().length;
    $("cols").innerHTML = STAGES.map((s, i) => {
      const col = items.filter(b => b.stage === s.id).sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
      const val = col.reduce((t, b) => t + calc(b).total, 0);
      const emptyText = s.id === "new" && empty ? "No enquiries yet. Tap “+ New enquiry” to add the first one." : "Nothing here";
      return `<div class="col"><div class="colhead">${s.id === "lost" ? "" : `<span class="hole">${i + 1}</span>`}<h3>${s.label}</h3><span class="count">${col.length}</span>${col.length ? `<span class="val">${gbp(val)}</span>` : ""}</div>
        ${col.length ? col.map(cardHTML).join("") : `<div class="empty-col">${emptyText}</div>`}</div>`;
    }).join("");
  }
  function renderUpcoming() {
    const items = list().filter(b => ["booked", "paid"].includes(b.stage) && matches(b)).sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
    const el = $("view-upcoming");
    if (!items.length) { el.innerHTML = `<div class="notice">Booked events show here in date order, with what's still outstanding for each one.</div>`; return; }
    el.innerHTML = `<div class="list">${items.map(b => {
      const d = b.date ? new Date(b.date + "T00:00:00") : null, u = daysUntil(b.date), c = calc(b);
      const t = (on, l) => `<span class="tick ${on ? "on" : "off"}">${on ? "✓ " : ""}${l}</span>`;
      return `<button type="button" class="row" data-id="${esc(b.id)}">
        <div class="date">${d ? `<b>${d.getDate()}</b><span>${d.toLocaleDateString("en-GB", { month: "short" })} ${String(d.getFullYear()).slice(2)}</span>` : `<b>?</b><span>TBC</span>`}</div>
        <div style="min-width:0"><div class="who">${esc(b.name)}${b.partner ? " &amp; " + esc(b.partner) : ""}</div>
        <div class="meta">${esc(c.pkg.name || "")} · ${gbp(c.total)}${b.venue ? " · " + esc(b.venue) : ""}${u !== null ? ` · <span class="num">${u < 0 ? "past" : u === 0 ? "today" : "in " + u + "d"}</span>` : ""}</div></div>
        <div class="checks">${t(b.contract, "Contract")}${t(b.deposit, "Deposit")}${t(b.balance, "Balance")}</div></button>`;
    }).join("")}</div>`;
  }
  function renderPackages() {
    const cfg = data.config;
    $("view-packages").innerHTML = `<div class="stack">
      <div class="section-h"><h2>Packages</h2><p>Starter prices sit just above the UK hosted-simulator market. Edit them here and every quote updates.</p></div>
      <div class="pk-grid">${cfg.packages.map((p, i) => `<div class="pk">
        <span class="tag">Package ${i + 1}</span>
        <label class="f">Name<input id="pk-name-${i}" value="${esc(p.name)}"></label>
        <div class="grid2"><label class="f">Hours<input id="pk-hours-${i}" type="number" step="0.5" min="0" value="${esc(p.hours)}"></label>
        <label class="f">Price (£)<input id="pk-price-${i}" type="number" min="0" value="${esc(p.price)}"></label></div>
        <label class="f">Description<textarea id="pk-blurb-${i}">${esc(p.blurb)}</textarea></label></div>`).join("")}</div>
      <div class="section-h"><h2>Pricing rules</h2><p>Travel is charged both ways for miles beyond the free radius.</p></div>
      <div class="rules">
        <label class="f">Extra hour (£)<input id="r-extra" type="number" min="0" value="${esc(cfg.extraHour)}"></label>
        <label class="f">Free radius (miles)<input id="r-free" type="number" min="0" value="${esc(cfg.freeMiles)}"></label>
        <label class="f">Per mile (£)<input id="r-mile" type="number" min="0" step="0.05" value="${esc(cfg.perMile)}"></label>
        <label class="f">Deposit (%)<input id="r-dep" type="number" min="0" max="100" value="${esc(cfg.depositPct)}"></label>
      </div>
      <div><button class="btn primary" type="button" id="savePk">Save packages</button></div></div>`;
    $("savePk").onclick = () => {
      data.config = {
        packages: cfg.packages.map((p, i) => ({ id: p.id, name: $("pk-name-" + i).value.trim() || p.name, hours: +$("pk-hours-" + i).value || 0, price: +$("pk-price-" + i).value || 0, blurb: $("pk-blurb-" + i).value.trim() })),
        extraHour: +$("r-extra").value || 0, freeMiles: +$("r-free").value || 0, perMile: +$("r-mile").value || 0, depositPct: +$("r-dep").value || 0,
        updated: nowISO()
      };
      changed(); toast("Packages saved");
    };
  }
  function renderSettings() {
    const el = $("view-settings");
    const configured = !!CFG.googleClientId;
    const folderLink = meta.folderId ? `<a href="https://drive.google.com/drive/folders/${encodeURIComponent(meta.folderId)}" target="_blank" rel="noopener">Open folder in Drive</a>` : "Created on first sync";
    const sheetLink = meta.sheetId ? `<a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(meta.sheetId)}" target="_blank" rel="noopener">Open Sheet</a>` : "Not exported yet";
    el.innerHTML = `<div class="stack">
      <div class="panel-grid">
        <div class="panel">
          <h3>Google Drive</h3>
          ${configured ? `<p>Drive holds the master copy. Changes save on this device straight away and sync when you're online.</p>
          <dl class="kv"><dt>Status</dt><dd>${esc(syncState === "error" ? "Last sync failed: " + syncMsg : !meta.lastSync ? "Not connected yet" : meta.dirty ? "Changes waiting to sync" : "Up to date")}</dd>
          <dt>Last sync</dt><dd>${esc(ago(meta.lastSync))}</dd>
          ${meta.account ? `<dt>Account</dt><dd>${esc(meta.account)}</dd>` : ""}
          <dt>Folder</dt><dd>${folderLink}</dd>
          <dt>Spreadsheet</dt><dd>${sheetLink}</dd></dl>
          <div class="btn-row"><button class="btn primary" type="button" id="syncNow">${meta.lastSync ? "Sync now" : "Connect Google Drive"}</button>
          <button class="btn" type="button" id="exportSheet"${meta.lastSync ? "" : " disabled"}>Update Google Sheet</button>
          ${meta.lastSync ? `<button class="btn ghost" type="button" id="disconnect">Disconnect</button>` : ""}</div>`
        : `<p>Drive sync isn't set up yet. Add your Google Client ID to <b>config.js</b> (see SETUP.md, step 2). Until then everything is saved on this device only.</p>`}
        </div>
        <div class="panel">
          <h3>Backups &amp; moving Drives</h3>
          <p>Download a full backup file, or import one to merge it in. Use this when Eighteen Swings moves to its own Google account.</p>
          <div class="btn-row"><button class="btn" type="button" id="dlBackup">Download backup</button>
          <label class="btn" for="importFile">Import backup</label><input type="file" id="importFile" accept="application/json,.json" hidden></div>
          <dl class="kv"><dt>Bookings</dt><dd class="num">${list().length}</dd><dt>On this device</dt><dd>${esc(Math.round(JSON.stringify(data).length / 1024))} KB</dd></dl>
        </div>
        <div class="panel">
          <h3>This device</h3>
          <p>Lost your phone or handing it on? Sync first, then clear this device. Your Drive copy stays safe.</p>
          <div class="btn-row"><button class="btn danger" type="button" id="wipe">Clear data on this device</button></div>
        </div>
        <div class="panel">
          <h3>Install on your phone</h3>
          <p>iPhone: open this page in Safari, tap Share, then “Add to Home Screen”. Android: open in Chrome, tap ⋮, then “Install app”. It then opens full screen and works offline.</p>
        </div>
      </div></div>`;
    if (configured) {
      $("syncNow").onclick = () => sync(true);
      $("exportSheet").onclick = () => exportSheet();
      if ($("disconnect")) $("disconnect").onclick = disconnect;
    }
    $("dlBackup").onclick = downloadBackup;
    $("importFile").onchange = importBackup;
    $("wipe").onclick = e => {
      const b = e.currentTarget;
      if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = meta.dirty ? "Unsynced changes will be lost. Tap again" : "Tap again to clear"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Clear data on this device"; }, 4000); return; }
      try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_META); } catch (err) { }
      data = { bookings: {}, deleted: {}, config: DEFAULT_CONFIG };
      meta = { lastSync: null, dirty: false, fileId: null, folderId: null, sheetId: null, account: "" };
      token = null; render(); renderSettings(); toast("Cleared from this device");
    };
  }
  function render() {
    renderStats();
    if (view === "pipeline") renderPipeline();
    if (view === "upcoming") renderUpcoming();
    renderSyncPill();
  }

  /* ----- tabs, search, cards ----- */
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    view = b.dataset.view;
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["pipeline", "upcoming", "packages", "settings"].forEach(v => $("view-" + v).hidden = v !== view);
    $("q").hidden = view === "packages" || view === "settings";
    if (view === "packages") renderPackages();
    if (view === "settings") renderSettings();
    render();
  });
  $("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
  document.addEventListener("click", e => { const c = e.target.closest(".card,.row"); if (c && c.dataset.id) openForm(data.bookings[c.dataset.id]); });
  $("syncPill").onclick = () => { if (!CFG.googleClientId) { document.querySelector('[data-view="settings"]').click(); return; } sync(true); };

  /* ----- form ----- */
  const F = ["name", "partner", "email", "phone", "source", "stage", "date", "type", "venue", "postcode", "guests", "time", "package", "extra", "miles", "override", "contact", "lost", "notes"];
  const KEY = { extra: "extraHours", contact: "lastContact" };
  $("f-stage").innerHTML = STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
  function fillPackages() { $("f-package").innerHTML = data.config.packages.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.hours}h · ${gbp(p.price)}</option>`).join(""); }
  function readForm() {
    const o = {}; F.forEach(k => o[KEY[k] || k] = $("f-" + k).value);
    o.guests = o.guests === "" ? "" : +o.guests; o.extraHours = +o.extraHours || 0; o.miles = +o.miles || 0; o.override = o.override === "" ? "" : +o.override;
    ["contract", "deposit", "balance", "review"].forEach(k => o[k] = $("f-" + k).checked);
    return o;
  }
  function updateQuote() {
    const b = readForm(), c = calc(b), cfg = data.config;
    $("quoteBox").innerHTML = `<div><span>${esc(c.pkg.name || "Package")}</span><span class="num">${gbp(c.pkg.price)}</span></div>
      ${c.extra ? `<div><span>Extra time (${b.extraHours}h × ${gbp(cfg.extraHour)})</span><span class="num">${gbp(c.extra)}</span></div>` : ""}
      ${c.travel ? `<div><span>Travel (${c.travelMiles} mi beyond ${cfg.freeMiles}, both ways)</span><span class="num">${gbp(c.travel)}</span></div>` : ""}
      ${b.override !== "" ? `<div><span>Calculator price</span><span class="num">${gbp(c.calcTotal)}</span></div>` : ""}
      <div class="total"><span>${b.override !== "" ? "Agreed price" : "Quote"}</span><span class="num">${gbp(c.total)}</span></div>
      <div><span>Deposit (${cfg.depositPct}%)</span><span class="num">${gbp(c.deposit)}</span></div>`;
    $("lostWrap").hidden = b.stage !== "lost";
  }
  $("form").addEventListener("input", updateQuote);
  $("form").addEventListener("change", updateQuote);
  function openForm(b) {
    editing = b || null; fillPackages();
    const d = b || { stage: "new", source: "Website", type: "Wedding: drinks reception", package: (data.config.packages[0] || {}).id, extraHours: 0, miles: 0, override: "", lastContact: isoToday() };
    F.forEach(k => { const v = d[KEY[k] || k]; $("f-" + k).value = v == null ? "" : v; });
    ["contract", "deposit", "balance", "review"].forEach(k => $("f-" + k).checked = !!d[k]);
    $("formTitle").textContent = b ? (b.name || "Enquiry") : "New enquiry";
    $("delBtn").hidden = !b; $("delBtn").classList.remove("armed"); $("delBtn").textContent = "Delete";
    updateQuote(); $("overlay").hidden = false; document.body.style.overflow = "hidden";
    if (!b) setTimeout(() => $("f-name").focus(), 60);
  }
  function closeForm() { $("overlay").hidden = true; document.body.style.overflow = ""; editing = null; }
  $("addBtn").onclick = () => openForm(null);
  $("closeBtn").onclick = closeForm; $("cancelBtn").onclick = closeForm;
  $("overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeForm(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("overlay").hidden) closeForm(); });
  $("form").addEventListener("submit", e => {
    e.preventDefault();
    const o = readForm();
    if (!o.name.trim()) { $("f-name").focus(); toast("Add a name first"); return; }
    if (o.stage === "paid") { o.deposit = true; o.balance = true; }
    o.quote = calc(o).total;
    o.id = editing ? editing.id : uid();
    o.created = editing ? (editing.created || isoToday()) : isoToday();
    o.updated = nowISO();
    data.bookings[o.id] = o;
    closeForm(); changed(); toast("Saved");
  });
  $("delBtn").onclick = () => {
    const b = $("delBtn");
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Tap again to delete"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Delete"; }, 3500); return; }
    delete data.bookings[editing.id]; data.deleted[editing.id] = nowISO();
    closeForm(); changed(); toast("Deleted");
  };

  /* ----- backups ----- */
  function payload() { return { app: "eighteen-swings-crm", version: 1, savedAt: nowISO(), bookings: data.bookings, deleted: data.deleted, config: data.config }; }
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "eighteen-swings-crm-backup-" + isoToday() + ".json";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importBackup(e) {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || d.app !== "eighteen-swings-crm" || typeof d.bookings !== "object") throw new Error("not a backup");
        const before = list().length;
        data = mergeData(data, d);
        changed(); renderSettings(); toast("Imported. " + (list().length - before) + " new bookings added");
      } catch (err) { toast("That file isn't an Eighteen Swings CRM backup"); }
      e.target.value = "";
    };
    r.readAsText(file);
  }

  /* ----- Google Drive ----- */
  let tokenClient = null, token = null, tokenExp = 0, syncing = false, syncTimer = null;
  function gisReady() {
    if (tokenClient) return true;
    if (!CFG.googleClientId || !(window.google && google.accounts && google.accounts.oauth2)) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CFG.googleClientId, scope: SCOPE, callback: () => { } });
    return true;
  }
  const tokenValid = () => token && Date.now() < tokenExp - 60000;
  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      if (tokenValid()) return resolve(token);
      if (!gisReady()) return reject(new Error("Google sign-in didn't load. Check you're online."));
      tokenClient.callback = r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; resolve(token);
      };
      tokenClient.error_callback = err => reject(new Error(err && err.type === "popup_closed" ? "Sign-in window was closed" : "Couldn't sign in to Google"));
      const opts = { prompt: interactive && !meta.lastSync ? "consent" : "" };
      if (meta.account) opts.login_hint = meta.account;
      tokenClient.requestAccessToken(opts);
    });
  }
  async function api(url, opts = {}) {
    const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: "Bearer " + token }, opts.headers || {}) }));
    if (res.status === 401) { token = null; throw new Error("Google sign-in expired. Tap sync to sign in again."); }
    if (!res.ok) { let m = res.status + ""; try { const j = await res.json(); m = (j.error && j.error.message) || m; } catch (e) { } const err = new Error(m); err.status = res.status; throw err; }
    return res;
  }
  const DRIVE = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const ALL = "supportsAllDrives=true&includeItemsFromAllDrives=true";
  const qs = s => encodeURIComponent(s);
  const qEsc = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  async function findFiles(q) {
    const r = await api(`${DRIVE}?q=${qs(q)}&fields=${qs("files(id,name,parents,modifiedTime)")}&orderBy=modifiedTime desc&pageSize=10&${ALL}`);
    return (await r.json()).files || [];
  }
  async function multipartCreate(metadata, body, mime) {
    const boundary = "es" + Math.random().toString(36).slice(2);
    const parts = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n${body}\r\n--${boundary}--`;
    const r = await api(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,parents`, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: parts });
    return r.json();
  }
  async function ensureFolder() {
    if (meta.folderId) return meta.folderId;
    const found = await findFiles(`name='${qEsc(CFG.driveFolderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (found.length) { meta.folderId = found[0].id; return meta.folderId; }
    const r = await api(`${DRIVE}?supportsAllDrives=true&fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: CFG.driveFolderName, mimeType: "application/vnd.google-apps.folder" }) });
    meta.folderId = (await r.json()).id; return meta.folderId;
  }
  async function ensureDataFile() {
    if (meta.fileId) {
      try { const r = await api(`${DRIVE}/${meta.fileId}?fields=id,trashed,parents&supportsAllDrives=true`); const f = await r.json(); if (!f.trashed) { if (f.parents && f.parents[0]) meta.folderId = f.parents[0]; return { id: f.id, isNew: false }; } }
      catch (e) { if (e.status !== 404) throw e; }
      meta.fileId = null;
    }
    const found = await findFiles(`name='${qEsc(CFG.driveFileName)}' and trashed=false`);
    if (found.length) { meta.fileId = found[0].id; if (found[0].parents) meta.folderId = found[0].parents[0]; return { id: meta.fileId, isNew: false }; }
    const folder = await ensureFolder();
    const f = await multipartCreate({ name: CFG.driveFileName, parents: [folder], mimeType: "application/json", description: "Eighteen Swings CRM data. Edited by the CRM app; don't edit by hand." }, JSON.stringify(payload()), "application/json");
    meta.fileId = f.id; return { id: f.id, isNew: true };
  }
  async function sync(interactive) {
    if (!CFG.googleClientId) return;
    if (syncing) return;
    if (!navigator.onLine) { setSync("idle"); if (interactive) toast("You're offline. Changes are saved on this device."); return; }
    try { await getToken(!!interactive); }
    catch (e) { setSync(interactive ? "error" : "idle", e.message); if (interactive) toast(e.message); return; }
    syncing = true; setSync("busy");
    try {
      if (!meta.account) {
        try { const r = await api("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)"); meta.account = ((await r.json()).user || {}).emailAddress || ""; } catch (e) { }
      }
      const file = await ensureDataFile();
      let remote = {};
      if (!file.isNew) {
        const r = await api(`${DRIVE}/${file.id}?alt=media&supportsAllDrives=true`);
        const txt = await r.text();
        try { remote = txt ? JSON.parse(txt) : {}; } catch (e) { throw new Error("The Drive data file is damaged. Restore it from Drive's version history."); }
      }
      data = mergeData(data, remote);
      await api(`${UPLOAD}/${file.id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      meta.lastSync = nowISO(); meta.dirty = false; persist();
      syncing = false; setSync("ok"); render();
      if (view === "packages" && !document.activeElement?.id?.match(/^(pk|r)-/)) renderPackages();
      if (interactive) toast("Synced with Google Drive");
    } catch (e) {
      syncing = false; setSync("error", e.message); if (interactive) toast("Sync failed: " + e.message);
    }
  }
  function scheduleSync() {
    clearTimeout(syncTimer);
    if (!CFG.googleClientId || !navigator.onLine || !tokenValid()) { renderSyncPill(); return; }
    syncTimer = setTimeout(() => sync(false), 2500);
  }
  async function exportSheet() {
    try {
      await getToken(true);
      const folder = meta.folderId || await ensureFolder();
      const csv = toCSV(data.bookings, data.config);
      if (meta.sheetId) {
        try { await api(`${UPLOAD}/${meta.sheetId}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "text/csv; charset=UTF-8" }, body: csv }); persist(); renderSettings(); toast("Google Sheet updated"); return; }
        catch (e) { if (e.status !== 404 && e.status !== 403) throw e; meta.sheetId = null; }
      }
      const f = await multipartCreate({ name: CFG.sheetName, parents: [folder], mimeType: "application/vnd.google-apps.spreadsheet" }, csv, "text/csv; charset=UTF-8");
      meta.sheetId = f.id; persist(); renderSettings(); toast("Google Sheet created in your Drive folder");
    } catch (e) { toast("Couldn't update the Sheet: " + e.message); }
  }
  function disconnect() {
    if (token && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(token, () => { }); } catch (e) { } }
    token = null; meta.lastSync = null; meta.account = ""; persist(); setSync("idle"); renderSettings(); toast("Disconnected. Data stays on this device and in Drive.");
  }

  window.addEventListener("online", () => { renderSyncPill(); if (meta.dirty) scheduleSync(); });
  window.addEventListener("offline", renderSyncPill);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && tokenValid()) sync(false); });

  /* ----- start ----- */
  render();
  if (!CFG.googleClientId) notice(`Drive sync isn't switched on yet, so bookings are saved on this device only. Follow SETUP.md to connect GBI Mitchell's Google Drive.`, "flag");
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { });
})();
