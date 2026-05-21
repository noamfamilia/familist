import { getActiveCacheUserId } from '@/lib/cache'
import { getLastAuthUserId } from '@/lib/authBootStorage'
import { isGuestId } from '@/lib/guestSession'
import { getSessionMode } from '@/lib/sessionPolicy'

/** Last authenticated user id for offline/catalog bootstrap (not a guest id). */
export function getCachedAuthenticatedUserId(
  bootstrapUserId?: string | null,
): string | null {
  const boot = bootstrapUserId ?? null
  if (boot && !isGuestId(boot)) return boot

  const lastAuth = getLastAuthUserId()
  if (lastAuth) return lastAuth

  const cached = getActiveCacheUserId()
  if (cached && !isGuestId(cached)) return cached

  if (getSessionMode() === 'resolving') return null

  return null
}
