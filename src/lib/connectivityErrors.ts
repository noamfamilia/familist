/**
 * Classify transport / lie-fi style failures vs normal PostgREST / Postgres errors.
 * Used by hooks + server-work watchdog (do not flip global offline on application errors).
 */

export type ServerWorkOutcome = 'success' | 'application_error' | 'connectivity_failure'

const POSTGRES_APPLICATION_CODES = new Set([
  // integrity / validation
  '23505',
  '23503',
  '23502',
  '23514',
  '22P02',
  // permission
  '42501',
  'P0001',
  // not found (PostgREST)
  'PGRST116',
])

function readErrFields(err: unknown): { code: string; message: string; name: string } {
  if (err instanceof Error) {
    return { code: '', message: err.message || '', name: err.name || '' }
  }
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>
    const code = typeof o.code === 'string' ? o.code : ''
    const message = typeof o.message === 'string' ? o.message : String(o.message ?? '')
    const name = typeof o.name === 'string' ? o.name : ''
    return { code, message, name }
  }
  return { code: '', message: String(err ?? ''), name: '' }
}

/** Supabase / PostgREST client responses: `{ data, error }` where `error` may be null. */
export function resolveServerWorkOutcomeFromResult(result: unknown): 'success' | 'application_error' | 'connectivity_failure' {
  if (result && typeof result === 'object' && 'error' in result) {
    const err = (result as { error: unknown }).error
    if (err == null || err === false) return 'success'
    if (isLikelyConnectivityError(err)) return 'connectivity_failure'
    return 'application_error'
  }
  return 'success'
}

export function resolveServerWorkOutcomeFromThrown(err: unknown): 'application_error' | 'connectivity_failure' {
  return isLikelyConnectivityError(err) ? 'connectivity_failure' : 'application_error'
}

/**
 * True for transport-layer / browser failures that should drive global offline / recovery.
 * False for structured Postgres / PostgREST / RPC business errors (even if HTTP 4xx/5xx).
 */
export function isLikelyConnectivityError(err: unknown): boolean {
  const { code, message, name } = readErrFields(err)
  const c = code.trim()
  const m = message.toLowerCase()
  const n = name.toLowerCase()

  // Structured application errors from PostgREST / Postgres — never treat as connectivity.
  if (c && POSTGRES_APPLICATION_CODES.has(c)) return false
  if (/^PGRST\d+/i.test(c)) return false
  // SQLSTATE class 08 — connection exception (often surfaced as server-side connection loss).
  if (/^08[A-Z0-9]{3}$/i.test(c)) return true

  // Explicit transport / network-ish signals
  if (name === 'NetworkError' || n === 'networkerror') return true
  if (name === 'AbortError' || n === 'aborterror') return true
  if (m.includes('aborted') || m.includes('the user aborted')) return true
  if (m.includes('failed to fetch')) return true
  if (m.includes('networkerror')) return true
  if (m.includes('network request failed')) return true
  if (m.includes('load failed')) return true
  if (m.includes('fetch failed')) return true
  if (m.includes('timeout') || m.includes('timed out')) return true
  if (m.includes('err_network_changed')) return true
  if (m.includes('err_internet_disconnected')) return true
  if (m.includes('websocket') && (m.includes('failed') || m.includes('error') || m.includes('closed'))) return true
  if (m.includes('channel') && m.includes('error')) return true

  // Supabase-js style codes (when present)
  const cu = c.toUpperCase()
  if (cu === 'NETWORK_ERROR' || cu === 'FETCH_ERROR') return true

  if (err instanceof TypeError && m.includes('fetch')) return true

  return false
}
