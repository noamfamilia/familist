import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { useListDataStore } from '@/stores/listDataStore'

/**
 * Persist terminal outbound sync errors on the Dexie `lists` row and mirror to Zustand when that list is active.
 * Field is client-only (not from Postgres); see `useSyncStore` drain + `useListSyncErrorToast`.
 */
export async function setListSyncErrorMessages(listIds: readonly string[], message: string): Promise<void> {
  const unique = [...new Set(listIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.startsWith('user:')))]
  const st = useListDataStore.getState()
  for (const listId of unique) {
    const existing = await db.lists.get(listId)
    if (!existing || isTombstoned(existing.deleted_at ?? null)) continue
    await db.lists.put({ ...existing, sync_error_message: message })
    if (st.activeListId === listId) {
      st.setList((l) => (l && l.id === listId ? { ...l, sync_error_message: message } : l))
    }
  }
}

export async function clearListSyncErrorMessages(listIds: readonly string[]): Promise<void> {
  const unique = [...new Set(listIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.startsWith('user:')))]
  const st = useListDataStore.getState()
  for (const listId of unique) {
    const existing = await db.lists.get(listId)
    if (!existing || isTombstoned(existing.deleted_at ?? null)) continue
    if (existing.sync_error_message == null || existing.sync_error_message === '') continue
    await db.lists.put({ ...existing, sync_error_message: null })
    if (st.activeListId === listId) {
      st.setList((l) => (l && l.id === listId ? { ...l, sync_error_message: null } : l))
    }
  }
}
