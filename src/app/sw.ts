/// <reference lib="webworker" />

import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist'
import { defaultCache } from '@serwist/next/worker'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const SW_STATUS_REQUEST = 'SW_OFFLINE_ASSETS_STATUS_REQUEST'
const SW_STATUS_RESPONSE = 'SW_OFFLINE_ASSETS_STATUS_RESPONSE'

/**
 * Same-origin navigations that may use `navigateFallback` (precached app shell at `/`).
 * Regexes run against `pathname + search` (Serwist `NavigationRoute`).
 * Dynamic list URLs are not precached individually; uncached `/list/*` navigations
 * receive the main `/` document so the client can boot and hydrate from the URL.
 */
const navigateFallbackAllowlist = [
  /^\/(\?.*)?$/, // `/`, `/?…`
  /^\/list(?:\/|\?|$)/, // `/list`, `/list/…`, `/list?…`
  /^\/import(?:\/|\?|$)/,
  /^\/profile(?:\/|\?|$)/,
  /^\/auth\//,
  /^\/reset(?:\/|\?|$)/,
  /^\/~offline(?:\/|\?|$)/,
]

/** Denylist wins over allowlist; keep API and Next internals off the HTML shell. */
const navigateFallbackDenylist = [/^\/api\//, /^\/_next\//]

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    navigateFallback: '/',
    navigateFallbackAllowlist,
    navigateFallbackDenylist,
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin, request }) =>
        sameOrigin &&
        request.method === 'GET' &&
        url.pathname === '/api/reachability',
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
})

serwist.addEventListeners()

/**
 * Clean stale offline-wall assets from older deployments so navigation cannot
 * land on "/~offline" once we're on the banner-first local UI.
 */
async function purgeLegacyOfflineWallCacheEntries() {
  const cacheNames = await caches.keys()
  const targets = ['/~offline']
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName)
    const requests = await cache.keys()
    for (const req of requests) {
      const url = new URL(req.url)
      if (targets.includes(url.pathname)) {
        await cache.delete(req)
      }
    }
  }
}

/**
 * Do not delete `serwist-*` caches here: Serwist already prunes precache on activate.
 * Wiping every `serwist-*` bucket removed the precache immediately after install, breaking
 * offline refresh and the precached app shell (`/`).
 */
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(purgeLegacyOfflineWallCacheEntries())
})

async function hasAnyCachedRequestMatching(predicate: (url: URL) => boolean) {
  const cacheNames = await caches.keys()
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName)
    const requests = await cache.keys()
    if (requests.some((r) => predicate(new URL(r.url)))) return true
  }
  return false
}

async function computeOfflineAssetsReady() {
  const hasAppShell = await hasAnyCachedRequestMatching((url) => url.pathname === '/')
  const hasManifest = await hasAnyCachedRequestMatching((url) =>
    url.pathname === '/manifest.webmanifest' || url.pathname === '/manifest.json',
  )
  const hasNextStaticChunk = await hasAnyCachedRequestMatching((url) =>
    url.pathname.includes('/_next/static/'),
  )
  return hasAppShell && hasManifest && hasNextStaticChunk
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data || {}
  if (data.type !== SW_STATUS_REQUEST) return

  void computeOfflineAssetsReady()
    .then((ready) => {
      event.source?.postMessage({
        type: SW_STATUS_RESPONSE,
        ready,
        detail: {
          note: 'Determined by cached shell, manifest, and next static chunk',
        },
      })
    })
    .catch(() => {
      event.source?.postMessage({
        type: SW_STATUS_RESPONSE,
        ready: false,
        detail: {
          note: 'Failed to evaluate cache readiness',
        },
      })
    })
})
