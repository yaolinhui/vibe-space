const CACHE_NAME = 'vibe-space-v2';
const ASSETS = [
  '/',
  '/workspace',
  '/index.html',
  '/setup.html',
  '/styles.css',
  '/client.js',
  '/setup.js',
  '/setup.css',
  '/i18n.js',
  '/theme-engine.js',
  '/theme-effects.js',
  '/task-analyzer.js',
  '/locales/en.json',
  '/locales/zh.json',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/xterm/xterm.js',
  '/xterm-addon-fit/xterm-addon-fit.js',
  '/xterm-css/xterm.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // API、WebSocket、附件等动态请求直接走网络
  if (
    request.url.includes('/api/') ||
    request.url.includes('/ws') ||
    request.url.includes('/attachments/') ||
    request.method !== 'GET'
  ) {
    return;
  }

  const url = new URL(request.url);
  const isAppAsset = ASSETS.includes(url.pathname) ||
    url.pathname.startsWith('/locales/');

  // 应用核心资源（HTML/CSS/JS/JSON）优先走网络，保证更新及时生效
  if (isAppAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 更新缓存
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // 离线时导航请求返回缓存的 workspace 页面
            if (request.mode === 'navigate') {
              return caches.match('/workspace');
            }
          });
        })
    );
    return;
  }

  // 其他静态资源优先缓存
  event.respondWith(
    caches.match(request).then((cached) => {
      return (
        cached ||
        fetch(request).catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('/workspace');
          }
        })
      );
    })
  );
});
