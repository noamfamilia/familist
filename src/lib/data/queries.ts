'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbItemMemberStateRow } from '@/lib/db'
import type { ItemWithState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

export function useListsQuery(userId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return []
    const rows = await db.lists
      .where('userId')
      .equals(userId)
      .filter((row) => row.deleted_at == null)
      .toArray()
    const merged: ListWithRole[] = []
    for (const row of rows) {
      const [listUser, summary] = await Promise.all([
        db.list_users.get([row.id, userId]),
        db.listSummaries.get([userId, row.id]),
      ])
      if (!listUser) continue
      merged.push({
        ...row,
        role: listUser.role,
        userArchived: listUser.archived,
        sort_order: listUser.sort_order,
        sumScope: listUser.sum_scope ?? 'none',
        label: listUser.label ?? '',
        memberCount: summary?.memberCount ?? 0,
        activeItemCount: summary?.activeItemCount ?? 0,
        archivedItemCount: summary?.archivedItemCount ?? 0,
        ownerNickname: summary?.ownerNickname ?? null,
      })
    }
    return merged.sort((a, b) => {
      const aOrd = a.sort_order ?? Number.MAX_SAFE_INTEGER
      const bOrd = b.sort_order ?? Number.MAX_SAFE_INTEGER
      if (aOrd !== bOrd) return aOrd - bOrd
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
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
