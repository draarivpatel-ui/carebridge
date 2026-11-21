const namespace = `carebridge-shell:${self.registration.scope}:`;
// Bump the version whenever a cached file changes; install re-fetches them all.
const cacheName = `${namespace}v2`;
const home = new URL('./index.html', self.registration.scope).href;
const shell = [
  'index.html', 'styles.css', 'favicon.svg', 'src/app.js', 'src/binder.js', 'src/shortcuts.js',
  'src/clock.js', 'src/crypto-card.js', 'src/exports.js', 'src/meds.js',
  'src/presets.js', 'src/scheduler.js', 'src/triage.js',
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(namespace) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const href = url.origin + url.pathname;
  const navigate = event.request.mode === 'navigate' && (href === self.registration.scope || href === home);
  if (navigate || shell.includes(href)) {
    event.respondWith((async () =>
      (await (await caches.open(cacheName)).match(navigate ? home : href)) ?? fetch(event.request))());
  }
});
