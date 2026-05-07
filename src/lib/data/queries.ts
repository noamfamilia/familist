'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbItemMemberStateRow } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import type { ItemWithState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

export function useListsQuery(userId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return []
    const memberships = await db.list_users.where('user_id').equals(userId).toArray()
    const merged: ListWithRole[] = []
    for (const listUser of memberships) {
      const row = await db.lists.get(listUser.list_id)
      if (!row || isTombstoned(row.deleted_at)) continue
      merged.push({
        ...row,
        role: listUser.role,
        userArchived: listUser.archived,
        sort_order: listUser.sort_order,
        sumScope: listUser.sum_scope ?? 'none',
        label: listUser.label ?? '',
        memberCount: 0,
        activeItemCount: 0,
        archivedItemCount: 0,
        ownerNickname: null,
      })
    }
    return merged.sort((a, b) => {
      const aOrd = a.sort_order ?? Number.MAX_SAFE_INTEGER
      const bOrd = b.sort_order ?? Number.MAX_SAFE_INTEGER
      if (aOrd !== bOrd) return aOrd - bOrd
      const aT = a.server_created_at || a.client_created_at || ''
      const bT = b.server_created_at || b.client_created_at || ''
      return bT.localeCompare(aT)
    })
  }, [userId])
}

export function useListDetailQuery(userId: string | null | undefined, listId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId || !listId) return null
    const [rawItems, rawMembers, states] = await Promise.all([
      db.items
        .where('list_id')
        .equals(listId)
        .filter((row) => !isTombstoned(row.deleted_at))
        .toArray(),
      db.members
        .where('list_id')
        .equals(listId)
        .filter((row) => !isTombstoned(row.deleted_at))
        .toArray(),
      db.item_member_state
        .where('[list_id+item_id]')
        .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
        .filter((row) => !isTombstoned(row.deleted_at))
        .toArray(),
    ])

    const createdTie = (server: string | null | undefined, client: string | undefined) =>
      (server && server.length > 0 ? server : client) ?? ''

    const items = rawItems.sort((a, b) => {
      const ao = a.sort_order ?? 0
      const bo = b.sort_order ?? 0
      if (ao !== bo) return ao - bo
      return createdTie(a.server_created_at, a.client_created_at).localeCompare(
        createdTie(b.server_created_at, b.client_created_at),
      )
    })
    const members = rawMembers.sort((a, b) => {
      const ao = a.sort_order ?? 0
      const bo = b.sort_order ?? 0
      if (ao !== bo) return ao - bo
      return createdTie(a.server_created_at, a.client_created_at).localeCompare(
        createdTie(b.server_created_at, b.client_created_at),
      )
    })

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
