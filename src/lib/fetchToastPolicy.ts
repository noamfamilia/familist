import { isLikelyConnectivityError, readHttpStatus } from '@/lib/connectivityErrors'
import { sessionExpiredToastFromError } from '@/lib/sessionExpiredToast'

const PERMISSION_POSTGRES_CODES = new Set(['42501', 'P0001'])

function messageLower(err: unknown): string {
  if (err instanceof Error) return err.message.toLowerCase()
  if (typeof err === 'string') return err.toLowerCase()
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m.toLowerCase()
  }
  return String(err ?? '').toLowerCase()
}

function readPostgresCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string') return c.trim()
  }
  return ''
}

/** Server rejected fetch (permissions / RLS), not a transport failure. */
export function isFetchPermissionRejection(err: unknown): boolean {
  const sessionToast = sessionExpiredToastFromError(err)
  if (sessionToast) return true

  const code = readPostgresCode(err)
  if (code && PERMISSION_POSTGRES_CODES.has(code)) return true
  if (/^PGRST\d+/i.test(code)) {
    const http = readHttpStatus(err)
    if (http === 401 || http === 403) return true
  }
  const http = readHttpStatus(err)
  if (http === 401 || http === 403) return true
  const m = messageLower(err)
  if (m.includes('permission denied')) return true
  if (m.includes('row-level security')) return true
  return false
}

/**
 * Toast copy for fetch failures. Returns null when the UI should stay silent
 * (connectivity / generic transport) or when there is no message.
 */
export function fetchFailureToastMessage(
  err: unknown,
  resourceLabel: string,
): string | null {
  if (err == null) return null
  if (isLikelyConnectivityError(err)) return null
  const m = messageLower(err)
  if (m.includes('failed to fetch') || m.includes('fetch failed') || m.includes('load failed')) {
    return null
  }

  const sessionToast = sessionExpiredToastFromError(err)
  if (sessionToast) return sessionToast

  if (isFetchPermissionRejection(err)) {
    return `Fetch ${resourceLabel} rejected by server`
  }
  return null
}

/** Prefer session-expired toast when summary or serverError indicates auth loss. */
export function resolveErrorToastMessage(summary: string, serverError?: unknown): string {
  const fromServer = sessionExpiredToastFromError(serverError)
  if (fromServer) return fromServer
  const fromSummary = sessionExpiredToastFromError(summary)
  if (fromSummary) return fromSummary
  return summary
}
