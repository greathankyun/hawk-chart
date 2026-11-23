// App-shell cache: the UI works offline; market data always goes to the network.
const VERSION = 'hawk-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/data.js', 'js/indicators.js', 'js/drawings.js', 'js/config.js', 'js/markets.js',
  'js/render.js', 'js/features.js', 'js/ui.js', 'js/script.js', 'js/conditions.js', 'js/condui.js', 'js/alerts.js', 'js/replay.js', 'js/vp.js',
  'js/layout.js', 'js/templates.js', 'js/scriptui.js', 'js/screener.js', 'js/backtest.js', 'js/cloud.js',
  'vendor/lightweight-charts.standalone.production.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network-first so updates arrive immediately, cache as offline fallback
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
