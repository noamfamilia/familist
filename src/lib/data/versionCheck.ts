'use client'

import { APP_VERSION, parseSemver } from '@/lib/appVersion'
import { db } from '@/lib/db'
import Dexie from 'dexie'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { runListMirrorJob } from '@/lib/data/listMirror'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import {
  clearSyncQueueForList,
  reviveSyncQueueRowsForOutbound,
  waitForSyncQueueRowCompletion,
} from '@/lib/data/syncQueue'

const LAST_FORCED_RELOAD_MAJOR_META_KEY = 'lastForcedReloadMajor'

/** Set in `db.ts` Dexie schema v10 upgrade when migrating from a version below 10. */
export const PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID = 'pending_schema_10_full_mirror_reconcile'
async function removeRejectedLocalListCopy(userId: string, listId: string): Promise<void> {
  await clearSyncQueueForList(listId)
  await db.transaction('rw', [db.lists, db.items, db.members, db.item_member_state] as never, async () => {
    await db.lists.delete(listId)
    const [items, members, states] = await Promise.all([
      db.items.where('list_id').equals(listId).toArray(),
      db.members.where('list_id').equals(listId).toArray(),
      db.item_member_state.where('[list_id+item_id]').between([listId, Dexie.minKey], [listId, Dexie.maxKey]).toArray(),
    ])
    for (const row of items) await db.items.delete(row.id)
    for (const row of members) await db.members.delete(row.id)
    for (const row of states) await db.item_member_state.delete(row.id)
  })
}

async function pruneRejectedLocalListsOnMajorUpgrade(): Promise<void> {
  const pendingCreates = await db.sync_queue
    .where('kind')
    .equals('create')
    .filter((row) => row.entity === 'list')
    .toArray()

  if (pendingCreates.length === 0) return

  const allListRows = await db.lists.toArray()
  const userByListId = new Map<string, string>()
  for (const row of allListRows) userByListId.set(row.id, row.owner_id)

  for (const row of pendingCreates) {
    const listId = String(row.payload.id ?? '')
    const listName = String(row.payload.name ?? '')
    if (!listId || !listName) continue

    await reviveSyncQueueRowsForOutbound([row.id])
    const done = await waitForSyncQueueRowCompletion(row.id, { timeoutMs: 120_000 })
    const still = await db.sync_queue.get(row.id)
    if (done.ok || !still) continue

    if (still.status !== 'failed') continue

    const userId = userByListId.get(listId)
    if (!userId) {
      await db.sync_queue.delete(row.id)
      continue
    }
    await removeRejectedLocalListCopy(userId, listId)
    await db.sync_queue.delete(row.id)
  }
}

/**
 * After a Dexie upgrade to schema v10, pulls `get_list_data` for every non-tombstoned list once
 * (bypassing the normal mirror version gate) so `version` / `server_created_at` and other server
 * fields reconcile onto legacy local rows via `upsertListDataPayloadFromMirror` without wiping
 * local-only edits that the mirror path preserves.
 */
export async function runOneTimeReconcileAfterDexieSchemaBelow10Upgrade(userId: string): Promise<void> {
  if (typeof window === 'undefined' || !userId) return
  try {
    await db.open()
    if (db.verno < 10) return

    const pending = await db.meta.get(PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID)
    if (pending?.value !== true) return

    const lists = await db.lists.toArray()
    appendMutationDiagnostic(
      `[schema10-reconcile] start lists=${lists.filter((r) => !isTombstoned(r.deleted_at ?? null)).length}`,
    )
    for (const row of lists) {
      if (isTombstoned(row.deleted_at ?? null)) continue
      await runListMirrorJob(userId, row.id, { bypassVersionGate: true })
    }
    await db.meta.delete(PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID)
    appendMutationDiagnostic('[schema10-reconcile] done')
  } catch (e) {
    appendMutationDiagnostic(
      `[schema10-reconcile] error msg=${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export async function checkMajorVersionMismatchOnBoot(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    const currentMajor = parseSemver(APP_VERSION).major
    const listRows = await db.lists.toArray()

    let storedMajor = 0
    for (const row of listRows) {
      const major = parseSemver(row.app_version ?? '0.0.0').major
      if (major > storedMajor) storedMajor = major
    }

    const metaRow = await db.meta.get(LAST_FORCED_RELOAD_MAJOR_META_KEY)
    const lastForcedReloadMajor =
      typeof metaRow?.value === 'number' && Number.isFinite(metaRow.value) ? metaRow.value : 0

    if (currentMajor <= storedMajor || lastForcedReloadMajor >= currentMajor) return

    await pruneRejectedLocalListsOnMajorUpgrade()

    await db.meta.put({
      id: LAST_FORCED_RELOAD_MAJOR_META_KEY,
      value: currentMajor,
      updated_at: Date.now(),
    })

    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }

    window.location.reload()
  } catch {
    // Never block startup on version-check issues.
  }
}
