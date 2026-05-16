import { getActiveCacheUserId } from '@/lib/cache'

/**
 * Owner id for local catalog/list mutations and outbound `sync_queue` payloads while
 * Supabase `user` may still be null (offline bootstrap / cached session).
 */
export function resolveCatalogMutationUserId(
  userId: string | null | undefined,
  bootstrapUserId: string | null | undefined,
): string | null {
  return userId ?? bootstrapUserId ?? getActiveCacheUserId() ?? null
}
