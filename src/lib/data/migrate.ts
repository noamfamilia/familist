import { db } from '@/lib/db'
import { getActiveCacheUserId, getCachedList, getCachedLists } from '@/lib/cache'

const MIGRATION_KEY = 'dexie_migration_v1'
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function runLegacyStorageMigration() {
  if (typeof window === 'undefined') return
  const done = await db.meta.get(MIGRATION_KEY)
  if (done) return

  const userId = getActiveCacheUserId()
  if (!userId) {
    await db.meta.put({ key: MIGRATION_KEY, value: true, updatedAt: Date.now() })
    return
  }

  const cachedLists = getCachedLists(userId)?.lists ?? []
  await db.transaction('rw', db.lists, db.meta, async () => {
    for (const list of cachedLists) {
      await db.lists.put({
        ...list,
        userId,
        cachedAt: Date.now(),
        deleted_at: null,
      })
    }
    await db.meta.put({ key: MIGRATION_KEY, value: true, updatedAt: Date.now() })
  })

  await cleanupTombstones()
}

export async function migrateCachedListDetail(userId: string, listId: string) {
  const cached = getCachedList(userId, listId)
  if (!cached) return
  await db.transaction('rw', db.lists, db.items, db.members, db.item_member_state, async () => {
    if (cached.list) {
      await db.lists.put({
        ...cached.list,
        userId,
        cachedAt: Date.now(),
        deleted_at: null,
      })
    }

    for (const item of cached.items) {
      await db.items.put({
        ...item,
        userId,
        listId,
        deleted_at: null,
      })
      for (const state of Object.values(item.memberStates ?? {})) {
        await db.item_member_state.put({
          ...state,
          listId,
          deleted_at: null,
        })
      }
    }

    for (const member of cached.members) {
      await db.members.put({
        ...member,
        userId,
        listId,
        deleted_at: null,
      })
    }
  })
}

export async function cleanupTombstones() {
  const threshold = Date.now() - TOMBSTONE_TTL_MS
  const clean = async <T extends { deleted_at: number | null }>(rows: T[]) =>
    rows.filter((row) => (row.deleted_at ?? 0) > 0 && (row.deleted_at ?? 0) < threshold)

  await db.transaction(
    'rw',
    db.lists,
    db.items,
    db.members,
    db.item_member_state,
    async () => {
      const [lists, items, members, states] = await Promise.all([
        db.lists.toArray(),
        db.items.toArray(),
        db.members.toArray(),
        db.item_member_state.toArray(),
      ])

      for (const row of await clean(lists)) await db.lists.delete([row.userId, row.id])
      for (const row of await clean(items)) await db.items.delete([row.userId, row.listId, row.id])
      for (const row of await clean(members)) await db.members.delete([row.userId, row.listId, row.id])
      for (const row of await clean(states))
        await db.item_member_state.delete([row.listId, row.item_id, row.member_id])
    },
  )
}
