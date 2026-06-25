/* Jordan Stand Tall — offline service worker.
 *
 * Goal: after one online visit, the site (especially the emergency numbers and
 * the resource directories) keeps working with no signal. We use RUNTIME
 * caching rather than a precache manifest so it works with Vite's content-hashed
 * asset names without a build step:
 *   - HTML navigations  → network-first (always fresh online; cached shell offline)
 *   - static assets      → cache-first  (hashed files are immutable)
 *   - Supabase REST GETs → stale-while-revalidate (instant + refreshed online)
 *
 * Safe by design: online users always get fresh HTML, and any unhandled or
 * failed request falls through to the network/normal browser behaviour.
 */
const VERSION = 'v1'
const SHELL_CACHE = `jst-shell-${VERSION}`
const ASSET_CACHE = `jst-assets-${VERSION}`
const DATA_CACHE = `jst-data-${VERSION}`
const KEEP = [SHELL_CACHE, ASSET_CACHE, DATA_CACHE]

// Minimal app-shell precache (these names are stable, unlike hashed JS/CSS).
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/og.jpg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone())
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Supabase REST reads (the resource data) → stale-while-revalidate.
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/')) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE))
    return
  }

  // Leave all other cross-origin requests to the browser (fonts, Discord, etc.).
  if (url.origin !== self.location.origin) return

  // HTML navigations → network-first, fall back to the cached app shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    )
    return
  }

  // Same-origin static assets (hashed JS/CSS/images) → cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone()
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})
