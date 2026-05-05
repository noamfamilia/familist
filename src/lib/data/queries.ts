'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbItemMemberStateRow } from '@/lib/db'
import type { ItemWithState, MemberWithCreator } from '@/lib/supabase/types'

export function useListsQuery(userId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return []
    return db.lists
      .where('userId')
      .equals(userId)
      .filter((row) => row.deleted_at == null)
      .sortBy('sort_order')
  }, [userId])
}

export function useListDetailQuery(userId: string | null | undefined, listId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId || !listId) return null
    const [items, members, states] = await Promise.all([
      db.items
        .where('[userId+listId]')
        .equals([userId, listId])
        .filter((row) => row.deleted_at == null)
        .sortBy('sort_order'),
      db.members
        .where('[userId+listId]')
        .equals([userId, listId])
        .filter((row) => row.deleted_at == null)
        .sortBy('sort_order'),
      db.item_member_state
        .where('[listId+item_id]')
        .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
        .filter((row) => row.deleted_at == null)
        .toArray(),
    ])

    const byItem = new Map<string, Record<string, DbItemMemberStateRow>>()
    for (const s of states) {
      const current = byItem.get(s.item_id) ?? {}
      current[s.member_id] = s
      byItem.set(s.item_id, current)
    }

    const itemsWithState: ItemWithState[] = items.map((item) => ({
      ...item,
      memberStates: byItem.get(item.id) ?? {},
    }))

    return {
      items: itemsWithState,
      members: members as MemberWithCreator[],
    }
  }, [listId, userId])
}

export function useSyncQueueBadge() {
  return useLiveQuery(async () => db.sync_queue.count(), [], 0)
}
