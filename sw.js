// =====================================================================
//  SERVICE WORKER — fa partire l'app anche senza internet (come nell'agenda)
//  Con internet prende sempre la versione nuova; senza usa la copia salvata.
// =====================================================================
const CACHE = "turni-v3";
const FILE_APP = [
  "./", "index.html", "style.css", "turni.css", "config.js", "app.js", "cloud.js", "manifest.json",
  "icone/icona-192.png", "icone/icona-512.png", "icone/apple-touch-icon.png", "icone/favicon.png",
];
const LIBRERIA = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILE_APP);
    try { await c.add(LIBRERIA); } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;   // i dati li gestisce l'app

  if (url.href.startsWith("https://cdn.jsdelivr.net/") || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const salvata = await caches.match(req);
      if (salvata) return salvata;
      const r = await fetch(req);
      if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
      return r;
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const controllo = new AbortController();
        const timer = setTimeout(() => controllo.abort(), 4000);
        const r = await fetch(req, { signal: controllo.signal });
        clearTimeout(timer);
        if (r.ok) (await caches.open(CACHE)).put(req, r.clone());
        return r;
      } catch {
        const salvata = await caches.match(req, { ignoreSearch: true });
        if (salvata) return salvata;
        if (req.mode === "navigate") return caches.match("index.html");
        return Response.error();
      }
    })());
  }
});
