// Fluxo: deixa o app abrir sem internet e mostra as notificações.
const CACHE = "fluxo-v2";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const proprio = u.origin === location.origin;
  const firebase = u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/");
  const fonte = u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (!proprio && !firebase && !fonte) return;
  if (firebase || fonte) {
    // Arquivos que não mudam: usa a cópia guardada e só baixa se não tiver.
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(x => { const c = x.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return x; })));
    return;
  }
  // O app: tenta a internet primeiro (pega a versão nova); sem internet, usa a cópia guardada.
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "Fluxo", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Fluxo", { body: d.body || "", tag: d.tag, icon: "icon-192.png", badge: "icon-192.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => { for (const c of cs) { if ("focus" in c) return c.focus(); } return self.clients.openWindow(url); }));
});
