import { resolveActiveUserId } from '@/lib/resolveActiveUserId'

/**
 * Owner id for local catalog/list mutations and outbound `sync_queue` payloads while
 * Supabase `user` may still be null (guest / offline bootstrap).
 */
export function resolveCatalogMutationUserId(
  userId: string | null | undefined,
  guestId: string | null | undefined,
  bootstrapUserId?: string | null | undefined,
): string | null {
  return resolveActiveUserId(userId, guestId, bootstrapUserId)
}
