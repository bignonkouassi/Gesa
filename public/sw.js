/**
 * Ma Boutique — service worker.
 * Objectif : l'application s'ouvre et fonctionne entièrement hors ligne
 * (données locales), même sans réseau. Les assets sont servis en
 * « cache d'abord + mise à jour en arrière-plan », les navigations en
 * « réseau d'abord avec repli sur le shell ».
 */
const VERSION = 'ma-boutique-v1'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Jamais de interception pour les autres origines (API Supabase, etc.)
  if (url.origin !== self.location.origin) return

  // Navigation : réseau d'abord (page fraîche), repli sur le shell en cache
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(VERSION)
          await cache.put('./index.html', fresh.clone())
          return fresh
        } catch {
          const cached =
            (await caches.match(req)) ||
            (await caches.match('./')) ||
            (await caches.match('./index.html'))
          if (cached) return cached
          return new Response('Hors ligne', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
      })(),
    )
    return
  }

  // Assets : cache d'abord, puis mise à jour en arrière-plan
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION)
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => null)
      if (cached) {
        // Le réseau tourne en arrière-plan pour rafraîchir le cache
        network.catch(() => null)
        return cached
      }
      const res = await network
      if (res) return res
      return new Response('', { status: 504 })
    })(),
  )
})
