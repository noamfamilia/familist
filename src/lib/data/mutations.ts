import { db, type DbItemRow, type DbMemberRow, type DbSyncQueueRow } from '@/lib/db'
import type { ItemCategory, ItemMemberState } from '@/lib/supabase/types'
import { enqueueSyncQueueRecord, itemMemberStateOutboxKey, memberProfileOutboxKey } from '@/lib/data/syncQueue'

function now() {
  return Date.now()
}

function nextSyncBase(
  listId: string,
  itemKey: string,
  kind: DbSyncQueueRow['kind'],
  entity: DbSyncQueueRow['entity'],
  payload: Record<string, unknown>,
) {
  return {
    listId,
    itemKey,
    kind,
    entity,
    payload,
    updatedAt: now(),
  }
}

export async function addItemMutation(input: {
  userId: string
  listId: string
  text: string
  category: ItemCategory
}) {
  const id = crypto.randomUUID()
  const row: DbItemRow = {
    id,
    userId: input.userId,
    listId: input.listId,
    list_id: input.listId,
    text: input.text,
    category: input.category,
    comment: null,
    archived: false,
    archived_at: null,
    sort_order: now(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }

  await db.transaction('rw', db.items, db.sync_queue, async () => {
    await db.items.put(row)
    await enqueueSyncQueueRecord(
      nextSyncBase(input.listId, id, 'create', 'item', {
        id,
        list_id: input.listId,
        text: input.text,
        category: input.category,
      }),
    )
  })

  return id
}

export async function softDeleteItemMutation(userId: string, listId: string, itemId: string) {
  const key = [userId, listId, itemId] as const
  const existing = await db.items.get(key)
  if (!existing) return

  await db.transaction('rw', db.items, db.sync_queue, async () => {
    await db.items.update(key, {
      deleted_at: now(),
      updated_at: new Date().toISOString(),
    })
    await enqueueSyncQueueRecord(
      nextSyncBase(listId, `item:${itemId}`, 'delete', 'item', {
        id: itemId,
      }),
    )
  })
}

export async function toggleItemMemberStateMutation(input: {
  listId: string
  itemId: string
  memberId: string
  state: ItemMemberState
}) {
  const key = [input.listId, input.itemId, input.memberId] as const
  await db.transaction('rw', db.item_member_state, db.sync_queue, async () => {
    await db.item_member_state.put({
      ...input.state,
      listId: input.listId,
      deleted_at: null,
    })
    await enqueueSyncQueueRecord(
      nextSyncBase(
        input.listId,
        itemMemberStateOutboxKey(input.itemId, input.memberId),
        'itemMemberState',
        'item_member_state',
        {
          item_id: input.itemId,
          member_id: input.memberId,
          quantity: input.state.quantity,
          done: input.state.done,
          assigned: input.state.assigned,
        },
      ),
    )
  })
  return key
}

export async function addMemberMutation(input: {
  userId: string
  listId: string
  name: string
}) {
  const id = crypto.randomUUID()
  const row: DbMemberRow = {
    id,
    userId: input.userId,
    listId: input.listId,
    list_id: input.listId,
    name: input.name,
    created_by: input.userId,
    sort_order: now(),
    is_public: false,
    is_target: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }

  await db.transaction('rw', db.members, db.sync_queue, async () => {
    await db.members.put(row)
    await enqueueSyncQueueRecord(
      nextSyncBase(input.listId, memberProfileOutboxKey(id), 'addMember', 'member', {
        id,
        list_id: input.listId,
        name: input.name,
      }),
    )
  })

  return id
}
