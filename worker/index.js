/* eslint-env serviceworker */
/* eslint-disable no-restricted-globals */

const SW_STATUS_REQUEST = 'SW_OFFLINE_ASSETS_STATUS_REQUEST'
const SW_STATUS_RESPONSE = 'SW_OFFLINE_ASSETS_STATUS_RESPONSE'

async function hasAnyCachedRequestMatching(predicate) {
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
  const hasManifest = await hasAnyCachedRequestMatching((url) => url.pathname === '/manifest.json')
  const hasNextStaticChunk = await hasAnyCachedRequestMatching((url) => url.pathname.includes('/_next/static/'))

  return hasAppShell && hasManifest && hasNextStaticChunk
}

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type !== SW_STATUS_REQUEST) return

  void computeOfflineAssetsReady().then((ready) => {
    event.source?.postMessage({
      type: SW_STATUS_RESPONSE,
      ready,
      detail: {
        note: 'Determined by cached shell, manifest, and next static chunk',
      },
    })
  }).catch(() => {
    event.source?.postMessage({
      type: SW_STATUS_RESPONSE,
      ready: false,
      detail: {
        note: 'Failed to evaluate cache readiness',
      },
    })
  })
})

