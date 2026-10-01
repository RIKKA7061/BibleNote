// 오프라인 지원: 앱 파일과 성경 본문을 휴대폰에 저장해 두고 인터넷 없이도 열리게 한다.
// 앱 파일을 고치면 VERSION 을 올릴 것.
const VERSION = 'v1';
const CACHE = `biblenote-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/books.js',
  'js/ref.js',
  'js/store.js',
  'data/krv.json',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('biblenote-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 저장된 것을 먼저 보여주고, 뒤에서 새 버전을 받아 둔다 (다음 실행 때 반영).
// 성경 본문·아이콘은 바뀌지 않으므로 다시 받지 않는다 (데이터 절약).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './' : req;
  const fixed = /\/(data|icons)\//.test(url.pathname);
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      if (cached && fixed) return cached;
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return fresh;
    }),
  );
});
