import { getCachedAuthenticatedUserId } from '@/lib/authBootstrap'
import { isGuestId } from '@/lib/guestSession'
import { getSessionMode } from '@/lib/sessionPolicy'

/**
 * Active actor for Dexie reads/writes: authenticated user id, else local guest id.
 * While auth is hydrating, prefer cached authenticated id over guest id.
 */
export function resolveActiveUserId(
  userId: string | null | undefined,
  guestId: string | null | undefined,
  bootstrapUserId?: string | null | undefined,
): string | null {
  if (userId) return userId

  const boot = bootstrapUserId ?? null
  const mode = getSessionMode()

  if (mode === 'guest') {
    if (boot && isGuestId(boot)) return boot
    if (guestId && isGuestId(guestId)) return guestId
    return guestId ?? null
  }

  const cachedAuth = getCachedAuthenticatedUserId(bootstrapUserId)
  if (cachedAuth) return cachedAuth

  if (mode === 'resolving') {
    return boot && !isGuestId(boot) ? boot : null
  }

  if (guestId && isGuestId(guestId)) return guestId
  if (boot && isGuestId(boot)) return boot
  return guestId ?? boot ?? null
}
