import { db, type DbItemRow, type DbMemberRow } from '@/lib/db'
import type { ItemCategory, ItemMemberState } from '@/lib/supabase/types'
import {
  enqueueSyncQueueRecord,
  itemMemberStateOutboxKey,
  listQueueParent,
  newBatchEntityId,
  removeOutboundQueueRowsForItemIds,
  stableItemMemberStateDexieId,
} from '@/lib/data/syncQueue'
import { isoNow, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { validateSingleNewItemTextUniqueness } from '@/lib/data/localItemTextUniqueness'
import { validateMemberNameForList } from '@/lib/data/localListMemberNameUniqueness'
import { withDeletionNameSuffix } from '@/lib/data/deletionRename'

export async function addItemMutation(input: {
  user_id: string
  list_id: string
  text: string
  category: ItemCategory
  /** When set, must match optimistic L1 / UI so Dexie and Zustand stay aligned */
  id?: string
  /** List position; should be max(existing)+1 so the row sorts at the bottom */
  sort_order?: number
}) {
  const id = input.id ?? crypto.randomUUID()
  const t = isoNow()
  const sync = syncFieldsForLocalInsert({ client_created_at: t })
  const sortOrder = input.sort_order ?? 0
  const dup = await validateSingleNewItemTextUniqueness(input.list_id, input.text)
  if (!dup.ok) {
    throw new Error(dup.message)
  }

  const row: DbItemRow = {
    id,
    list_id: input.list_id,
    text: input.text,
    category: input.category,
    comment: null,
    archived: false,
    archived_at: null,
    sort_order: sortOrder,
    ...sync,
    updated_at: t,
  }

  await db.transaction('rw', db.items, db.sync_queue, db.list_users, async () => {
    await db.items.put(row)
    await enqueueSyncQueueRecord({
      entity: 'item',
      entity_id: id,
      kind: 'create',
      payload: {
        id,
        list_id: input.list_id,
        text: input.text,
        category: input.category,
        client_created_at: sync.client_created_at,
        sort_order: sortOrder,
      },
      ...listQueueParent(input.list_id),
      status: 'queued',
    })
  })

  return id
}

export async function softDeleteItemMutation(
  _user_id: string,
  list_id: string,
  item_id: string,
  options?: { skipEnqueue?: boolean },
) {
  const existing = await db.items.get(item_id)
  if (!existing) return

  const t = isoNow()
  const renamedText = withDeletionNameSuffix(existing.text ?? '')

  await db.transaction('rw', db.items, db.sync_queue, db.list_users, async () => {
    await db.items.update(item_id, {
      text: renamedText,
      deleted_at: t,
      updated_at: t,
    })
    if (!options?.skipEnqueue) {
      await enqueueSyncQueueRecord({
        entity: 'item',
        entity_id: item_id,
        kind: 'delete',
        payload: { id: item_id },
        ...listQueueParent(list_id),
        status: 'queued',
      })
    }
  })
}

/**
 * Shadow-delete every archived item locally (same row shape as `softDeleteItemMutation`), then enqueue
 * one `deleteArchivedItems` RPC. After the RPC succeeds, the sync worker runs `cleanupDexieAfterItemServerDeleted`
 * per `item_id` (hard local delete), matching the single-item delete lifecycle.
 */
export async function bulkSoftDeleteArchivedItemsMutation(list_id: string, itemIds: readonly string[]) {
  const ids = [...new Set(itemIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return
  const idSet = new Set(ids)
  const t = isoNow()

  await db.transaction('rw', [db.items, db.sync_queue, db.list_users], async () => {
    await removeOutboundQueueRowsForItemIds(list_id, idSet)
    for (const itemId of ids) {
      const existing = await db.items.get(itemId)
      if (!existing) continue
      const renamedText = withDeletionNameSuffix(existing.text ?? '')
      await db.items.update(itemId, {
        text: renamedText,
        deleted_at: t,
        updated_at: t,
      })
    }
    await enqueueSyncQueueRecord({
      entity: 'list',
      entity_id: newBatchEntityId(),
      kind: 'rpc',
      payload: { method: 'deleteArchivedItems', list_id, item_ids: ids },
      ...listQueueParent(list_id),
      status: 'queued',
    })
  })
}

export async function toggleItemMemberStateMutation(input: {
  list_id: string
  item_id: string
  member_id: string
  state: ItemMemberState
}) {
  const t = isoNow()
  const sync = syncFieldsForLocalInsert({ client_created_at: t })
  const rowId = await stableItemMemberStateDexieId(input.item_id, input.member_id)
  await db.transaction('rw', db.item_member_state, db.sync_queue, db.list_users, async () => {
    const dupes = await db.item_member_state
      .where('[item_id+member_id]')
      .equals([input.item_id, input.member_id])
      .toArray()
    for (const row of dupes) {
      if (row.id !== rowId) await db.item_member_state.delete(row.id)
    }
    await db.item_member_state.put({
      id: rowId,
      ...input.state,
      list_id: input.list_id,
      ...sync,
      updated_at: t,
    })
    await enqueueSyncQueueRecord({
      entity: 'item_member_state',
      entity_id: itemMemberStateOutboxKey(input.item_id, input.member_id),
      kind: 'patch',
      payload: {
        item_id: input.item_id,
        member_id: input.member_id,
        quantity: input.state.quantity,
        done: input.state.done,
        assigned: input.state.assigned,
      },
      ...listQueueParent(input.list_id),
      status: 'queued',
    })
  })
  return rowId
}

export async function addMemberMutation(input: {
  /** When set (e.g. target member + IMS), must match optimistic UI / Dexie id */
  id?: string
  user_id: string
  list_id: string
  name: string
  is_target?: boolean
  /** Defaults to 0; callers should pass max+1 for append order (see useList addMember). */
  sort_order?: number
}) {
  const id = input.id ?? crypto.randomUUID()
  const t = isoNow()
  const sync = syncFieldsForLocalInsert({ client_created_at: t })
  const sortOrder = input.sort_order ?? 0
  const isTarget = input.is_target ?? false
  const memberDup = await validateMemberNameForList(input.list_id, input.name)
  if (!memberDup.ok) {
    throw new Error(memberDup.message)
  }
  const row: DbMemberRow = {
    id,
    list_id: input.list_id,
    name: input.name,
    created_by: input.user_id,
    sort_order: sortOrder,
    is_public: false,
    is_target: isTarget,
    ...sync,
    updated_at: t,
    creator: null,
  }

  await db.transaction('rw', db.members, db.sync_queue, db.list_users, async () => {
    await db.members.put(row)
    await enqueueSyncQueueRecord({
      entity: 'member',
      entity_id: id,
      kind: 'create',
      payload: {
        id,
        list_id: input.list_id,
        name: input.name,
        client_created_at: sync.client_created_at,
        created_by: input.user_id,
        sort_order: sortOrder,
        is_public: false,
        is_target: isTarget,
      },
      ...listQueueParent(input.list_id),
      status: 'queued',
    })
  })

  return id
}
