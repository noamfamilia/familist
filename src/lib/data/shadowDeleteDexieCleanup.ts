import Dexie from 'dexie'
import { db } from '@/lib/db'
import { getActiveCacheUserId, removeCachedList } from '@/lib/cache'

/** After Supabase hard-deletes an item, remove shadow tombstone + IMS rows from Dexie. */
export async function cleanupDexieAfterItemServerDeleted(itemId: string, listIdHint: string | null): Promise<void> {
  const row = await db.items.get(itemId)
  const listId = row?.list_id ?? listIdHint
  await db.transaction('rw', db.item_member_state, db.items, async () => {
    if (listId) {
      await db.item_member_state.filter((s) => s.list_id === listId && s.item_id === itemId).delete()
    } else {
      await db.item_member_state.filter((s) => s.item_id === itemId).delete()
    }
    await db.items.delete(itemId)
  })
}

/** After `delete_member` RPC succeeds, remove shadow member + all IMS rows from Dexie. */
export async function cleanupDexieAfterMemberServerDeleted(memberId: string): Promise<void> {
  await db.transaction('rw', db.item_member_state, db.members, async () => {
    await db.item_member_state.where('member_id').equals(memberId).delete()
    await db.members.delete(memberId)
  })
}

/** After Supabase hard-deletes a list, remove the full mirrored subtree from Dexie. */
export async function cleanupDexieAfterListServerDeleted(listId: string): Promise<void> {
  const uid = getActiveCacheUserId()
  await db.transaction(
    'rw',
    [db.item_member_state, db.items, db.members, db.list_users, db.lists, db.offline_route_markers],
    async () => {
      await db.item_member_state
        .where('[list_id+item_id]')
        .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
        .delete()
      await db.items.where('list_id').equals(listId).delete()
      await db.members.where('list_id').equals(listId).delete()
      await db.list_users.filter((lu) => lu.list_id === listId).delete()
      await db.offline_route_markers.filter((m) => m.list_id === listId).delete()
      await db.lists.delete(listId)
    },
  )
  removeCachedList(uid, listId)
}

/** After Supabase removes an item_member_state row, drop the local shadow row if present. */
export async function cleanupDexieAfterItemMemberStateServerDeleted(itemId: string, memberId: string): Promise<void> {
  await db.transaction('rw', db.item_member_state, async () => {
    await db.item_member_state.where('[item_id+member_id]').equals([itemId, memberId]).delete()
  })
}
