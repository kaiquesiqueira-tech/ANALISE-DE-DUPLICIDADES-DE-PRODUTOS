// Service worker do app instalado.
// Sempre busca a versão mais nova na internet; sem conexão, abre a última versão que ficou guardada
// (telas, scripts e as medições já abertas neste computador).
"use strict";
const CACHE = "duplicidade-v10";
const BASE = [
  "./", "index.html", "manifest.webmanifest", "css/estilo.css",
  "js/simcore.js", "js/xlsxstream.js", "js/analise.js", "js/xlsxwriter.js", "js/armazenamento.js", "js/app.js",
  "icones/logo.png", "icones/icone-192.png", "icones/icone-512.png", "icones/favicon-32.png"
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("duplicidade-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fontes do Google etc. seguem direto
  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copia = res.clone();
          // pedidos com ?t= (buscar sempre a versão nova) ficam guardados sem o ?t=, para o cache não crescer
          const chave = url.searchParams.has("t") ? new Request(url.origin + url.pathname) : req;
          caches.open(CACHE).then((c) => c.put(chave, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
      )
  );
});
