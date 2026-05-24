import { getActiveCacheUserId } from '@/lib/cache'
import {
  findSupabaseAuthStorageKeys,
  getLastAuthUserId,
  hasUsableAuthBlob,
} from '@/lib/authBootStorage'
import { isGuestId } from '@/lib/guestSession'

export type LocalBootActor =
  | { mode: 'guest' }
  | { mode: 'account'; userId: string }

function parseJwtSub(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { sub?: unknown }
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null
  } catch {
    return null
  }
}

function readAccessTokenFromBlob(blob: Record<string, unknown>): string | null {
  if (typeof blob.access_token === 'string' && blob.access_token.length > 0) {
    return blob.access_token
  }
  const session = blob.session
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    const access = (session as Record<string, unknown>).access_token
    if (typeof access === 'string' && access.length > 0) return access
  }
  return null
}

/** User id from stored Supabase auth blob JWT (`sub`), when present. */
export function getUserIdFromAuthBlob(): string | null {
  if (typeof window === 'undefined') return null
  for (const key of findSupabaseAuthStorageKeys()) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const access = readAccessTokenFromBlob(parsed as Record<string, unknown>)
      if (!access) continue
      const sub = parseJwtSub(access)
      if (sub && !isGuestId(sub)) return sub
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * Synchronous boot actor for Dexie/UI: account only when a usable auth blob exists
 * and a non-guest user id can be resolved from the blob or aligned local hints.
 */
export function resolveLocalBootActor(): LocalBootActor {
  if (typeof window === 'undefined') return { mode: 'guest' }
  if (!hasUsableAuthBlob()) return { mode: 'guest' }

  const fromBlob = getUserIdFromAuthBlob()
  if (fromBlob) return { mode: 'account', userId: fromBlob }

  const lastAuth = getLastAuthUserId()
  if (lastAuth) return { mode: 'account', userId: lastAuth }

  const cached = getActiveCacheUserId()
  if (cached && !isGuestId(cached)) return { mode: 'account', userId: cached }

  return { mode: 'guest' }
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}
