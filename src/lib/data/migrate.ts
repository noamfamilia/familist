import { db } from '@/lib/db'
import { getActiveCacheUserId, getCachedList, getCachedLists } from '@/lib/cache'
import { normalizeDexieEntityRow } from '@/lib/data/base_sync_fields'
import { stableItemMemberStateDexieId } from '@/lib/data/syncQueue'

const MIGRATION_KEY = 'dexie_migration_v1'
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function tombstoneExpired(deleted_at: string | null): boolean {
  if (deleted_at == null || deleted_at.length === 0) return false
  const t = Date.parse(deleted_at)
  if (Number.isNaN(t)) return false
  return t < Date.now() - TOMBSTONE_TTL_MS
}

export async function runLegacyStorageMigration() {
  if (typeof window === 'undefined') return
  const done = await db.meta.get(MIGRATION_KEY)
  if (done) return

  const userId = getActiveCacheUserId()
  if (!userId) {
    await db.meta.put({ id: MIGRATION_KEY, value: true, updated_at: Date.now() })
    return
  }

  const cachedLists = getCachedLists(userId)?.lists ?? []
  await db.transaction('rw', db.lists, db.meta, async () => {
    for (const list of cachedLists) {
      const raw = { ...(list as unknown as Record<string, unknown>), cached_at: Date.now() }
      await db.lists.put(
        normalizeDexieEntityRow(raw, { legacyCreatedKey: 'created_at' }) as never,
      )
    }
    await db.meta.put({ id: MIGRATION_KEY, value: true, updated_at: Date.now() })
  })

  await cleanupTombstones()
}

export async function migrateCachedListDetail(userId: string, listId: string) {
  const cached = getCachedList(userId, listId)
  if (!cached) return
  await db.transaction('rw', db.lists, db.items, db.members, db.item_member_state, async () => {
    if (cached.list) {
      const raw = { ...(cached.list as unknown as Record<string, unknown>), cached_at: Date.now() }
      await db.lists.put(normalizeDexieEntityRow(raw, { legacyCreatedKey: 'created_at' }) as never)
    }

    for (const item of cached.items) {
      const raw = { ...(item as unknown as Record<string, unknown>) }
      await db.items.put(normalizeDexieEntityRow(raw, { legacyCreatedKey: 'created_at' }) as never)
      for (const state of Object.values(item.memberStates ?? {})) {
        const s = state as unknown as Record<string, unknown>
        const itemId = String(s.item_id ?? item.id)
        const memberId = String(s.member_id ?? '')
        const rowId =
          itemId && memberId ? await stableItemMemberStateDexieId(itemId, memberId) : crypto.randomUUID()
        await db.item_member_state.put(
          normalizeDexieEntityRow(
            {
              id: rowId,
              ...s,
              list_id: listId,
            },
            { serverFallback: typeof s.updated_at === 'string' ? (s.updated_at as string) : undefined },
          ) as never,
        )
      }
    }

    for (const member of cached.members) {
      const raw = { ...(member as unknown as Record<string, unknown>) }
      await db.members.put(normalizeDexieEntityRow(raw, { legacyCreatedKey: 'created_at' }) as never)
    }
  })
}

export async function cleanupTombstones() {
  const clean = <T extends { id: string; deleted_at: string | null }>(rows: T[]) =>
    rows.filter((row) => tombstoneExpired(row.deleted_at))

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

      for (const row of clean(lists)) await db.lists.delete(row.id)
      for (const row of clean(items)) await db.items.delete(row.id)
      for (const row of clean(members)) await db.members.delete(row.id)
      for (const row of clean(states)) await db.item_member_state.delete(row.id)
    },
  )
}
