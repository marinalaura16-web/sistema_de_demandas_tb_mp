// Service worker: deixa o app abrir rápido / offline e recebe notificações.
const VERSAO = "demandas-v2";
const ARQUIVOS = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Arquivos do próprio app: tenta a rede primeiro (para pegar atualizações), cai no cache se offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { titulo: "Demandas", corpo: e.data?.text() ?? "" }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || "Demandas", {
      body: d.corpo || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: d.tag,
      data: { demanda_id: d.demanda_id },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data?.demanda_id;
  const destino = new URL(id ? `./?d=${id}` : "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (j.url.startsWith(self.registration.scope)) {
          j.postMessage({ abrir: id });
          return j.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
