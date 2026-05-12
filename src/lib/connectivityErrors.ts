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

/** HTTP status from Supabase / PostgREST error objects, when present. */
export function readHttpStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const o = err as Record<string, unknown>
  const st = o.status
  if (typeof st === 'number' && Number.isFinite(st)) return st
  if (typeof st === 'string') {
    const n = parseInt(st, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

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

/**
 * Outbound sync: failures that must not use exponential backoff — drop the queue row.
 * - **Retries with backoff:** HTTP **429** or **5xx** only (see `useSyncStore` drain).
 * - **Terminal (no retry):** any other explicit HTTP status (400, 401, 403, 404, 422, 409, …).
 * - **Terminal (no retry):** no HTTP status but Postgres / PostgREST structured `code` (integrity, RLS, `PGRST*`, …).
 * - **Backoff:** unknown errors (e.g. client `throw new Error`) — not connectivity, not terminal above.
 */
export function isOutboundSyncTerminalError(err: unknown): boolean {
  if (isLikelyConnectivityError(err)) return false
  const http = readHttpStatus(err)
  if (http != null) {
    if (http === 429) return false
    if (http >= 500 && http < 600) return false
    return true
  }
  const { code } = readErrFields(err)
  const c = code.trim()
  if (c && POSTGRES_APPLICATION_CODES.has(c)) return true
  if (/^PGRST\d+/i.test(c)) return true
  return false
}

/** After this many failed outbound attempts (1-based next count), treat as terminal for per-list `sync_error` UI. */
export const LIST_USER_SYNC_ERROR_OUTBOUND_ATTEMPT_THRESHOLD = 5

/** Exponential delay for HTTP 429 / 5xx outbound failures (`attemptCount` is 1-based after increment). */
export function outboundExponentialBackoffDelayMs(attemptCount1Based: number): number {
  const exp = Math.min(Math.max(attemptCount1Based, 1), 10)
  return Math.min(300_000, 1000 * 2 ** exp)
}

/**
 * Bounded linear delay for application errors that are not terminal and not 429/5xx
 * (e.g. missing HTTP status on thrown `Error`).
 */
export function outboundLinearBackoffDelayMs(attemptCount1Based: number): number {
  const ac = Math.min(Math.max(attemptCount1Based, 1), 40)
  return Math.min(120_000, 3000 * ac)
}

/**
 * Delay before the next outbound sync attempt after a failure (non-connectivity).
 * Exponential only for HTTP 429 and 5xx; otherwise linear capped backoff.
 */
export function resolveOutboundRetryDelayMs(err: unknown, attemptCount1Based: number): number {
  const http = readHttpStatus(err)
  if (http === 429 || (http != null && http >= 500 && http < 600)) {
    return outboundExponentialBackoffDelayMs(attemptCount1Based)
  }
  return outboundLinearBackoffDelayMs(attemptCount1Based)
}

/**
 * Whether a failed outbound sync row should set Dexie `list_users.sync_error` (red list icon).
 * Excludes connectivity (transient). Includes auth/RLS and repeated application failures.
 */
export function shouldSetListUserSyncErrorAfterOutboundFailure(
  err: unknown,
  attemptCountBeforeThisFailure: number,
): boolean {
  if (isLikelyConnectivityError(err)) return false
  if (isOutboundSyncTerminalError(err)) return true
  if (isAuthPermissionOrRlsFailure(err)) return true
  const nextAttempt = attemptCountBeforeThisFailure + 1
  return nextAttempt >= LIST_USER_SYNC_ERROR_OUTBOUND_ATTEMPT_THRESHOLD
}

/** 401/403, JWT/session loss, RLS / permission — user-visible “cannot push” (e.g. removed from list). */
export function isAuthPermissionOrRlsFailure(err: unknown): boolean {
  const { code, message } = readErrFields(err)
  const m = message.toLowerCase()
  const c = code.trim().toUpperCase()

  const status = readHttpStatus(err)
  if (status === 401 || status === 403) return true

  if (c === '401' || c === '403') return true
  if (m.includes('jwt expired') || m.includes('invalid jwt') || m.includes('refresh token')) return true
  if (m.includes('permission denied')) return true
  if (m.includes('row-level security') || m.includes('violates row-level security')) return true
  if (c === '42501') return true
  if (m.includes(' not authorized') || m.includes('unauthorized')) return true
  if (m.includes('forbidden')) return true

  return false
}
