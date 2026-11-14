// Service worker de Steal a Masterpiece : jeu disponible hors connexion, API jamais mise en cache.
const VERSION = 'sam-v11';
// Le prototype /museum/ n'existe plus ; le personnage humain est le modèle principal (le robot sert de secours).
const CORE = ['./', './game/', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './models/human_male.glb', './models/robot.glb'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'sam-fonts').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('./')) ?? Response.error();
  }
}

async function cacheFirst(request, name = VERSION) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

/**
 * Cache puis réseau en arrière-plan : réponse immédiate depuis le cache, et la copie est rafraîchie pour la prochaine fois.
 * Pour les modèles 3D et les œuvres, dont le nom ne change pas quand le fichier change (avant : jamais rafraîchis).
 */
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) ?? Response.error();
}

// Notifications push (vol en cours, œuvre volée, gardes, ventes, caisse pleine)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Steal a Masterpiece', body: event.data ? event.data.text() : '' };
  }
  const url = new URL(data.url || './game/', self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title || 'Steal a Masterpiece', {
      body: data.body || '',
      tag: data.tag || 'sam',
      renotify: true,
      icon: new URL('./icons/icon-192.png', self.registration.scope).href,
      badge: new URL('./icons/icon-192.png', self.registration.scope).href,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || new URL('./game/', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(url));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Polices Google : mises en cache pour le hors-ligne
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, 'sam-fonts'));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // données live : toujours le réseau

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request)); // fichiers au nom versionné (hash) : ils ne changent jamais
  } else if (['/icons/', '/models/', '/art/'].some((p) => url.pathname.includes(p))) {
    event.respondWith(staleWhileRevalidate(event, request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
