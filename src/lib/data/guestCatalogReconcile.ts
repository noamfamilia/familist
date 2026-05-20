import { db } from '@/lib/db'
import { maxIsoTimestamp } from '@/lib/data/listActivity'
import { isGuestId } from '@/lib/guestSession'
import { perfLog } from '@/lib/startupPerfLog'

/**
 * After sign-out, realign guest-owned Dexie rows that were mutated during the auth session:
 * restore `lists.owner_id` for guest owner memberships and merge `last_viewed` from the auth row.
 */
export async function reconcileGuestDexieAfterSignOut(
  guestId: string,
  formerAuthUserId: string | null | undefined,
): Promise<void> {
  if (!guestId || !isGuestId(guestId)) return
  if (!formerAuthUserId || isGuestId(formerAuthUserId)) return

  let ownerIdsRestored = 0
  let viewedMerged = 0

  await db.transaction('rw', db.lists, db.list_users, async () => {
    const guestMemberships = await db.list_users.where('user_id').equals(guestId).toArray()
    for (const guestLu of guestMemberships) {
      const list = await db.lists.get(guestLu.list_id)
      if (!list) continue

      if (guestLu.role === 'owner' && list.owner_id !== guestId) {
        await db.lists.update(list.id, { owner_id: guestId })
        ownerIdsRestored++
      }

      const authLu = await db.list_users
        .where('[list_id+user_id]')
        .equals([guestLu.list_id, formerAuthUserId])
        .first()
      if (!authLu?.last_viewed) continue

      const mergedViewed = maxIsoTimestamp(guestLu.last_viewed, authLu.last_viewed)
      if (mergedViewed !== guestLu.last_viewed) {
        await db.list_users.update(guestLu.id, { last_viewed: mergedViewed })
        viewedMerged++
      }
    }
  })

  if (ownerIdsRestored > 0 || viewedMerged > 0) {
    perfLog('auth/guest-catalog-reconcile', {
      guestId,
      formerAuthUserId,
      ownerIdsRestored,
      viewedMerged,
    })
  }
}
