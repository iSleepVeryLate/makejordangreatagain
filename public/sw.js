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
const VERSION = 'v2'
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

// A cache lookup that can never reject (a corrupt CacheStorage shouldn't take the
// whole fetch handler down). Always resolves to a Response or undefined.
function safeMatch(request) {
  return caches.match(request).catch(() => undefined)
}

// A last-resort Response so event.respondWith() is never handed undefined or a
// rejected promise (either one shows up as "FetchEvent … network error").
function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Offline' })
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) cache.put(request, res.clone()).catch(() => {})
          return res
        })
        // offline with nothing cached → a benign 504, never a rejected promise
        .catch(() => cached || offlineResponse())
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
  // The fallback chain ALWAYS resolves to a Response (cached shell → root → a tiny
  // inline offline page) so a deep link like /monopoly/:id can never reject.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(async () => {
          const shell = (await safeMatch('/index.html')) || (await safeMatch('/'))
          return (
            shell ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem">Offline — reconnect to keep playing.</body>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            )
          )
        }),
    )
    return
  }

  // Same-origin static assets (hashed JS/CSS/images) → cache-first. A failed fetch
  // (offline, network reset, CORS) resolves to the cached copy if any, else a benign
  // 504 — never a rejected promise (that was the "Failed to fetch at sw.js" error).
  event.respondWith(
    safeMatch(request)
      .then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
              const copy = res.clone()
              caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {})
            }
            return res
          }),
      )
      .catch(() => offlineResponse()),
  )
})
