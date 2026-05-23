/**
 * Fetch sw.js (cache-busted), parse precache + SW deps, probe each URL.
 * Used from PWA debug helpers (?debugPwa=1); failures log to the browser console only.
 */

const PRECACHE_VERIFY_SESSION_KEY = 'familist_precache_verify_v1'

/** Returns true the first time per tab session; then false (avoids hammering the network). */
export function consumePrecacheVerifySessionOnce(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return true
    if (sessionStorage.getItem(PRECACHE_VERIFY_SESSION_KEY) === '1') return false
    sessionStorage.setItem(PRECACHE_VERIFY_SESSION_KEY, '1')
    return true
  } catch {
    return true
  }
}

function looksLikeHtml(body: string, maxInspect = 800): boolean {
  const s = body.slice(0, maxInspect).trimStart()
  return s.startsWith('<!') || /^<html[\s>]/i.test(s) || s.startsWith('<HTML')
}

function toAbsolute(origin: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${p}`
}

/** Extract root-relative paths from generated serwist/workbox sw.js text. */
export function extractUrlsFromSwScript(swText: string): {
  precachePaths: string[]
  importScriptPaths: string[]
  workboxPath: string | null
} {
  const precachePaths: string[] = []
  const seen = new Set<string>()
  const urlRe = /url:"(\/[^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(swText)) !== null) {
    const u = m[1]
    if (!seen.has(u)) {
      seen.add(u)
      precachePaths.push(u)
    }
  }

  const importScriptPaths: string[] = []
  const impRe = /importScripts\("([^"]+)"\)/g
  while ((m = impRe.exec(swText)) !== null) {
    const raw = m[1]
    const p = raw.startsWith('/') ? raw : `/${raw}`
    if (!seen.has(p)) {
      seen.add(p)
      importScriptPaths.push(p)
    }
  }

  let workboxPath: string | null = null
  const defMatch = swText.match(/define\(\["\.\/(workbox-[^"]+)"\]/)
  if (defMatch) {
    const base = defMatch[1]
    workboxPath = base.endsWith('.js') ? `/${base}` : `/${base}.js`
  }

  return { precachePaths, importScriptPaths, workboxPath }
}

type CheckResult = { path: string; ok: true } | { path: string; ok: false; absolute: string; detail: string }

function formatFailBlock(path: string, absolute: string, detail: string): string {
  return `[precache-verify] FAIL\npath=${path}\nabsolute=${absolute}\n${detail}`
}

async function checkOneUrl(origin: string, path: string): Promise<CheckResult> {
  const abs = toAbsolute(origin, path)
  try {
    const res = await fetch(abs, { cache: 'no-store', method: 'GET' })
    const ctRaw = res.headers.get('content-type') || 'none'
    const ct = ctRaw.toLowerCase()
    const text = await res.text()
    const snip = text.slice(0, 200).replace(/\s+/g, ' ')

    if (!res.ok) {
      return {
        path,
        ok: false,
        absolute: abs,
        detail: `status=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
      }
    }

    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : ''

    if (ext === '.js') {
      if (looksLikeHtml(text)) {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=body looks like HTML (not JS)\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
      if (
        ct &&
        !ct.includes('javascript') &&
        !ct.includes('ecmascript') &&
        !ct.includes('text/plain') &&
        !ct.includes('octet-stream')
      ) {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=unexpected content-type for .js\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
    } else if (ext === '.css') {
      if (looksLikeHtml(text)) {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=body looks like HTML (not CSS)\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
      if (ct && !ct.includes('css') && !ct.includes('text/plain') && !ct.includes('octet-stream')) {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=unexpected content-type for .css\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
    } else if (ext === '.json') {
      if (looksLikeHtml(text)) {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=body looks like HTML (not JSON)\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
      try {
        JSON.parse(text)
      } catch {
        return {
          path,
          ok: false,
          absolute: abs,
          detail: `reason=JSON.parse failed\nstatus=${res.status}\ncontent-type=${ctRaw}\nsnippet=${snip}`,
        }
      }
    }

    return { path, ok: true }
  } catch (e) {
    return {
      path,
      ok: false,
      absolute: abs,
      detail: `reason=fetch threw\nerror=${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

const BATCH = 8

async function runBatched(origin: string, paths: string[]): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  for (let i = 0; i < paths.length; i += BATCH) {
    const chunk = paths.slice(i, i + BATCH)
    const part = await Promise.all(chunk.map((p) => checkOneUrl(origin, p)))
    out.push(...part)
  }
  return out
}

export type PrecacheVerifyStats = { totalChecks: number; failCount: number; okCount: number }

/** Fetches /sw.js?v=<buildId>, parses precache + deps, checks every path + core SW URLs. */
export async function runSwPrecacheVerification(): Promise<PrecacheVerifyStats | null> {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return null

  const origin = window.location.origin
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
  const swBusted = `${origin}/sw.js?v=${encodeURIComponent(buildId)}`

  let swText: string
  try {
    const res = await fetch(swBusted, { cache: 'no-store', method: 'GET' })
    const ct = res.headers.get('content-type') || ''
    swText = await res.text()
    if (!res.ok) {
      console.warn(`[precache-verify] FAILED to fetch sw.js: HTTP ${res.status} ct=${ct}`)
      return null
    }
    if (looksLikeHtml(swText)) {
      console.warn('[precache-verify] sw.js body looks like HTML (not a service worker script)')
      return null
    }
  } catch (e) {
    console.warn(
      `[precache-verify] FAILED to fetch sw.js: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }

  const { precachePaths, importScriptPaths, workboxPath } = extractUrlsFromSwScript(swText)

  const corePaths = ['/sw.js', `/sw.js?v=${encodeURIComponent(buildId)}`]
  if (workboxPath) corePaths.push(workboxPath)
  for (const p of importScriptPaths) {
    if (!corePaths.includes(p)) corePaths.push(p)
  }

  const allPaths = [...new Set([...corePaths, ...precachePaths])]

  const results = await runBatched(origin, allPaths)
  const failures = results.filter((r): r is Extract<CheckResult, { ok: false }> => !r.ok)
  const okCount = results.length - failures.length

  for (const f of failures) {
    if (!f.ok) {
      console.warn(formatFailBlock(f.path, f.absolute, f.detail))
    }
  }

  if (failures.length > 0) {
    console.warn(
      `[precache-verify] ok=${okCount} fail=${failures.length} total=${results.length}`,
    )
  }

  return {
    totalChecks: results.length,
    failCount: failures.length,
    okCount,
  }
}
