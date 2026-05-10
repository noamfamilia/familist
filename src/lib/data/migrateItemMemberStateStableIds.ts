import { db, type DbItemMemberStateRow } from '@/lib/db'
import { stableItemMemberStateDexieId } from '@/lib/data/syncQueue'

/** One-shot Dexie data migration: collapse legacy random `item_member_state.id` rows to deterministic IDs. */
export const ITEM_MEMBER_STATE_STABLE_ID_MIGRATION_META_ID =
  'dexie_migration_item_member_state_stable_ids_v1'

function pairKey(itemId: string, memberId: string): string {
  return `${itemId}\t${memberId}`
}

function pickCanonicalRow(rows: DbItemMemberStateRow[]): DbItemMemberStateRow {
  return [...rows].sort((a, b) => {
    const tb = Date.parse(b.updated_at)
    const ta = Date.parse(a.updated_at)
    if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta
    if (Number.isFinite(tb) && !Number.isFinite(ta)) return -1
    if (!Number.isFinite(tb) && Number.isFinite(ta)) return 1
    return (b.version ?? 1) - (a.version ?? 1)
  })[0]!
}

/**
 * For every `(item_id, member_id)` group: delete all Dexie rows for that pair and insert one row
 * whose `id` is `stableItemMemberStateDexieId`, using the newest row as the field source.
 * No-op for pairs that already have exactly one row with the stable id.
 */
export async function runItemMemberStateStableIdMigration(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    await db.open()
  } catch {
    return
  }

  const done = await db.meta.get(ITEM_MEMBER_STATE_STABLE_ID_MIGRATION_META_ID)
  if (done) return

  const all = await db.item_member_state.toArray()
  if (all.length === 0) {
    await db.meta.put({ id: ITEM_MEMBER_STATE_STABLE_ID_MIGRATION_META_ID, value: true, updated_at: Date.now() })
    return
  }

  const byPair = new Map<string, DbItemMemberStateRow[]>()
  for (const row of all) {
    const key = pairKey(row.item_id, row.member_id)
    const list = byPair.get(key)
    if (list) list.push(row)
    else byPair.set(key, [row])
  }

  for (const [, rows] of byPair) {
    if (rows.length === 0) continue
    const { item_id: itemId, member_id: memberId } = rows[0]!
    const stableId = await stableItemMemberStateDexieId(itemId, memberId)
    if (rows.length === 1 && rows[0]!.id === stableId) continue

    const winner = pickCanonicalRow(rows)
    const next: DbItemMemberStateRow = {
      ...winner,
      id: stableId,
      item_id: itemId,
      member_id: memberId,
      list_id: winner.list_id,
    }

    await db.transaction('rw', db.item_member_state, async () => {
      for (const r of rows) {
        await db.item_member_state.delete(r.id)
      }
      await db.item_member_state.put(next)
    })
  }

  await db.meta.put({
    id: ITEM_MEMBER_STATE_STABLE_ID_MIGRATION_META_ID,
    value: true,
    updated_at: Date.now(),
  })
}
