import { getActiveCacheUserId } from '@/lib/cache'
import { isGuestId } from '@/lib/guestSession'

/** Last authenticated user id persisted for offline/catalog bootstrap (not a guest id). */
export function getCachedAuthenticatedUserId(
  bootstrapUserId?: string | null,
): string | null {
  const boot = bootstrapUserId ?? null
  if (boot && !isGuestId(boot)) return boot
  const cached = getActiveCacheUserId()
  if (cached && !isGuestId(cached)) return cached
  return null
}
