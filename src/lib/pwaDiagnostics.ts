/**
 * Collects PWA / service-worker diagnostics for debugging origin/CDN/mobile mismatches.
 * Safe to call from client components only.
 */

export type PwaDiagnostics = {
  href: string
  origin: string
  userAgent: string
  buildId: string
  manifestStartUrl: string | null
  manifestScope: string | null
  manifestSameOriginAsPage: boolean | null
  /** URL passed to navigator.serviceWorker.register (no cache-buster; must match SW script). */
  swRegistrationUrl: string
  /** URL for manual fetch/open probe (cache-busted). */
  swProbeUrl: string
  swProbeOk: boolean
  swProbeStatus: number | null
  swProbeContentType: string | null
  /** First ~80 chars of body to distinguish JS vs HTML error pages. */
  swProbeSnippet: string | null
}

function getBuildId(): string {
  return process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
}

export function getSwProbeUrl(): string {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  const id = getBuildId()
  return `${origin}/sw.js?v=${encodeURIComponent(id)}`
}

export function getSwRegistrationUrl(): string {
  if (typeof window === 'undefined') return ''
  return new URL('/sw.js', window.location.origin).href
}

export async function collectPwaDiagnostics(): Promise<PwaDiagnostics> {
  const href = typeof window !== 'undefined' ? window.location.href : ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const buildId = getBuildId()

  let manifestStartUrl: string | null = null
  let manifestScope: string | null = null
  let manifestSameOriginAsPage: boolean | null = null

  try {
    const res = await fetch(`${origin}/manifest.json`, { cache: 'no-store' })
    if (res.ok) {
      const json = (await res.json()) as { start_url?: string; scope?: string }
      manifestStartUrl = typeof json.start_url === 'string' ? json.start_url : null
      manifestScope = typeof json.scope === 'string' ? json.scope : null
      if (manifestStartUrl) {
        try {
          const su = new URL(manifestStartUrl, origin)
          manifestSameOriginAsPage = su.origin === origin
        } catch {
          manifestSameOriginAsPage = null
        }
      }
    }
  } catch {
    // ignore manifest fetch errors
  }

  const swRegistrationUrl = getSwRegistrationUrl()
  const swProbeUrl = getSwProbeUrl()

  let swProbeOk = false
  let swProbeStatus: number | null = null
  let swProbeContentType: string | null = null
  let swProbeSnippet: string | null = null

  try {
    const res = await fetch(swProbeUrl, { cache: 'no-store', method: 'GET' })
    swProbeStatus = res.status
    swProbeContentType = res.headers.get('content-type')
    const text = await res.text()
    swProbeSnippet = text.slice(0, 80).replace(/\s+/g, ' ')
    swProbeOk = res.ok && /define|workbox|importScripts|self\./i.test(text)
  } catch {
    swProbeOk = false
  }

  return {
    href,
    origin,
    userAgent,
    buildId,
    manifestStartUrl,
    manifestScope,
    manifestSameOriginAsPage,
    swRegistrationUrl,
    swProbeUrl,
    swProbeOk,
    swProbeStatus,
    swProbeContentType,
    swProbeSnippet,
  }
}
