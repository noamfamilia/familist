import { getActiveCacheUserId } from '@/lib/cache'
import { isGuestId } from '@/lib/guestSession'
import { getSessionMode } from '@/lib/sessionPolicy'

/**
 * Active actor for Dexie reads/writes: authenticated user id, else local guest id.
 */
export function resolveActiveUserId(
  userId: string | null | undefined,
  guestId: string | null | undefined,
  bootstrapUserId?: string | null | undefined,
): string | null {
  if (userId) return userId
  if (guestId && isGuestId(guestId)) return guestId
  if (getSessionMode() === 'guest') {
    const boot = bootstrapUserId ?? null
    if (boot && isGuestId(boot)) return boot
    return guestId ?? null
  }
  const boot = bootstrapUserId ?? null
  if (boot && !isGuestId(boot)) return boot
  if (boot && isGuestId(boot)) return boot
  const cached = getActiveCacheUserId()
  if (cached && !isGuestId(cached)) return cached
  return guestId ?? boot ?? null
}
