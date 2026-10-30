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
const LOCKED = ["booked", "paid", "done"];   // stages that hold the date

const DEFAULT_BUSINESS = {
  name: "Eighteen Swings", email: "info@eighteenswings.co.uk", phone: "", website: "eighteenswings.co.uk",
  signoff: "Bri", quoteValidDays: 30, balanceDays: 30, basePostcode: "GL19 4HW",
  legalName: "", companyNo: "", address: "", bankName: "", accountName: "", sortCode: "", accountNo: "",
  included: "A private, fully enclosed and weatherproof golf bay with a big-screen simulator, set-up and pack-down, and someone on hand throughout. All we need is a flat area and a standard plug socket nearby.",
  paymentNote: "A deposit secures your date. The balance is due before the event; we'll send a reminder with payment details."
};
const DEFAULT_TEMPLATES = [
  { id: "reply", name: "Enquiry reply", subject: "Your Eighteen Swings enquiry",
    body: `Hi {first},

Thanks so much for getting in touch about {eventLine}. We'd love to bring Eighteen Swings along.

To put a quote together, could you let me know:
- the venue and roughly where the bay could go (we need a flat area and a standard plug socket nearby)
- the timings you have in mind
- roughly how many guests

The short version of what we do: a private, fully enclosed, weatherproof golf bay, so everyone gets a go whatever the weather. You don't need to be good. You just need a go, a crowd and a bit of luck.

Speak soon,
{signoff}
{business} · {website}` },
  { id: "quote", name: "Quote", subject: "Your Eighteen Swings quote · {date}", stageTo: "quoted",
    body: `Hi {first},

Lovely to hear more about {eventLine}. Here's your quote:

{package} ({hours} hours): {total}

A {depositPct}% deposit of {deposit} secures the date, with the balance of {balance} due by {balanceDue}. This quote is held until {validUntil}.

I've attached a PDF copy. If you'd like to go ahead, just reply and I'll send the booking form and deposit details.

Thanks,
{signoff}
{business} · {website}` },
  { id: "confirmed", name: "Booking confirmed", subject: "You're booked in · {date}",
    body: `Hi {first},

Thank you, your deposit has landed and {date} is officially yours.

Here's where we are:
- Package: {package} ({hours} hours)
- Total: {total}
- Paid so far: {deposit}
- Balance: {balance}, due by {balanceDue}

I'll be in touch nearer the time to confirm timings and where the bay will go.

Cheers,
{signoff}
{business} · {website}` },
  { id: "balance", name: "Balance reminder", subject: "Balance reminder · {date}",
    body: `Hi {first},

A quick reminder that the balance of {balance} for {eventLine} is due by {balanceDue}.

{paymentNote}

Any questions, just reply here.

Thanks,
{signoff}
{business} · {website}` },
  { id: "final", name: "Final details", subject: "Final details for {date}",
    body: `Hi {first},

Not long now! A few quick checks so the day runs smoothly:
- Start time: {time}
- Venue: {venue}
- Where the bay will go: we need a flat area and a standard plug socket within reach
- Anyone at the venue I should liaise with on the day?

We'll arrive in plenty of time to set up before guests are around.

See you soon,
{signoff}
{business} · {website}` },
  { id: "review", name: "Thank you & review", subject: "Thank you from Eighteen Swings",
    body: `Hi {first},

Thank you for having us at {eventLine}. We hope everyone enjoyed their swings, good and bad.

If you have a minute, a short review would mean a lot to a small business like ours. And if you've got any photos or videos of guests in the bay, we'd love to see them (and, with your permission, share a couple).

Congratulations again,
{signoff}
{business} · {website}` }
];

const DEFAULT_CONFIG = {
  packages: [
    { id: "front9", name: "The Front Nine", hours: 2.5, price: 695, blurb: "Groom's morning or drinks reception. Up to about 50 players." },
    { id: "full18", name: "The Full Eighteen", hours: 5, price: 1095, blurb: "Morning and reception, or a half-day corporate do. Up to about 100 players." },
    { id: "nineteenth", name: "The Nineteenth Hole", hours: 8, price: 1395, blurb: "All-day hire for big weddings, golf days and corporate events." }
  ],
  extraHour: 125, freeMiles: 40, perMile: 0.6, depositPct: 25,
  business: DEFAULT_BUSINESS, templates: DEFAULT_TEMPLATES, enquirySheet: "",
  updated: "1970-01-01T00:00:00.000Z"
};
const biz = config => Object.assign({}, DEFAULT_BUSINESS, (config && config.business) || {});
const templatesOf = config => (config && config.templates && config.templates.length) ? config.templates : DEFAULT_TEMPLATES;

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
  const deposit = Math.round(total * (+config.depositPct || 0) / 100);
  return { pkg: pk, extra, travel, travelMiles, calcTotal, total, deposit, balance: total - deposit, hours: (+pk.hours || 0) + (+b.extraHours || 0) };
}

/* dates are plain "YYYY-MM-DD" strings, handled in local time */
function addDays(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function balanceDueDate(b, config) { return b.date ? addDays(b.date, -(+biz(config).balanceDays || 0)) : ""; }
function longDate(iso) { return iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "date to be confirmed"; }
function shortDate(iso) { return iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "date TBC"; }
function quoteRef(b) { const d = String(b.created || "").replace(/-/g, "").slice(2, 8) || "000000"; return "ES-" + d + "-" + String(b.id || "DRAFT").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase(); }
function firstName(b) { return String(b.name || "").trim().split(/\s+/)[0] || "there"; }

/** Fill an email template's {tokens} for one booking. Unknown tokens are left as they are. */
function fillTemplate(text, b, config, today) {
  const c = calcQuote(b, config), B = biz(config), gbp = n => "£" + Math.round(n || 0).toLocaleString("en-GB");
  const kind = /wedding/i.test(b.type || "") ? "your wedding" : /corporate/i.test(b.type || "") ? "your event" : "your event";
  const eventLine = (b.date ? kind + " on " + longDate(b.date) : kind) + (b.venue ? " at " + b.venue : "");
  const t = {
    first: firstName(b), name: b.name || "", names: [b.name, b.partner].filter(Boolean).join(" & "),
    date: shortDate(b.date), longDate: longDate(b.date), venue: b.venue || "the venue", time: b.time || "to be confirmed",
    eventType: b.type || "event", eventLine, guests: b.guests || "",
    package: c.pkg.name || "", hours: String(c.hours), total: gbp(c.total), deposit: gbp(c.deposit), balance: gbp(c.balance),
    depositPct: String(config.depositPct || 0), balanceDue: shortDate(balanceDueDate(b, config)),
    validUntil: shortDate(addDays(today || b.lastContact || b.created || "2026-01-01", +B.quoteValidDays || 30)),
    quoteRef: quoteRef(b), business: B.name, email: B.email, phone: B.phone, website: B.website, signoff: B.signoff, paymentNote: B.paymentNote
  };
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => (k in t ? t[k] : m));
}

/** Other bookings on the same date. `hard` = ones that already hold the date. */
function clashesFor(b, all) {
  if (!b.date) return { hard: [], soft: [] };
  const same = all.filter(x => x.id !== b.id && x.date === b.date && x.stage !== "lost");
  return { hard: same.filter(x => LOCKED.includes(x.stage)), soft: same.filter(x => !LOCKED.includes(x.stage)) };
}

