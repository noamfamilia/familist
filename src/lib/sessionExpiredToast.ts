import { readHttpStatus } from '@/lib/connectivityErrors'

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

/**
 * Session / JWT / refresh-token failures (not generic RLS or permission denied).
 * 3-digit codes identify the rejection kind in user-facing toasts.
 */
export type SessionExpiredToastCode =
  | '401'
  | '403'
  | '440'
  | '441'
  | '442'
  | '443'
  | '444'

export function formatSessionExpiredToast(code: SessionExpiredToastCode): string {
  return `[${code}] Session expired - sign in again`
}

export function classifySessionExpiredRejection(err: unknown): SessionExpiredToastCode | null {
  if (err == null) return null
  const m = messageLower(err)
  const http = readHttpStatus(err)
  const pgCode = readPostgresCode(err)

  if (
    m.includes('refresh token') ||
    m.includes('refresh_token_not_found') ||
    m.includes('invalid refresh token')
  ) {
    return '442'
  }

  if (m.includes('jwt expired') || (m.includes('jwt') && m.includes('expired'))) {
    return '440'
  }

  if (m.includes('invalid jwt') || (m.includes('jwt') && m.includes('invalid'))) {
    return '441'
  }

  if (m.includes('not authenticated') || m === 'unauthorized' || m.includes(' unauthorized')) {
    return '443'
  }

  if (/^PGRST\d+/i.test(pgCode) && (http === 401 || http === 403)) {
    return '444'
  }

  if (http === 401) return '401'
  if (http === 403) {
    if (m.includes('permission denied') || m.includes('row-level security')) return null
    return '403'
  }

  if (m.includes('jwt') || m.includes('bearer')) {
    return '441'
  }

  return null
}

/** User-facing toast when a failure is session/auth related; null otherwise. */
export function sessionExpiredToastFromError(err: unknown): string | null {
  const code = classifySessionExpiredRejection(err)
  if (!code) return null
  return formatSessionExpiredToast(code)
}
