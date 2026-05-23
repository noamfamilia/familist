'use client'

import { db, type DbSyncQueueRow } from '@/lib/db'
import {
  cleanupDexieAfterItemServerDeleted,
  cleanupDexieAfterListServerDeleted,
  cleanupDexieAfterMemberServerDeleted,
} from '@/lib/data/shadowDeleteDexieCleanup'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'
import { syncListDetail, syncLists } from '@/lib/data/sync'
import { useListDataStore } from '@/stores/listDataStore'

function isVirtualUserListKey(listId: string): boolean {
  return listId.startsWith('user:')
}

/**
 * Drop outbound `item_member_state` queue rows that still pointed at an item or member whose
 * `create` failed terminally (parent will never exist on the server).
 */
async function removeOutboundImsQueueRowsReferencingTerminalFailedParentCreate(parent: DbSyncQueueRow): Promise<void> {
  if (parent.kind !== 'create') return
  if (parent.entity !== 'item' && parent.entity !== 'member') return
  const pl = parent.payload as { id?: string }
  const parentId = String(parent.entity_id ?? pl.id ?? '')
  if (!parentId) return

  const all = await db.sync_queue.toArray()
  for (const r of all) {
    if (r.entity !== 'item_member_state') continue
    const imsPl = r.payload as { item_id?: unknown; member_id?: unknown }
    const itemId = typeof imsPl.item_id === 'string' ? imsPl.item_id : ''
    const memberId = typeof imsPl.member_id === 'string' ? imsPl.member_id : ''
    if (!itemId || !memberId) continue
    const hit =
      (parent.entity === 'item' && itemId === parentId) ||
      (parent.entity === 'member' && memberId === parentId)
    if (!hit) continue
    await db.sync_queue.delete(r.id)
  }
}

/**
 * Rows whose local intent is "add new server entities" (or join). On terminal failure the server
 * never applied the change — remove optimistic Dexie rows and trim the open list Zustand slice.
 */
export function isTerminalOutboundCreateOrJoinIntent(row: DbSyncQueueRow): boolean {
  if (row.kind === 'create') {
    return (
      row.entity === 'item' ||
      row.entity === 'member' ||
      row.entity === 'list' ||
      row.entity === 'feedback'
    )
  }
  if (row.kind === 'rpc') {
    const method = String((row.payload as { method?: string }).method ?? '')
    return method === 'importList' || method === 'joinListByToken'
  }
  return false
}

async function refetchServerTruthForLists(
  syncUserId: string,
  listIds: readonly string[],
  normalizeErrorMessage: (e: unknown) => string,
): Promise<void> {
  const unique = [...new Set(listIds.filter((id) => id && !isVirtualUserListKey(id)))]
  for (const listId of unique) {
    try {
      await syncListDetail(syncUserId, listId, 'Terminal sync failure: reconcile list')
    } catch (e) {
    }
  }
  try {
    await syncLists(syncUserId, 'Terminal sync failure: reconcile catalog')
  } catch (e) {
  }
}

/**
 * After a terminal outbound failure: drop ghost creates from Dexie + UI, or refetch list/catalog
 * from Supabase so Dexie matches server truth.
 */
export async function scrubAfterTerminalOutboundFailure(
  row: DbSyncQueueRow,
  syncUserId: string | null,
  normalizeErrorMessage: (e: unknown) => string,
): Promise<void> {
  const listIds = listIdsTouchingOutboundRow(row)

  if (isTerminalOutboundCreateOrJoinIntent(row)) {
    if (row.kind === 'create' && row.entity === 'item') {
      const pl = row.payload as { id?: string; list_id?: string }
      const id = String(pl.id ?? '')
      const listId = String(pl.list_id ?? '')
      if (id) {
        await cleanupDexieAfterItemServerDeleted(id, listId || null)
        const st = useListDataStore.getState()
        if (listId && st.activeListId === listId) {
          st.setItems((prev) => prev.filter((i) => i.id !== id))
        }
      }
      await removeOutboundImsQueueRowsReferencingTerminalFailedParentCreate(row)
      return
    }

    if (row.kind === 'create' && row.entity === 'member') {
      const pl = row.payload as { id?: string; list_id?: string }
      const id = String(pl.id ?? '')
      let listId = String(pl.list_id ?? '')
      if (id) {
        const m = await db.members.get(id)
        if (m?.list_id) listId = String(m.list_id)
        await cleanupDexieAfterMemberServerDeleted(id)
        const st = useListDataStore.getState()
        if (listId && st.activeListId === listId) {
          st.setMembers((prev) => prev.filter((x) => x.id !== id))
        }
      }
      await removeOutboundImsQueueRowsReferencingTerminalFailedParentCreate(row)
      return
    }

    if (row.kind === 'create' && row.entity === 'list') {
      const pl = row.payload as { id?: string }
      const listId = String(pl.id ?? row.entity_id ?? '')
      if (listId) {
        await cleanupDexieAfterListServerDeleted(listId)
      }
      return
    }

    if (row.kind === 'create' && row.entity === 'feedback') {
      const pl = row.payload as { id?: string }
      const id = String(pl.id ?? '')
      if (id) {
        try {
          await db.feedback.delete(id)
        } catch {
          /* ignore */
        }
      }
      return
    }

    if (row.kind === 'rpc') {
      const pl = row.payload as { method?: string; duplicate_id?: string; imported_id?: string }
      const method = String(pl.method ?? '')
      if (method === 'importList') {
        const importedId = String(pl.imported_id ?? '')
        if (importedId) await cleanupDexieAfterListServerDeleted(importedId)
        return
      }
      if (method === 'joinListByToken') {
        if (syncUserId) {
          try {
            await syncLists(syncUserId, 'Terminal sync failure: join rejected')
          } catch (e) {
          }
        }
        return
      }
    }
  }

  if (syncUserId) {
    await refetchServerTruthForLists(syncUserId, listIds, normalizeErrorMessage)
  }
}
