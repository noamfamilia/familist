import { isGuestId } from '@/lib/guestSession'

export const LAST_AUTH_USER_ID_KEY = 'last_auth_user_id'

export type AuthPhase = 'resolving' | 'authenticated' | 'guest'

export type GuestEntryPath = 'A' | 'B' | 'C' | 'D' | null

let authPhaseGetter: (() => AuthPhase) | null = null

export function registerAuthPhaseGetter(fn: (() => AuthPhase) | null): void {
  authPhaseGetter = fn
}

export function getAuthPhase(): AuthPhase {
  return authPhaseGetter?.() ?? 'resolving'
}

export function getLastAuthUserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_AUTH_USER_ID_KEY)
    if (!raw || isGuestId(raw)) return null
    return raw
  } catch {
    return null
  }
}

export function setLastAuthUserId(userId: string): void {
  if (typeof window === 'undefined') return
  if (isGuestId(userId)) return
  try {
    localStorage.setItem(LAST_AUTH_USER_ID_KEY, userId)
  } catch {
    // ignore
  }
}

/** Find Supabase auth token keys in localStorage (sb-*-auth-token). */
export function findSupabaseAuthStorageKeys(): string[] {
  if (typeof window === 'undefined') return []
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) keys.push(k)
    }
  } catch {
    // ignore
  }
  return keys
}

function parseAuthBlobRaw(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return null
}

function blobHasUsableSession(blob: Record<string, unknown>): boolean {
  const refresh =
    typeof blob.refresh_token === 'string' && blob.refresh_token.length > 0
  if (refresh) return true

  const session = blob.session
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    const s = session as Record<string, unknown>
    const access =
      typeof s.access_token === 'string' && s.access_token.length > 0
    const rt = typeof s.refresh_token === 'string' && s.refresh_token.length > 0
    if (access || rt) return true
  }

  const access =
    typeof blob.access_token === 'string' && blob.access_token.length > 0
  return access
}

/** Storage-only: true when Supabase auth blob exists with refresh or session tokens. */
export function hasUsableAuthBlob(): boolean {
  const keys = findSupabaseAuthStorageKeys()
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw || raw.length === 0) continue
      const blob = parseAuthBlobRaw(raw)
      if (blob && blobHasUsableSession(blob)) return true
    } catch {
      // ignore
    }
  }
  return false
}