/* ----- website enquiries (Squarespace form -> Google Sheet) ----- */
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}
function hashStr(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
/** Squarespace's date field is month/day/year; anything clearly day-first is read that way. */
function parseLooseDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let mo = a, d = b; if (a > 12 && b <= 12) { d = a; mo = b; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/gi, "$1"));
  if (!isNaN(t)) { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  return "";
}
function guessType(s) {
  s = String(s || "").toLowerCase();
  if (/morning/.test(s) && /(reception|drinks|afternoon)/.test(s)) return "Wedding: morning + reception";
  if (/morning|groom|getting ready/.test(s)) return "Wedding: morning";
  if (/reception|drinks/.test(s)) return "Wedding: drinks reception";
  if (/corporate|work|company|office|team|golf day/.test(s)) return "Corporate";
  if (/birthday|party|private|stag|celebration|anniversary/.test(s)) return "Private party";
  return "";
}
/** Turn the form Sheet's rows into new-enquiry bookings. Each row gets a stable id so it is only ever imported once. */
function rowsToEnquiries(rows, today) {
  if (!rows || rows.length < 2) return [];
  const head = rows[0].map(h => String(h || "").trim());
  const role = head.map(h => {
    const l = h.toLowerCase();
    if (/submitted|timestamp|submission/.test(l)) return "submitted";
    if (/first\s*name|forename/.test(l)) return "first";
    if (/last\s*name|surname|family name/.test(l)) return "last";
    if (/e-?mail/.test(l)) return "email";
    if (/phone|mobile|tel\b|telephone|number to call/.test(l)) return "phone";
    if (/partner|fianc|company|organi[sz]ation|business name/.test(l)) return "partner";
    if (/post\s*code|zip/.test(l)) return "postcode";
    if (/date/.test(l)) return "date";
    if (/time|timing/.test(l)) return "time";
    if (/venue|location|where/.test(l)) return "venue";
    if (/guest|how many|number of|people|headcount/.test(l)) return "guests";
    if (/hear|find us|referr|source/.test(l)) return "heard";
    if (/type|occasion|event|package|interested/.test(l)) return "type";
    if (/message|detail|anything|tell us|note|question|comment/.test(l)) return "message";
    if (/name/.test(l)) return "name";
    return "";
  });
  const out = [];
  for (const r of rows.slice(1)) {
    const v = {}, extra = [];
    head.forEach((h, i) => {
      const val = String(r[i] == null ? "" : r[i]).trim(); if (!val) return;
      const k = role[i];
      if (k && !(k in v)) v[k] = val; else extra.push(h + ": " + val);
    });
    const name = v.name || [v.first, v.last].filter(Boolean).join(" ");
    if (!name && !v.email && !v.phone) continue;
    const key = [v.submitted || "", (v.email || "").toLowerCase(), name.toLowerCase(), v.date || "", v.message || ""].join("|");
    const date = parseLooseDate(v.date);
    const type = guessType(v.type);
    const notes = ["Website enquiry" + (v.submitted ? " (" + v.submitted + ")" : "")];
    if (v.message) notes.push(v.message);
    if (v.type) notes.push("Event: " + v.type);
    if (v.date && !date) notes.push("Date as entered: " + v.date);
    else if (v.date && date) notes.push("Date as entered: " + v.date + " (check it's read the right way round)");
    if (v.heard) notes.push("Heard about us: " + v.heard);
    notes.push(...extra);
    const created = parseLooseDate(v.submitted) || today;
    out.push({
      id: "web-" + hashStr(key), name: name || v.email || "Website enquiry", partner: v.partner || "", email: v.email || "", phone: v.phone || "",
      source: "Website", stage: "new", date, type: type || "Other", venue: v.venue || "", postcode: (v.postcode || "").toUpperCase(),
      guests: v.guests && !isNaN(parseInt(v.guests)) ? parseInt(v.guests) : "", time: /^\d{1,2}:\d{2}$/.test(v.time || "") ? v.time.padStart(5, "0") : "",
      package: "", extraHours: 0, miles: 0, override: "", lastContact: "", lost: "",
      notes: notes.join("\n"), contract: false, deposit: false, balance: false, review: false, created, web: true
    });
  }
  return out;
}
function sheetIdFrom(link) { const m = String(link || "").match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(link || "").match(/^([a-zA-Z0-9_-]{25,})$/); return m ? m[1] : ""; }

/** Business numbers for bookings whose event date falls in [from, to] (inclusive, "YYYY-MM-DD"; blank = open-ended). */
function financials(bookings, config, from, to) {
  const inRange = b => { const d = b.date || b.created || ""; return (!from || d >= from) && (!to || d <= to); };
  const all = Object.values(bookings || {}).filter(inRange);
  const won = all.filter(b => WON.includes(b.stage)), lost = all.filter(b => b.stage === "lost"), quoted = all.filter(b => b.stage === "quoted");
  const q = b => calcQuote(b, config), sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0), avg = (xs, f) => xs.length ? sum(xs, f) / xs.length : 0;
  const median = xs => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const revenue = sum(won, b => q(b).total);
  const received = sum(won, b => (b.stage === "paid" || b.stage === "done" || b.balance) ? q(b).total : b.deposit ? q(b).deposit : 0);
  const days = (a, b) => (a && b) ? Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5) : null;
  const leads = won.map(b => days(b.created, b.date)).filter(x => x != null && x >= 0);
  const group = (xs, key) => {
    const m = {};
    for (const b of xs) { const k = key(b) || "Unknown"; (m[k] = m[k] || { key: k, enquiries: 0, won: 0, lost: 0, revenue: 0 }); m[k].enquiries++; if (WON.includes(b.stage)) { m[k].won++; m[k].revenue += q(b).total; } if (b.stage === "lost") m[k].lost++; }
    return Object.values(m).map(g => Object.assign(g, { avg: g.won ? g.revenue / g.won : 0, rate: (g.won + g.lost) ? g.won / (g.won + g.lost) : null })).sort((a, b) => b.revenue - a.revenue || b.enquiries - a.enquiries);
  };
  const pkgName = b => q(b).pkg.name, typeGroup = b => /wedding/i.test(b.type || "") ? "Weddings" : (b.type || "Other");
  const months = {};
  for (const b of won) if (b.date) { const k = b.date.slice(0, 7); months[k] = (months[k] || 0) + q(b).total; }
  const hrs = sum(won, b => q(b).hours);
  const discounts = won.map(b => { const c = q(b); return Math.max(0, c.calcTotal - c.total); });
  const dow = [0, 0, 0, 0, 0, 0, 0]; won.forEach(b => { if (b.date) dow[(new Date(b.date + "T00:00:00").getDay() + 6) % 7]++; });
  const reasons = {}; lost.forEach(b => { const r = (b.lost || "No reason given").trim(); reasons[r] = (reasons[r] || 0) + 1; });
  return {
    enquiries: all.length, bookings: won.length, lostCount: lost.length, revenue, avgSale: won.length ? revenue / won.length : 0, medianSale: median(won.map(b => q(b).total)),
    received, outstanding: revenue - received, quotedValue: sum(quoted, b => q(b).total), quotedCount: quoted.length,
    winRate: (won.length + lost.length) ? won.length / (won.length + lost.length) : null,
    perHour: hrs ? revenue / hrs : 0, avgHours: won.length ? hrs / won.length : 0,
    avgLeadDays: leads.length ? Math.round(leads.reduce((a, b) => a + b, 0) / leads.length) : null,
    travelIncome: sum(won, b => q(b).travel), avgMiles: avg(won.filter(b => +b.miles), b => +b.miles),
    extrasIncome: sum(won, b => q(b).extra), upsellRate: won.length ? won.filter(b => +b.extraHours > 0).length / won.length : 0,
    discountTotal: discounts.reduce((a, b) => a + b, 0), discountCount: discounts.filter(x => x > 0).length,
    byPackage: group(all, pkgName), byType: group(all, typeGroup), bySource: group(all, b => b.source),
    byMonth: Object.keys(months).sort().map(k => ({ month: k, revenue: months[k] })), byDow: dow,
    lostReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1])
  };
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

