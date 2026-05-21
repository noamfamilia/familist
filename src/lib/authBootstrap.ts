import { getActiveCacheUserId } from '@/lib/cache'
import { getLastAuthUserId } from '@/lib/authBootStorage'
import { isGuestId } from '@/lib/guestSession'
import { getSessionMode } from '@/lib/sessionPolicy'

/**
 * Auth user id hints for catalog/bootstrap while session is resolving (not guest).
 * Returns null in guest mode so sign-out does not keep showing the prior user's lists.
 */
export function getCachedAuthenticatedUserId(
  bootstrapUserId?: string | null,
): string | null {
  if (getSessionMode() === 'guest') return null

  const boot = bootstrapUserId ?? null
  if (boot && !isGuestId(boot)) return boot

  if (getSessionMode() !== 'resolving') {
    const cached = getActiveCacheUserId()
    if (cached && !isGuestId(cached)) return cached
    return null
  }

  const lastAuth = getLastAuthUserId()
  if (lastAuth) return lastAuth

  const cached = getActiveCacheUserId()
  if (cached && !isGuestId(cached)) return cached

  return null
}

/** Initial bootstrapUserId before AuthProvider effects run. */
export function getInitialBootstrapUserId(): string | null {
  if (typeof window === 'undefined') return null

  const cached = getActiveCacheUserId()
  if (cached && isGuestId(cached)) return cached

  if (cached && !isGuestId(cached)) return cached

  const lastAuth = getLastAuthUserId()
  if (lastAuth) return lastAuth

  return null
}
