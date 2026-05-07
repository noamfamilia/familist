import { db } from '@/lib/db'
import { isTombstoned, legacyDeletedAtToIso } from '@/lib/data/base_sync_fields'
import { perfLog } from '@/lib/startupPerfLog'

const GC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function deletedAtToEpochMs(deleted_at: unknown): number | null {
  const iso = legacyDeletedAtToIso(deleted_at)
  if (iso == null || iso === '') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function hasPresentLastSynced(last_synced_at: unknown): boolean {
  return typeof last_synced_at === 'string' && last_synced_at.length > 0
}

/**
 * Hard-deletes long-retained tombstones from Dexie mirrors so local DB stays bounded.
 * Only removes rows where `deleted_at` is older than 30 days and `last_synced_at` is set
 * (local row was reconciled with server metadata at least once after mirroring).
 */
export async function runLocalDexieGc(): Promise<{ removed: number }> {
  if (typeof window === 'undefined') return { removed: 0 }

  const cutoffMs = Date.now() - GC_RETENTION_MS
  const tables = [
    db.lists,
    db.list_users,
    db.items,
    db.members,
    db.item_member_state,
    db.profiles,
    db.feedback,
  ] as const

  let removed = 0

  await db.transaction('rw', tables, async () => {
    for (const table of tables) {
      const rows = await table.toArray()
      for (const row of rows) {
        const r = row as Record<string, unknown>
        const deletedAt = r.deleted_at
        if (!isTombstoned(deletedAt as string | null | undefined)) continue
        if (!hasPresentLastSynced(r.last_synced_at)) continue

        const deletedMs = deletedAtToEpochMs(deletedAt)
        if (deletedMs == null || deletedMs >= cutoffMs) continue

        const id = r.id
        if (typeof id !== 'string' || id.length === 0) continue

        await table.delete(id)
        removed += 1
      }
    }
  })

  if (removed > 0) {
    perfLog('localDexieGc', { removed })
  }
  return { removed }
}