if (typeof module !== "undefined") module.exports = { mergeData, calcQuote, toCSV, DEFAULT_CONFIG, fillTemplate, clashesFor, parseCSV, rowsToEnquiries, parseLooseDate, sheetIdFrom, balanceDueDate, quoteRef, templatesOf, financials };

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
  let calMonth = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); })();
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600); }
  function notice(html, cls) { const n = $("notice"); if (!html) { n.hidden = true; return; } n.className = "notice " + (cls || ""); n.innerHTML = html; n.hidden = false; }
  const list = () => Object.values(data.bookings);
  const calc = b => calcQuote(b, data.config);

  function balanceFlag(b) {
    if (b.balance || !b.date || !["booked"].includes(b.stage)) return "";
    const due = balanceDueDate(b, data.config), u = daysUntil(due), ev = daysUntil(b.date);
    if (ev !== null && ev < 0) return "Balance unpaid";
    if (u !== null && u < 0) return "Balance overdue";
    if (u !== null && u <= 7) return "Balance due " + (u === 0 ? "today" : "in " + u + "d");
    return "";
  }
  function flags(b) {
    const f = [];
    const cl = clashesFor(b, list());
    if (cl.hard.length && (LOCKED.includes(b.stage))) f.push("Double booked");
    else if (cl.hard.length && (b.stage === "new" || b.stage === "quoted")) f.push("Date taken");
    if (b.stage === "new") { const d = daysSince(b.created); if (d !== null && d >= 1) f.push("Reply"); }
    if (b.stage === "quoted") { const d = daysSince(b.lastContact || b.created); if (d !== null && d >= 4) f.push("Chase · " + d + "d"); }
    if (b.stage === "booked") {
      if (!b.contract) f.push("No contract");
      if (!b.deposit) f.push("No deposit");
      const bf = balanceFlag(b); if (bf) f.push(bf);
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
    const chips = [`<span class="chip">${esc(b.type || "Event")}</span>`].concat(b.web && b.stage === "new" ? [`<span class="chip web">Website</span>`] : []).concat(f.map(x => `<span class="chip flag">${esc(x)}</span>`));
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
        <div class="checks">${t(b.contract, "Contract")}${t(b.deposit, "Deposit")}${t(b.balance, b.balance ? "Balance" : "Balance by " + (balanceDueDate(b, data.config) ? new Date(balanceDueDate(b, data.config) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "TBC"))}</div></button>`;
    }).join("")}</div>`;
  }
  function renderPackages() {
    const cfg = data.config, B = biz(cfg), T = templatesOf(cfg);
    const fld = (id, label, val, attrs = "") => `<label class="f">${label}<input id="${id}" value="${esc(val)}" ${attrs}></label>`;
    $("view-packages").innerHTML = `<div class="stack">
      <div class="section-h"><h2>Packages</h2><p>Edit prices here and every quote updates.</p></div>
      <div class="pk-grid">${cfg.packages.map((p, i) => `<div class="pk">
        <span class="tag">Package ${i + 1}</span>
        <label class="f">Name<input id="pk-name-${i}" value="${esc(p.name)}"></label>
        <div class="grid2"><label class="f">Hours<input id="pk-hours-${i}" type="number" step="0.5" min="0" value="${esc(p.hours)}"></label>
        <label class="f">Price (£)<input id="pk-price-${i}" type="number" min="0" value="${esc(p.price)}"></label></div>
        <label class="f">Description (shows on quotes)<textarea id="pk-blurb-${i}">${esc(p.blurb)}</textarea></label></div>`).join("")}</div>
      <div class="section-h"><h2>Pricing &amp; payment rules</h2><p>Travel is charged both ways for miles beyond the free radius, measured by road from your base postcode.</p></div>
      <div class="rules">
        ${fld("r-base", "Base postcode", B.basePostcode, 'autocapitalize="characters"')}
        <label class="f">Extra hour (£)<input id="r-extra" type="number" min="0" value="${esc(cfg.extraHour)}"></label>
        <label class="f">Free radius (miles)<input id="r-free" type="number" min="0" value="${esc(cfg.freeMiles)}"></label>
        <label class="f">Per mile (£)<input id="r-mile" type="number" min="0" step="0.05" value="${esc(cfg.perMile)}"></label>
        <label class="f">Deposit (%)<input id="r-dep" type="number" min="0" max="100" value="${esc(cfg.depositPct)}"></label>
        <label class="f">Balance due (days before)<input id="r-baldays" type="number" min="0" value="${esc(B.balanceDays)}"></label>
        <label class="f">Quotes held for (days)<input id="r-valid" type="number" min="1" value="${esc(B.quoteValidDays)}"></label>
      </div>
      <div class="section-h"><h2>Business details</h2><p>Used on quotes, invoices and emails. Bank details only appear on invoices.</p></div>
      <div class="panel"><div class="grid3">
        ${fld("b-name", "Trading name", B.name)}${fld("b-email", "Email", B.email, 'type="email"')}${fld("b-phone", "Phone", B.phone, 'type="tel"')}
        ${fld("b-web", "Website", B.website)}${fld("b-sign", "Email sign-off name", B.signoff)}${fld("b-legal", "Company legal name (for invoices)", B.legalName, 'placeholder="e.g. GBI Mitchell Limited"')}
        ${fld("b-coNo", "Company number", B.companyNo)}${fld("b-bank", "Bank", B.bankName)}${fld("b-acName", "Account name", B.accountName)}
        ${fld("b-sort", "Sort code", B.sortCode, 'inputmode="numeric"')}${fld("b-acNo", "Account number", B.accountNo, 'inputmode="numeric"')}
      </div>
      <label class="f">Registered address<textarea id="b-addr" rows="2">${esc(B.address)}</textarea></label>
      <label class="f">What's included (shows on quotes)<textarea id="b-incl" rows="2">${esc(B.included)}</textarea></label>
      <label class="f">Payment note (quotes and reminder emails)<textarea id="b-pay" rows="2">${esc(B.paymentNote)}</textarea></label></div>
      <div class="section-h"><h2>Email templates</h2><p>Words in {curly brackets} fill in automatically: {first}, {names}, {date}, {venue}, {eventLine}, {package}, {hours}, {total}, {deposit}, {balance}, {balanceDue}, {validUntil}, {time}, {signoff}, {business}, {website}.</p></div>
      <div class="tpl-list">${T.map((t, i) => `<details class="panel tpl"><summary><b>${esc(t.name)}</b><span>${esc(t.subject)}</span></summary>
        <label class="f">Name<input id="t-name-${i}" value="${esc(t.name)}"></label>
        <label class="f">Subject<input id="t-subj-${i}" value="${esc(t.subject)}"></label>
        <label class="f">Message<textarea id="t-body-${i}" rows="12">${esc(t.body)}</textarea></label></details>`).join("")}</div>
      <div class="btn-row"><button class="btn primary" type="button" id="savePk">Save all</button><button class="btn ghost" type="button" id="resetTpl">Restore default email templates</button></div></div>`;
    const v = id => $(id).value.trim();
    $("savePk").onclick = () => {
      data.config = {
        packages: cfg.packages.map((p, i) => ({ id: p.id, name: v("pk-name-" + i) || p.name, hours: +$("pk-hours-" + i).value || 0, price: +$("pk-price-" + i).value || 0, blurb: v("pk-blurb-" + i) })),
        extraHour: +$("r-extra").value || 0, freeMiles: +$("r-free").value || 0, perMile: +$("r-mile").value || 0, depositPct: +$("r-dep").value || 0,
        business: { name: v("b-name") || DEFAULT_BUSINESS.name, email: v("b-email"), phone: v("b-phone"), website: v("b-web"), signoff: v("b-sign"),
          quoteValidDays: +$("r-valid").value || 30, balanceDays: +$("r-baldays").value || 0, basePostcode: v("r-base").toUpperCase() || DEFAULT_BUSINESS.basePostcode,
          legalName: v("b-legal"), companyNo: v("b-coNo"), address: v("b-addr"), bankName: v("b-bank"), accountName: v("b-acName"), sortCode: v("b-sort"), accountNo: v("b-acNo"), paymentNote: v("b-pay"), included: v("b-incl") },
        templates: T.map((t, i) => Object.assign({}, t, { name: v("t-name-" + i) || t.name, subject: v("t-subj-" + i), body: $("t-body-" + i).value })),
        enquirySheet: cfg.enquirySheet || "",
        updated: nowISO()
      };
      if (B.basePostcode !== biz(data.config).basePostcode) baseGeo = null;
      changed(); toast("Saved"); renderPackages();
    };
    $("resetTpl").onclick = e => {
      const btn = e.currentTarget;
      if (!btn.classList.contains("armed")) { btn.classList.add("armed"); btn.textContent = "Tap again to replace your edited templates"; setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "Restore default email templates"; }, 4000); return; }
      data.config = Object.assign({}, cfg, { templates: DEFAULT_TEMPLATES, updated: nowISO() }); changed(); renderPackages(); toast("Templates restored");
    };
  }
  let finRange = "year";
  function renderFinance() {
    const el = $("view-finance"), t = new Date(), y = t.getFullYear();
    const ranges = { year: [y + "-01-01", y + "-12-31", "This year (" + y + ")"], next: [y + 1 + "-01-01", y + 1 + "-12-31", String(y + 1)], last: [y - 1 + "-01-01", y - 1 + "-12-31", String(y - 1)], all: ["", "", "All time"] };
    const [from, to] = ranges[finRange];
    const f = financials(data.bookings, data.config, from, to);
    const pct = x => x == null ? "–" : Math.round(x * 100) + "%";
    const tile = (v, l, sub) => `<div class="stat"><b>${v}</b><small>${l}</small>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
    const tbl = (title, rows, note) => `<div class="panel"><h3>${title}</h3>${note ? `<p>${note}</p>` : ""}${rows.length ? `<table class="ftable"><thead><tr><th></th><th class="num">Enquiries</th><th class="num">Booked</th><th class="num">Win rate</th><th class="num">Avg sale</th><th class="num">Revenue</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.key)}</td><td class="num">${r.enquiries}</td><td class="num">${r.won}</td><td class="num">${pct(r.rate)}</td><td class="num">${r.won ? gbp(r.avg) : "–"}</td><td class="num">${gbp(r.revenue)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Nothing yet.</p>`}</div>`;
    // month bars: Jan-Dec of the chosen year, or the months that have data for all time
    let months = f.byMonth;
    if (from) { const yy = from.slice(0, 4); months = Array.from({ length: 12 }, (_, i) => { const k = yy + "-" + String(i + 1).padStart(2, "0"); return { month: k, revenue: (f.byMonth.find(m => m.month === k) || {}).revenue || 0 }; }); }
    const maxM = Math.max(1, ...months.map(m => m.revenue));
    const bars = months.length ? `<div class="bars">${months.map(m => `<div class="bar-col" title="${esc(new Date(m.month + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}: ${gbp(m.revenue)}">
        <span class="bv num">${m.revenue ? (m.revenue >= 1000 ? "£" + (m.revenue / 1000).toFixed(1).replace(/\.0$/, "") + "k" : gbp(m.revenue)) : ""}</span><i style="height:${Math.round(m.revenue / maxM * 100)}%"></i><span class="bl">${new Date(m.month + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short" })}${from ? "" : " " + m.month.slice(2, 4)}</span></div>`).join("")}</div>` : `<p class="muted">No booked events yet.</p>`;
    const maxD = Math.max(1, ...f.byDow);
    const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    el.innerHTML = `<div class="stack">
      <div class="section-h"><h2>Financials</h2><div class="seg">${Object.entries(ranges).map(([k, r]) => `<button type="button" data-range="${k}" aria-pressed="${k === finRange}">${esc(r[2])}</button>`).join("")}</div></div>
      <p class="hint">Booked means Booked, Paid in full or Completed, counted by event date. Figures use the quote on each booking, including any agreed price.</p>
      <section class="stats fin">${tile(gbp(f.revenue), "Booked revenue", f.bookings + (f.bookings === 1 ? " booking" : " bookings"))}${tile(f.bookings ? gbp(f.avgSale) : "–", "Average sale", f.bookings ? "Median " + gbp(f.medianSale) : "")}
        ${tile(gbp(f.received), "Cash received", "Deposits and balances ticked")}${tile(gbp(f.outstanding), "Still to collect", "")}
        ${tile(pct(f.winRate), "Win rate", f.bookings + " won · " + f.lostCount + " lost")}${tile(gbp(f.quotedValue), "Quoted, undecided", f.quotedCount + " open quotes")}
        ${tile(f.perHour ? gbp(f.perHour) : "–", "Revenue per hour", f.avgHours ? "Avg " + (Math.round(f.avgHours * 10) / 10) + "h per event" : "")}${tile(f.avgLeadDays == null ? "–" : f.avgLeadDays + "d", "Booking lead time", "Enquiry to event, on average")}</section>
      <div class="panel"><h3>Revenue by month</h3>${bars}</div>
      <section class="stats fin">${tile(gbp(f.extrasIncome), "Extra-hours income", pct(f.upsellRate) + " of bookings added time")}${tile(gbp(f.travelIncome), "Travel charged", f.avgMiles ? "Avg " + Math.round(f.avgMiles) + " miles each way" : "")}
        ${tile(gbp(f.discountTotal), "Discounts given", f.discountCount + " bookings below calculator price")}${tile(f.enquiries, "Enquiries", "In this period")}</section>
      <div class="panel-grid">
        ${tbl("By package", f.byPackage, "Which packages sell, and at what average price.")}
        ${tbl("By event type", f.byType, "Weddings against corporate and private events.")}
        ${tbl("By source", f.bySource, "Where enquiries come from, and which ones actually book. Useful for deciding where to spend on marketing.")}
        <div class="panel"><h3>Busiest days</h3><div class="hbars">${f.byDow.map((n, i) => `<div><span>${dows[i]}</span><i style="width:${Math.round(n / maxD * 100)}%"></i><b class="num">${n}</b></div>`).join("")}</div>
          <h3 style="margin-top:8px">Why enquiries were lost</h3>${f.lostReasons.length ? `<div class="hbars">${f.lostReasons.map(([r, n]) => `<div><span>${esc(r)}</span><i style="width:${Math.round(n / f.lostReasons[0][1] * 100)}%"></i><b class="num">${n}</b></div>`).join("")}</div>` : `<p class="muted">No lost enquiries in this period.</p>`}</div>
      </div></div>`;
    el.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { finRange = b.dataset.range; renderFinance(); });
  }
  function renderCalendar() {
    const el = $("view-calendar");
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1), startDow = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const ym = y + "-" + String(m + 1).padStart(2, "0");
    const items = list().filter(b => b.date && b.date.startsWith(ym) && b.stage !== "lost" && matches(b)).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const byDay = {}; items.forEach(b => (byDay[+b.date.slice(8)] = byDay[+b.date.slice(8)] || []).push(b));
    const today = isoToday();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="day pad"></div>`;
    for (let d = 1; d <= days; d++) {
      const iso = ym + "-" + String(d).padStart(2, "0"), evs = byDay[d] || [];
      const held = evs.filter(b => LOCKED.includes(b.stage)).length;
      cells += `<div class="day${iso === today ? " today" : ""}${held > 1 ? " clash" : ""}"><span class="dn">${d}</span>
        ${evs.map(b => `<button type="button" class="ev st-${esc(b.stage)}" data-id="${esc(b.id)}" title="${esc(b.name)}"><span>${esc(b.name || "Unnamed")}</span></button>`).join("")}</div>`;
    }
    const label = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    el.innerHTML = `<div class="stack">
      <div class="cal-head"><button class="btn" type="button" id="calPrev" aria-label="Previous month">‹</button><h2>${esc(label)}</h2><button class="btn" type="button" id="calNext" aria-label="Next month">›</button><button class="btn ghost" type="button" id="calToday">Today</button>
        <span class="legend"><i class="st-booked"></i>Booked <i class="st-quoted"></i>Quoted <i class="st-new"></i>Enquiry</span></div>
      <div class="cal"><div class="dow">Mon</div><div class="dow">Tue</div><div class="dow">Wed</div><div class="dow">Thu</div><div class="dow">Fri</div><div class="dow">Sat</div><div class="dow">Sun</div>${cells}</div>
      ${items.length ? `<div class="list">${items.map(b => { const d = new Date(b.date + "T00:00:00"); const c = clashesFor(b, list()); return `<button type="button" class="row" data-id="${esc(b.id)}">
        <div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString("en-GB", { weekday: "short" })}</span></div>
        <div style="min-width:0"><div class="who">${esc(b.name)}${b.partner ? " &amp; " + esc(b.partner) : ""}</div><div class="meta">${esc((STAGES.find(s => s.id === b.stage) || {}).label || "")}${b.time ? " · " + esc(b.time) : ""}${b.venue ? " · " + esc(b.venue) : ""}</div></div>
        <div class="checks">${c.hard.length && (LOCKED.includes(b.stage) || b.stage !== "lost") ? `<span class="tick off">${LOCKED.includes(b.stage) ? "Double booked" : "Date taken"}</span>` : ""}</div></button>`; }).join("")}</div>`
        : `<div class="notice">Nothing in ${esc(label)} yet.</div>`}</div>`;
    const go = n => { calMonth = new Date(y, m + n, 1); renderCalendar(); };
    $("calPrev").onclick = () => go(-1); $("calNext").onclick = () => go(1);
    $("calToday").onclick = () => { const t = new Date(); calMonth = new Date(t.getFullYear(), t.getMonth(), 1); renderCalendar(); };
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
          <h3>Website enquiries</h3>
          <p>Paste the link to the Google Sheet your Squarespace enquiry form saves to. New rows land in “New enquiry” every time the app syncs.</p>
          <label class="f">Form responses Sheet link<input id="webSheet" value="${esc(data.config.enquirySheet || "")}" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
          <dl class="kv"><dt>Last checked</dt><dd>${esc(meta.webChecked ? ago(meta.webChecked) : "Not yet")}</dd>${meta.webError ? `<dt>Problem</dt><dd>${esc(meta.webError)}</dd>` : ""}</dl>
          <div class="btn-row"><button class="btn" type="button" id="saveWeb">Save link</button>${configured ? `<button class="btn" type="button" id="checkWeb"${data.config.enquirySheet ? "" : " disabled"}>Check for new enquiries</button>` : ""}</div>
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
    $("saveWeb").onclick = () => {
      const link = $("webSheet").value.trim();
      if (link && !sheetIdFrom(link)) { toast("That doesn't look like a Google Sheet link"); return; }
      data.config = Object.assign({}, data.config, { enquirySheet: link, updated: nowISO() }); meta.webError = "";
      changed(); renderSettings(); toast(link ? "Saved. Checking on next sync" : "Link removed");
    };
    if ($("checkWeb")) $("checkWeb").onclick = () => sync(true);
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
    if (view === "calendar") renderCalendar();
    if (view === "finance") renderFinance();
    renderSyncPill();
  }

  /* ----- tabs, search, cards ----- */
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    view = b.dataset.view;
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["pipeline", "upcoming", "calendar", "finance", "packages", "settings"].forEach(v => $("view-" + v).hidden = v !== view);
    $("q").hidden = view === "packages" || view === "settings" || view === "finance";
    if (view === "packages") renderPackages();
    if (view === "settings") renderSettings();
    render();
  });
  $("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
  document.addEventListener("click", e => { const c = e.target.closest(".card,.row,.ev"); if (c && c.dataset.id) openForm(data.bookings[c.dataset.id]); });
  $("syncPill").onclick = () => { if (!CFG.googleClientId) { document.querySelector('[data-view="settings"]').click(); return; } sync(true); };

  /* ----- form ----- */
  const F = ["name", "partner", "email", "phone", "source", "stage", "date", "type", "venue", "postcode", "guests", "time", "package", "extra", "miles", "override", "contact", "lost", "notes"];
  const KEY = { extra: "extraHours", contact: "lastContact" };
  $("f-stage").innerHTML = STAGES.map(s => `<option value="${s.id}">${s.label}</option>`).join("");
  function fillPackages() { $("f-package").innerHTML = data.config.packages.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.hours}h · ${gbp(p.price)}</option>`).join(""); }
  let dist = null;   // { to, miles, mins, approx, route:[[lat,lng]], from:{lat,lng}, dest:{lat,lng} } for the open form
  function readForm() {
    const o = {}; F.forEach(k => o[KEY[k] || k] = $("f-" + k).value);
    o.guests = o.guests === "" ? "" : +o.guests; o.extraHours = +o.extraHours || 0; o.miles = +o.miles || 0; o.override = o.override === "" ? "" : +o.override;
    ["contract", "deposit", "balance", "review"].forEach(k => o[k] = $("f-" + k).checked);
    o.postcode = o.postcode.trim().toUpperCase();
    if (dist && normPc(dist.to) === normPc(o.postcode)) { o.distMiles = dist.miles; o.driveMins = dist.mins; o.distApprox = !!dist.approx; o.distTo = dist.to; }
    else if (editing && normPc(editing.distTo) === normPc(o.postcode)) { o.distMiles = editing.distMiles; o.driveMins = editing.driveMins; o.distApprox = editing.distApprox; o.distTo = editing.distTo; }
    o.id = editing ? editing.id : "";
    o.created = editing ? editing.created : isoToday();
    if (editing && editing.web) o.web = true;
    return o;
  }
  function updateQuote() {
    const b = readForm(), c = calc(b), cfg = data.config;
    $("quoteBox").innerHTML = `<div><span>${esc(c.pkg.name || "Package")}</span><span class="num">${gbp(c.pkg.price)}</span></div>
      ${c.extra ? `<div><span>Extra time (${b.extraHours}h × ${gbp(cfg.extraHour)})</span><span class="num">${gbp(c.extra)}</span></div>` : ""}
      ${c.travel ? `<div><span>Travel (${c.travelMiles} mi beyond ${cfg.freeMiles}, both ways)</span><span class="num">${gbp(c.travel)}</span></div>` : ""}
      ${b.override !== "" ? `<div><span>Calculator price</span><span class="num">${gbp(c.calcTotal)}</span></div>` : ""}
      <div class="total"><span>${b.override !== "" ? "Agreed price" : "Quote"}</span><span class="num">${gbp(c.total)}</span></div>
      <div><span>Deposit (${cfg.depositPct}%)</span><span class="num">${gbp(c.deposit)}</span></div>
      ${b.date ? `<div><span>Balance due by ${esc(fmtDate(balanceDueDate(b, cfg)))}</span><span class="num">${gbp(c.balance)}</span></div>` : ""}`;
    $("lostWrap").hidden = b.stage !== "lost";
    const cl = clashesFor(b, list()), w = $("dateWarn");
    const nm = x => esc(x.name || "Unnamed") + " (" + esc((STAGES.find(s => s.id === x.stage) || {}).label || x.stage) + ")";
    if (cl.hard.length) { w.className = "warn bad"; w.innerHTML = `<b>Date already booked:</b> ${cl.hard.map(nm).join(", ")}`; w.hidden = false; }
    else if (cl.soft.length) { w.className = "warn"; w.innerHTML = `Also enquiring for this date: ${cl.soft.map(nm).join(", ")}`; w.hidden = false; }
    else w.hidden = true;
  }
  $("form").addEventListener("input", updateQuote);
  $("form").addEventListener("change", updateQuote);
  function openForm(b) {
    editing = b || null; fillPackages(); dist = null;
    const d = b || { stage: "new", source: "Website", type: "Wedding: drinks reception", package: (data.config.packages[0] || {}).id, extraHours: 0, miles: 0, override: "", lastContact: isoToday() };
    F.forEach(k => { const v = d[KEY[k] || k]; $("f-" + k).value = v == null ? "" : v; });
    if (!$("f-package").value && data.config.packages[0]) $("f-package").value = data.config.packages[0].id;
    ["contract", "deposit", "balance", "review"].forEach(k => $("f-" + k).checked = !!d[k]);
    $("formTitle").textContent = b ? (b.name || "Enquiry") : "New enquiry";
    $("delBtn").hidden = !b; $("delBtn").classList.remove("armed"); $("delBtn").textContent = "Delete";
    $("f-miles").dataset.auto = b && b.distMiles != null && Math.round(b.distMiles) === +b.miles ? "1" : (!b || !+d.miles ? "1" : "");
    updateQuote(); $("overlay").hidden = false; document.body.style.overflow = "hidden";
    $("form").scrollTop = 0;
    renderDist(b && b.distTo ? { to: b.distTo, miles: b.distMiles, mins: b.driveMins, approx: b.distApprox } : null);
    if (d.postcode) lookupDistance(d.postcode, false);
    if (!b) setTimeout(() => $("f-name").focus(), 60);
  }
  function closeForm() { $("overlay").hidden = true; document.body.style.overflow = ""; editing = null; dist = null; }
  $("addBtn").onclick = () => openForm(null);
  $("closeBtn").onclick = closeForm; $("cancelBtn").onclick = closeForm;
  $("overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeForm(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("docView").hidden) { closeDoc(); return; }
    if (!$("mailView").hidden) { $("mailView").hidden = true; return; }
    if (!$("overlay").hidden) closeForm();
  });
  /** Save the open form. Returns the saved booking, or null if it needs a name first. */
  function saveForm(patch, keepOpen) {
    const o = Object.assign(readForm(), patch || {});
    if (!o.name.trim()) { $("f-name").focus(); toast("Add a name first"); return null; }
    if (o.stage === "paid") { o.deposit = true; o.balance = true; }
    o.quote = calc(o).total;
    o.id = editing ? editing.id : uid();
    o.created = editing ? (editing.created || isoToday()) : isoToday();
    o.updated = nowISO();
    data.bookings[o.id] = o;
    if (keepOpen) { editing = o; $("delBtn").hidden = false; $("formTitle").textContent = o.name; F.forEach(k => { const v = o[KEY[k] || k]; if (v != null) $("f-" + k).value = v; }); ["contract", "deposit", "balance", "review"].forEach(k => $("f-" + k).checked = !!o[k]); updateQuote(); }
    else closeForm();
    changed();
    return o;
  }
  $("form").addEventListener("submit", e => { e.preventDefault(); if (saveForm()) toast("Saved"); });
  $("delBtn").onclick = () => {
    const b = $("delBtn");
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Tap again to delete"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Delete"; }, 3500); return; }
    delete data.bookings[editing.id]; data.deleted[editing.id] = nowISO();
    closeForm(); changed(); toast("Deleted");
  };

  /* ----- distance from base (postcodes.io + OpenStreetMap routing) ----- */
  const normPc = s => String(s || "").replace(/\s+/g, "").toUpperCase();
  const FULL_PC = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/, OUT_PC = /^[A-Z]{1,2}\d[A-Z\d]?$/;
  let baseGeo = null, distSeq = 0, distTimer = null, leafletP = null, map = null, mapLayer = null;
  async function geocode(pc) {
    const n = normPc(pc);
    if (FULL_PC.test(n)) {
      const r = await fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(n));
      if (r.ok) { const j = (await r.json()).result; if (j && j.latitude != null) return { lat: j.latitude, lng: j.longitude, label: j.postcode, place: j.admin_district || "" }; }
      if (r.status !== 404) throw new Error("Postcode lookup is unavailable right now");
    }
    const out = FULL_PC.test(n) ? n.slice(0, -3) : n;
    if (OUT_PC.test(out)) {
      const r = await fetch("https://api.postcodes.io/outcodes/" + encodeURIComponent(out));
      if (r.ok) { const j = (await r.json()).result; if (j && j.latitude != null) return { lat: j.latitude, lng: j.longitude, label: out + " (area)", place: (j.admin_district || [])[0] || "", rough: true }; }
    }
    throw new Error("Couldn't find that postcode");
  }
  function crowMiles(a, b) {
    const R = 3958.8, rad = x => x * Math.PI / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  async function lookupDistance(pc, applyMiles) {
    const seq = ++distSeq, n = normPc(pc);
    if (!FULL_PC.test(n) && !OUT_PC.test(n)) { if (!n) renderDist(null); return; }
    if (!navigator.onLine) { renderDist({ to: pc, error: "Distance needs a connection. Mileage stays as entered." }); return; }
    renderDist({ to: pc, loading: true });
    try {
      const base = baseGeo || (baseGeo = await geocode(biz(data.config).basePostcode));
      const dest = await geocode(pc);
      let miles, mins, route = null, approx = false;
      try {
        const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${base.lng},${base.lat};${dest.lng},${dest.lat}?overview=simplified&geometries=geojson`);
        const j = r.ok ? await r.json() : null;
        if (!j || !j.routes || !j.routes[0]) throw new Error("no route");
        miles = j.routes[0].distance / 1609.344; mins = Math.round(j.routes[0].duration / 60);
        route = j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      } catch (e) { miles = crowMiles(base, dest) * 1.25; mins = null; approx = true; }
      if (seq !== distSeq || $("overlay").hidden) return;
      dist = { to: pc.trim().toUpperCase(), miles: Math.round(miles * 10) / 10, mins, approx: approx || !!dest.rough, route, from: base, dest };
      const mf = $("f-miles");
      if (applyMiles || mf.dataset.auto === "1" || !+mf.value) { mf.value = Math.round(dist.miles); mf.dataset.auto = "1"; }
      renderDist(dist); updateQuote();
    } catch (e) { if (seq === distSeq) renderDist({ to: pc, error: e.message }); }
  }
  function renderDist(d) {
    const box = $("distBox"), txt = $("distText"), mapEl = $("distMap");
    if (!d) { box.hidden = true; return; }
    box.hidden = false;
    const base = biz(data.config).basePostcode;
    if (d.loading) { txt.innerHTML = `Working out the drive from ${esc(base)}…`; return; }
    if (d.error) { txt.innerHTML = esc(d.error); mapEl.hidden = true; return; }
    const hrs = d.mins != null ? (d.mins >= 60 ? Math.floor(d.mins / 60) + "h " + String(d.mins % 60).padStart(2, "0") + "m" : d.mins + " min") : "";
    const c = data.config, extra = Math.max(0, Math.round(d.miles) - (+c.freeMiles || 0));
    txt.innerHTML = `<b class="num">${esc(String(Math.round(d.miles)))} miles</b> each way from ${esc(base)}${hrs ? ` · about <b>${hrs}</b> drive` : ""}${d.approx ? ` <span class="muted">(approximate)</span>` : ""}
      <br><span class="muted">${extra ? `${extra} chargeable miles beyond your ${c.freeMiles}-mile free radius, ${Math.round(d.miles) * 2} miles round trip` : `Inside your ${c.freeMiles}-mile free radius`}</span>`;
    if (d.from && d.dest) drawMap(d); else mapEl.hidden = true;
  }
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(css);
      const js = document.createElement("script"); js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; js.onload = res; js.onerror = () => { leafletP = null; rej(); }; document.head.appendChild(js);
    });
    return leafletP;
  }
  async function drawMap(d) {
    const el = $("distMap");
    try { await loadLeaflet(); } catch (e) { el.hidden = true; return; }
    if (dist !== d) return;
    el.hidden = false;
    if (!map) {
      map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
    }
    if (mapLayer) mapLayer.remove();
    const css = getComputedStyle(document.documentElement), green = "#254506", gold = css.getPropertyValue("--flag").trim() || "#B8862B";
    const pin = (color, label) => L.marker([0, 0], { icon: L.divIcon({ className: "pin", html: `<span style="background:${color}">${label}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) });
    const a = pin(green, "ES").setLatLng([d.from.lat, d.from.lng]), b = pin(gold, "★").setLatLng([d.dest.lat, d.dest.lng]);
    const line = L.polyline(d.route || [[d.from.lat, d.from.lng], [d.dest.lat, d.dest.lng]], { color: green, weight: 4, opacity: .85, dashArray: d.route ? null : "6 8" });
    const cfg = data.config, free = (+cfg.freeMiles || 0) * 1609.344;
    const ring = free ? L.circle([d.from.lat, d.from.lng], { radius: free / 1.25, color: green, weight: 1, opacity: .4, fillOpacity: .05, interactive: false }) : null;
    mapLayer = L.layerGroup([ring, line, a, b].filter(Boolean)).addTo(map);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(line.getBounds(), { padding: [24, 24], maxZoom: 12 }); }, 30);
  }
  $("f-postcode").addEventListener("input", () => { clearTimeout(distTimer); distTimer = setTimeout(() => lookupDistance($("f-postcode").value, false), 700); });
  $("f-miles").addEventListener("input", () => { $("f-miles").dataset.auto = ""; });
  $("distUse").onclick = () => { if (dist && dist.miles != null) { $("f-miles").value = Math.round(dist.miles); $("f-miles").dataset.auto = "1"; updateQuote(); toast("Mileage updated"); } else lookupDistance($("f-postcode").value, true); };

  /* ----- quotes & invoices ----- */
  let docKind = null;
  function docHTML(b, kind) {
    const cfg = data.config, B = biz(cfg), c = calc(b), today = isoToday();
    const ref = quoteRef(b), isQuote = kind === "quote";
    const title = isQuote ? "Quote" : kind === "deposit" ? "Deposit invoice" : "Invoice";
    const num = isQuote ? ref : ref.replace(/^ES-/, "INV-") + (kind === "deposit" ? "-D" : "-B");
    const due = isQuote ? addDays(today, +B.quoteValidDays || 30) : kind === "deposit" ? addDays(today, 7) : (balanceDueDate(b, cfg) > today ? balanceDueDate(b, cfg) : today);
    const line = (l, sub, v, cls = "") => `<tr class="${cls}"><td>${l}${sub ? `<small>${sub}</small>` : ""}</td><td class="num">${v}</td></tr>`;
    const items = [line(esc(c.pkg.name || "Golf bay hire"), esc([c.pkg.hours ? c.pkg.hours + " hours" : "", c.pkg.blurb || ""].filter(Boolean).join(" · ")), gbp(c.pkg.price))];
    if (c.extra) items.push(line("Extra time", esc(b.extraHours + " hours × " + gbp(cfg.extraHour)), gbp(c.extra)));
    if (c.travel) items.push(line("Travel", esc(`${c.travelMiles} miles beyond our ${cfg.freeMiles}-mile free radius, both ways`), gbp(c.travel)));
    else if (b.miles) items.push(line("Travel", esc(`${b.miles} miles each way, within our free radius`), "Included"));
    if (b.override !== "" && b.override != null && +b.override !== c.calcTotal) items.push(line(+b.override < c.calcTotal ? "Discount" : "Adjustment", "", (+b.override < c.calcTotal ? "−" : "") + gbp(Math.abs(c.calcTotal - +b.override))));
    let totals;
    if (isQuote) totals = line("Total", "", gbp(c.total), "tot") + line(`Deposit to secure the date (${cfg.depositPct}%)`, "", gbp(c.deposit), "sub") + line(`Balance due by ${shortDate(balanceDueDate(b, cfg))}`, "", gbp(c.balance), "sub");
    else if (kind === "deposit") totals = line("Booking total", "", gbp(c.total), "sub") + line(`Deposit due now (${cfg.depositPct}%)`, "", gbp(c.deposit), "tot");
    else totals = line("Booking total", "", gbp(c.total), "sub") + line("Less deposit " + (b.deposit ? "paid" : "invoiced"), "", "−" + gbp(c.deposit), "sub") + line("Balance due", "", gbp(c.balance), "tot");
    const bank = B.accountNo || B.sortCode ? `<div class="doc-pay"><h4>How to pay</h4><dl>${B.accountName ? `<dt>Account name</dt><dd>${esc(B.accountName)}</dd>` : ""}${B.bankName ? `<dt>Bank</dt><dd>${esc(B.bankName)}</dd>` : ""}${B.sortCode ? `<dt>Sort code</dt><dd class="num">${esc(B.sortCode)}</dd>` : ""}${B.accountNo ? `<dt>Account number</dt><dd class="num">${esc(B.accountNo)}</dd>` : ""}<dt>Reference</dt><dd class="num">${esc(num)}</dd></dl></div>`
      : `<div class="doc-pay"><h4>How to pay</h4><p>Payment details to follow. Please use reference <b class="num">${esc(num)}</b>.</p></div>`;
    const ev = [["Date", b.date ? longDate(b.date) : "To be confirmed"], ["Start time", b.time], ["Event", b.type], ["Venue", [b.venue, b.postcode].filter(Boolean).join(", ")], ["Guests", b.guests ? "About " + b.guests : ""],
      ["Distance", b.distMiles != null ? `${Math.round(b.distMiles)} miles from our base${b.driveMins ? ", about " + (b.driveMins >= 60 ? Math.floor(b.driveMins / 60) + "h " + (b.driveMins % 60) + "m" : b.driveMins + " min") + " drive" : ""}` : ""]].filter(x => x[1]);
    return `<article class="doc">
      <header class="doc-top"><img src="icons/logo-green.png" alt="Eighteen Swings"><div class="doc-meta"><h1>${title}</h1><dl><dt>${isQuote ? "Quote" : "Invoice"} no.</dt><dd class="num">${esc(num)}</dd><dt>Date</dt><dd>${esc(shortDate(today))}</dd><dt>${isQuote ? "Valid until" : "Due"}</dt><dd>${esc(shortDate(due))}</dd></dl></div></header>
      <section class="doc-parties"><div><h4>${isQuote ? "Prepared for" : "Bill to"}</h4><p><b>${esc([b.name, b.partner].filter(Boolean).join(" & "))}</b>${b.email ? "<br>" + esc(b.email) : ""}${b.phone ? "<br>" + esc(b.phone) : ""}</p></div>
        <div><h4>Your event</h4><dl>${ev.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div></section>
      <table class="doc-lines"><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>${items.join("")}</tbody><tfoot>${totals}</tfoot></table>
      ${isQuote ? `<section class="doc-note"><h4>What's included</h4><p>${esc(B.included)}</p><p>${esc(B.paymentNote)}</p></section>` : bank}
      <p class="doc-line">You don't need to be good. You just need a go, a crowd and a bit of luck.</p>
      <footer class="doc-foot">${esc([B.name, B.email, B.phone, B.website].filter(Boolean).join("  ·  "))}${B.legalName ? `<br>${esc(B.legalName)}${B.companyNo ? ", company no. " + esc(B.companyNo) : ""}${B.address ? ". Registered office: " + esc(B.address.replace(/\s*\n\s*/g, ", ")) : ""}` : ""}</footer>
    </article>`;
  }
  function openDoc(kind) {
    const b = saveForm(null, true); if (!b) return;
    docKind = kind;
    $("docBody").innerHTML = docHTML(b, kind);
    $("docTitle").textContent = (kind === "quote" ? "Quote" : kind === "deposit" ? "Deposit invoice" : "Balance invoice") + " · " + b.name;
    $("docView").hidden = false; $("docView").scrollTop = 0;
    document.title = (kind === "quote" ? "Quote " : "Invoice ") + quoteRef(b) + " · " + b.name;
  }
  function closeDoc() { $("docView").hidden = true; document.title = "Eighteen Swings CRM"; }
  $("quoteBtn").onclick = () => openDoc("quote");
  $("docClose").onclick = closeDoc;
  $("docPrint").onclick = () => window.print();
  $("invBtn").onclick = () => { const m = $("invMenu"); m.hidden = !m.hidden; $("mailMenu").hidden = true; };
  $("invMenu").addEventListener("click", e => { const k = e.target.closest("[data-inv]"); if (!k) return; $("invMenu").hidden = true; openDoc(k.dataset.inv); });

  /* ----- email templates ----- */
  let mailTpl = null;
  function fillMailMenu() { $("mailMenu").innerHTML = templatesOf(data.config).map(t => `<button type="button" data-tpl="${esc(t.id)}">${esc(t.name)}</button>`).join(""); }
  $("mailBtn").onclick = () => { fillMailMenu(); const m = $("mailMenu"); m.hidden = !m.hidden; $("invMenu").hidden = true; };
  $("mailMenu").addEventListener("click", e => {
    const k = e.target.closest("[data-tpl]"); if (!k) return; $("mailMenu").hidden = true;
    const b = saveForm(null, true); if (!b) return;
    mailTpl = templatesOf(data.config).find(t => t.id === k.dataset.tpl);
    $("mailTo").value = b.email || "";
    $("mailSubject").value = fillTemplate(mailTpl.subject, b, data.config, isoToday());
    $("mailBody").value = fillTemplate(mailTpl.body, b, data.config, isoToday());
    $("mailHint").textContent = mailTpl.stageTo && b.stage === "new" ? "Opening your email app also moves this enquiry to “Quoted” and logs today as last contact." : "Opening your email app logs today as last contact.";
    $("mailView").hidden = false;
  });
  $("mailClose").onclick = () => $("mailView").hidden = true;
  $("mailCopy").onclick = async () => {
    const txt = $("mailSubject").value + "\n\n" + $("mailBody").value;
    try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch (e) { $("mailBody").select(); toast("Select all and copy"); }
  };
  $("mailSend").onclick = () => {
    const to = $("mailTo").value.trim();
    const patch = { lastContact: isoToday() };
    if (mailTpl && mailTpl.stageTo && $("f-stage").value === "new") patch.stage = mailTpl.stageTo;
    saveForm(patch, true);
    const url = "mailto:" + encodeURIComponent(to).replace(/%40/g, "@") + "?subject=" + encodeURIComponent($("mailSubject").value) + "&body=" + encodeURIComponent($("mailBody").value);
    $("mailView").hidden = true;
    location.href = url;
  };
  document.addEventListener("click", e => {
    if (!e.target.closest("#mailBtn,#mailMenu")) $("mailMenu").hidden = true;
    if (!e.target.closest("#invBtn,#invMenu")) $("invMenu").hidden = true;
  });

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
      let added = 0;
      if (data.config.enquirySheet) {
        try { added = await importWebEnquiries(); meta.webError = ""; }
        catch (e) { meta.webError = e.status === 404 || e.status === 403 ? "This Google account can't open that Sheet. Check the link, or share the Sheet with this account." : e.message; }
        meta.webChecked = nowISO();
      }
      await api(`${UPLOAD}/${file.id}?uploadType=media&supportsAllDrives=true`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      meta.lastSync = nowISO(); meta.dirty = false; persist();
      syncing = false; setSync("ok"); render();
      if (view === "packages" && !document.activeElement?.id?.match(/^(pk|r)-/)) renderPackages();
      if (added) { toast(added === 1 ? "1 new website enquiry" : added + " new website enquiries"); if (view === "settings") renderSettings(); }
      else if (interactive) toast("Synced with Google Drive");
      if (view === "settings") renderSettings();
    } catch (e) {
      syncing = false; setSync("error", e.message); if (interactive) toast("Sync failed: " + e.message);
    }
  }
  async function importWebEnquiries() {
    const id = sheetIdFrom(data.config.enquirySheet); if (!id) throw new Error("The website form Sheet link isn't valid");
    const r = await api(`${DRIVE}/${id}/export?mimeType=text%2Fcsv`);
    const rows = parseCSV(await r.text());
    let n = 0;
    for (const e of rowsToEnquiries(rows, isoToday())) {
      if (data.bookings[e.id] || data.deleted[e.id]) continue;
      e.lastContact = ""; e.updated = nowISO();
      if (!e.package && data.config.packages[0]) e.package = data.config.packages[0].id;
      data.bookings[e.id] = e; n++;
    }
    if (n) { persist(); render(); }
    return n;
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
