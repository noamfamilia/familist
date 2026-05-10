'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbItemMemberStateRow, type DbListRow } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { countPendingOutboundForList } from '@/lib/data/syncQueueListScope'
import type { ItemWithState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

type CardStats = { memberCount: number; activeItemCount: number; archivedItemCount: number }

/** Counts for list cards from mirrored Dexie rows (matches former list_card_stats / RPC rules). */
function buildListCardStatsByListId(
  listIds: string[],
  items: { list_id: string; archived: boolean }[],
  members: { list_id: string; is_target?: boolean | null }[],
): Map<string, CardStats> {
  const stats = new Map<string, CardStats>()
  for (const id of listIds) {
    stats.set(id, { memberCount: 0, activeItemCount: 0, archivedItemCount: 0 })
  }
  for (const m of members) {
    if (m.is_target === true) continue
    const s = stats.get(m.list_id)
    if (s) s.memberCount += 1
  }
  for (const i of items) {
    const s = stats.get(i.list_id)
    if (!s) continue
    if (i.archived) s.archivedItemCount += 1
    else s.activeItemCount += 1
  }
  return stats
}

export function useListsQuery(userId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId) return []
    const memberships = await db.list_users.where('user_id').equals(userId).toArray()
    type ListUserRow = (typeof memberships)[number]
    const listRows: { listUser: ListUserRow; row: DbListRow }[] = []
    for (const listUser of memberships) {
      const row = await db.lists.get(listUser.list_id)
      if (!row || isTombstoned(row.deleted_at)) continue
      listRows.push({ listUser, row })
    }

    const listIds = listRows.map((e) => e.row.id)
    let items: { list_id: string; archived: boolean }[] = []
    let members: { list_id: string; is_target?: boolean | null }[] = []
    if (listIds.length > 0) {
      ;[items, members] = await Promise.all([
        db.items
          .where('list_id')
          .anyOf(listIds)
          .filter((r) => !isTombstoned(r.deleted_at))
          .toArray(),
        db.members
          .where('list_id')
          .anyOf(listIds)
          .filter((r) => !isTombstoned(r.deleted_at))
          .toArray(),
      ])
    }

    const cardStats = buildListCardStatsByListId(listIds, items, members)
    const queueRows = await db.sync_queue.toArray()

    const ownerIds = new Set<string>()
    for (const { listUser, row } of listRows) {
      if (listUser.role !== 'owner' && row.owner_id) ownerIds.add(row.owner_id)
    }
    const ownerNickById = new Map<string, string | null>()
    await Promise.all(
      [...ownerIds].map(async (oid) => {
        const p = await db.profiles.get(oid)
        ownerNickById.set(oid, p?.nickname ?? null)
      }),
    )

    const merged: ListWithRole[] = listRows.map(({ listUser, row }) => {
      const counts = cardStats.get(row.id) ?? {
        memberCount: 0,
        activeItemCount: 0,
        archivedItemCount: 0,
      }
      return {
        ...row,
        role: listUser.role,
        userArchived: listUser.archived,
        sort_order: listUser.sort_order,
        sumScope: listUser.sum_scope ?? 'none',
        label: listUser.label ?? '',
        memberCount: counts.memberCount,
        activeItemCount: counts.activeItemCount,
        archivedItemCount: counts.archivedItemCount,
        ownerNickname:
          listUser.role !== 'owner' ? (ownerNickById.get(row.owner_id) ?? null) : null,
        pending_items: countPendingOutboundForList(queueRows, row.id),
        sync_error: listUser.sync_error === true,
      }
    })

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

export type ListDetailDexieSnapshot = {
  items: ItemWithState[]
  members: MemberWithCreator[]
}

/** Dexie-only list detail (items + members + item_member_state join). Shared by live hooks, warm, and L2→L1 bridge. */
export async function loadListDetailFromDexie(userId: string, listId: string): Promise<ListDetailDexieSnapshot> {
  void userId
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
}

export function useListDetailQuery(userId: string | null | undefined, listId: string | null | undefined) {
  return useLiveQuery(async () => {
    if (!userId || !listId) return null
    return loadListDetailFromDexie(userId, listId)
  }, [listId, userId])
}

export function useSyncQueueBadge() {
  return useLiveQuery(async () => db.sync_queue.count(), [], 0)
}
