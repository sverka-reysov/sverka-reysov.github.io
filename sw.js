// Сверка рейсов — работа без интернета после первого открытия сайта (13.10.2026).
// Страница: сначала сеть (новая версия приходит сразу), а без сети или если сеть молчит 4 с — сохранённая копия.
// Дополнения (extra/, иконки): сохранённое сразу, свежее подтягивается в фоне. Таблицы сюда не попадают — только файлы
// сайта. Если что-то пойдёт не так: заменить этот файл на одну строку self.registration.unregister() и опубликовать.
const CACHE = 'sverka-1';
const PAGE = new URL('./', self.registration.scope).href;
const CORE = [PAGE, 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const withTimeout = (p, ms) => new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error('timeout')), ms); p.then(r => { clearTimeout(t); ok(r); }, err => { clearTimeout(t); fail(err); }); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate' || url.href.split('?')[0] === PAGE || url.pathname.endsWith('/index.html');
  if (isPage) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        // по адресу, а не по самому запросу: запрос-переход (mode navigate) нельзя пересоздать с параметрами
        const r = await withTimeout(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 4000);
        if (r.ok) await cache.put(PAGE, r.clone());
        return r;
      } catch (err) {
        return (await cache.match(PAGE)) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
    if (hit) { e.waitUntil(fresh.catch(() => null)); return hit; }
    return fresh;
  })());
});
