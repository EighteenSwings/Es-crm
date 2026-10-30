// Offline support for Eighteen Swings CRM.
// Bump VERSION whenever you change app files so phones pick up the new version.
const VERSION = "es-crm-v13";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "icons/icon-maskable-512.png", "icons/logo-green.png", "icons/logo-cream.png", "fonts/schola-bold.woff"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never cache Google sign-in or Drive traffic: that's client data and must stay fresh.
  if (url.hostname.endsWith("googleapis.com") && !url.hostname.startsWith("fonts.")) return;
  if (url.hostname === "accounts.google.com") return;
  // Fonts: cache once, reuse offline.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const res = await fetch(e.request); if (res.ok || res.type === "opaque") c.put(e.request, res.clone()); return res; } catch (err) { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  // App files: network first so updates arrive quickly, cache when offline.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html"))));
});
