import { db } from '@/lib/db'
import type { DbSyncQueueRow } from '@/lib/db'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { bumpListReconcileGeneration } from '@/lib/data/listReconcilePolicy'
import { syncListDetail, syncLists } from '@/lib/data/sync'
import {
  hasOtherPendingOutboundForList,
  listIdsTouchingOutboundRow,
} from '@/lib/data/syncQueueListScope'

function isVirtualUserListKey(listId: string): boolean {
  return listId.startsWith('user:')
}

function outboundRpcMethod(row: DbSyncQueueRow): string {
  if (row.kind !== 'rpc') return ''
  return String((row.payload as { method?: string }).method ?? '')
}

/** Home-catalog RPCs that only change `list_users` (sort_order / label) — `get_user_lists` is enough. */
export function isCatalogOnlyOutboundVerifyRow(row: DbSyncQueueRow): boolean {
  const method = outboundRpcMethod(row)
  return method === 'reorderListUsers' || method === 'bulkPatchListLabels'
}

export function shouldSkipListDetailVerifyForOutboundRow(row: DbSyncQueueRow): boolean {
  if (row.kind === 'patch') return true
  if (row.kind === 'rpc') {
    const method = outboundRpcMethod(row)
    if (method === 'leaveList' || method === 'patchListUser') return true
    if (isCatalogOnlyOutboundVerifyRow(row)) return true
  }
  return false
}

/** Rows that remove local list data — never pull list detail afterward. */
function isLeaveOrListDeleteOutboundRow(row: DbSyncQueueRow): boolean {
  if (row.kind === 'delete' && row.entity === 'list') return true
  if (row.kind === 'rpc' && String((row.payload as { method?: string }).method ?? '') === 'leaveList') {
    return true
  }
  return false
}

export function shouldDeferOutboundVerify(
  row: DbSyncQueueRow,
  queue: readonly DbSyncQueueRow[],
): boolean {
  const touched = listIdsTouchingOutboundRow(row).filter((id) => !isVirtualUserListKey(id))
  return touched.some((listId) => hasOtherPendingOutboundForList(queue, listId, row.id))
}

export type QuiescentFlushDecision = {
  run: boolean
  /** Skip catalog RPC when immediate verify already refreshed it (e.g. last row was patchListUser). */
  skipCatalog?: boolean
  /** Home-catalog RPC: only `get_user_lists`, never per-list `get_list_data`. */
  catalogOnly?: boolean
}

/**
 * Whether to run quiescent flush after a successful row delete.
 * - Deferred rows: flush later when the list is quiet (immediate verify was skipped).
 * - Prefs-only rows (patchListUser): flush list detail only; catalog ran in immediate verify.
 * - Catalog-only rows (reorderListUsers, bulkPatchListLabels): one `get_user_lists` only.
 * - Content rows with immediate full verify: no flush (avoids duplicate get_list_data).
 * - leaveList / list delete: never flush.
 */
export function quiescentFlushDecisionAfterRow(
  row: DbSyncQueueRow,
  queueBeforeDelete: readonly DbSyncQueueRow[],
): QuiescentFlushDecision {
  if (isLeaveOrListDeleteOutboundRow(row)) return { run: false }
  if (shouldDeferOutboundVerify(row, queueBeforeDelete)) {
    return isCatalogOnlyOutboundVerifyRow(row) ? { run: true, catalogOnly: true } : { run: true }
  }
  if (isCatalogOnlyOutboundVerifyRow(row)) {
    return { run: true, catalogOnly: true }
  }
  if (shouldSkipListDetailVerifyForOutboundRow(row)) {
    return { run: true, skipCatalog: true }
  }
  return { run: false }
}

/** `get_user_lists` only — for reorder / bulk label RPCs (no items or members). */
export async function flushQuiescentCatalogOnlyVerification(userId: string): Promise<void> {
  try {
    appendMutationDiagnostic('[sync-verify] quiescent catalog-only flush')
    await syncLists(userId, 'Post-mutation verification: list catalog')
  } catch (e) {
    appendMutationDiagnostic(
      `[sync-verify] quiescent catalog-only flush failed msg=${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

/** One catalog + list detail fetch after all outbound work for `listId` has drained. */
export async function flushQuiescentListVerification(
  userId: string,
  listId: string,
  options?: { skipCatalog?: boolean; skipListDetail?: boolean; force?: boolean },
): Promise<void> {
  if (isVirtualUserListKey(listId)) return
  const queue = await db.sync_queue.toArray()
  if (hasOtherPendingOutboundForList(queue, listId)) return

  try {
    appendMutationDiagnostic(
      `[sync-verify] quiescent flush listId=${listId} skipCatalog=${options?.skipCatalog ? 1 : 0} skipListDetail=${options?.skipListDetail ? 1 : 0} force=${options?.force ? 1 : 0}`,
    )
    if (!options?.skipListDetail) {
      bumpListReconcileGeneration(listId, 'post-verify-quiescent')
    }
    if (!options?.skipCatalog) {
      await syncLists(userId, 'Post-mutation verification: list catalog')
    }
    if (!options?.skipListDetail) {
      await syncListDetail(userId, listId, 'Post-mutation verification: list detail')
    }
  } catch (e) {
    appendMutationDiagnostic(
      `[sync-verify] quiescent flush failed listId=${listId} msg=${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export async function maybeFlushQuiescentForListIds(
  userId: string,
  listIds: string[],
  completedRow: DbSyncQueueRow | null,
  queueBeforeDelete: readonly DbSyncQueueRow[],
  options?: { force?: boolean },
): Promise<void> {
  const decision =
    options?.force || completedRow == null
      ? { run: true as const }
      : quiescentFlushDecisionAfterRow(completedRow, queueBeforeDelete)
  if (!decision.run) return

  if (decision.catalogOnly) {
    const realIds = listIds.filter((id) => !isVirtualUserListKey(id))
    if (realIds.length > 0) {
      const queue = await db.sync_queue.toArray()
      const anyPending = realIds.some((listId) => hasOtherPendingOutboundForList(queue, listId))
      if (!anyPending) {
        await flushQuiescentCatalogOnlyVerification(userId)
      }
    }
    return
  }

  for (const listId of listIds) {
    if (isVirtualUserListKey(listId)) continue
    await flushQuiescentListVerification(userId, listId, {
      skipCatalog: decision.skipCatalog,
      force: options?.force,
    })
  }
}
