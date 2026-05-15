import { isLikelyConnectivityError, readHttpStatus } from '@/lib/connectivityErrors'

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
  if (m.includes('jwt') && m.includes('expired')) return true
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
  if (isFetchPermissionRejection(err)) {
    return `Fetch ${resourceLabel} rejected by server`
  }
  return null
}
