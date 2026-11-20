// Guarda o app no aparelho para abrir sem internet. Com internet, sempre pega a versão mais nova.
const VERSAO = "rotina-v2";
const BASE = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;            // GitHub, Google e fontes seguem direto pela rede
  const chave = u.origin + u.pathname;                  // ignora ?t=... para não encher o armazenamento
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSAO).then(c => c.put(chave, copia)); }
      return res;
    }).catch(() => caches.match(chave).then(m => m || caches.match("index.html")))
  );
});
