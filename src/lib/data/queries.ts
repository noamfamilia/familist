'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbItemMemberStateRow, type DbListRow, type DbSyncQueueRow, type SyncQueueStatus } from '@/lib/db'
import { isoNow, isTombstoned, syncFieldsForLocalInsert } from '@/lib/data/base_sync_fields'
import { countPendingOutboundForList, isOutboundRowPending } from '@/lib/data/syncQueueListScope'
import {
  collectLatestPendingItemMemberStatePatchesForList,
  syncQueueRowTouchesListId,
  type PendingImsPatchFields,
} from '@/lib/data/syncQueue'
import type {
  Database,
  ItemMemberState,
  ItemWithState,
  List,
  ListWithRole,
  MemberWithCreator,
} from '@/lib/supabase/types'
import { compareListsCatalogSortOrder, listCatalogSortOrderForVisualIndex } from '@/lib/data/listCatalogSort'

const PATCH_OVERLAY_STATUSES: readonly SyncQueueStatus[] = ['queued', 'processing', 'failed']

export type GetUserListsSummaryRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

/** Outbound patch rows that should win over stale server payloads until sync completes. */
function pendingPatchRowsForList(listId: string, queueRows: readonly DbSyncQueueRow[]): DbSyncQueueRow[] {
  return [...queueRows]
    .filter(
      (r) =>
        r.kind === 'patch' &&
        PATCH_OVERLAY_STATUSES.includes(r.status) &&
        syncQueueRowTouchesListId(r, listId),
    )
    .sort((a, b) => a.updated_at - b.updated_at)
}

function overlayPendingImsOnMemberStates(
  itemId: string,
  memberStates: Record<string, ItemMemberState>,
  pendingImsByItem: ReadonlyMap<string, ReadonlyMap<string, PendingImsPatchFields>>,
): Record<string, ItemMemberState> {
  if (!pendingImsByItem.size) return memberStates
  const patches = pendingImsByItem.get(itemId)
  if (!patches?.size) return memberStates
  const out: Record<string, ItemMemberState> = { ...memberStates }
  const t = isoNow()
  for (const [memberId, patch] of patches) {
    const base = out[memberId]
    out[memberId] = {
      ...(base ?? {
        item_id: itemId,
        member_id: memberId,
        ...syncFieldsForLocalInsert({ client_created_at: t }),
        quantity: 1,
        done: false,
        assigned: false,
        updated_at: t,
      }),
      item_id: itemId,
      member_id: memberId,
      quantity: patch.quantity,
      done: patch.done,
      assigned: patch.assigned,
      updated_at: t,
    }
  }
  return out
}

/**
 * Re-apply pending outbound `patch` rows on top of a `get_list_data`-shaped server snapshot so Dexie never
 * regresses behind in-flight local edits (items, members, list row, IMS).
 */
export function reconcileListDetailPayloadWithPendingSyncPatches(
  listId: string,
  payload: { list: List | null; items: ItemWithState[]; members: MemberWithCreator[] },
  queueRows: readonly DbSyncQueueRow[],
): { list: List | null; items: ItemWithState[]; members: MemberWithCreator[] } {
  const patchRows = pendingPatchRowsForList(listId, queueRows)
  const list = payload.list ? ({ ...payload.list } as List) : null
  const items = payload.items.map((i) => ({ ...i, memberStates: { ...i.memberStates } }))
  const members = payload.members.map((m) => ({ ...m } as MemberWithCreator))

  const itemById = new Map(items.map((i) => [i.id, i]))
  const memberById = new Map(members.map((m) => [m.id, m]))

  for (const r of patchRows) {
    if (r.entity === 'list' && list && r.entity_id === listId) {
      const p = r.payload as Record<string, unknown>
      const { id: _drop, memberStates: _ms, ...rest } = p
      Object.assign(list as Record<string, unknown>, rest)
    }
    if (r.entity === 'item') {
      const p = r.payload as Record<string, unknown>
      const id = String(p.id ?? r.entity_id ?? '')
      const it = itemById.get(id)
      if (!it) continue
      const { id: _i, memberStates: _m, ...rest } = p
      Object.assign(it as Record<string, unknown>, rest)
    }
    if (r.entity === 'member') {
      const p = r.payload as { memberId?: string; name?: unknown; is_public?: unknown }
      const id = String(p.memberId ?? r.entity_id ?? '')
      const m = memberById.get(id)
      if (!m) continue
      if (p.name !== undefined) (m as Record<string, unknown>).name = p.name
      if (p.is_public !== undefined) (m as Record<string, unknown>).is_public = p.is_public
    }
  }

  const pendingIms = collectLatestPendingItemMemberStatePatchesForList(listId, queueRows)
  for (const item of items) {
    item.memberStates = overlayPendingImsOnMemberStates(item.id, item.memberStates ?? {}, pendingIms)
  }

  return { list, items, members }
}

const LIST_SUMMARY_KEYS_FROM_PATCH = new Set(['name', 'archived', 'comment', 'visibility'])

/** Merge pending list-scoped `list` patches onto `get_user_lists` rows (catalog / Dexie list mirror). */
export function reconcileUserListsSummaryRowsWithPendingPatches(
  rows: GetUserListsSummaryRow[],
  queueRows: readonly DbSyncQueueRow[],
): GetUserListsSummaryRow[] {
  const sorted = [...queueRows]
    .filter(
      (r) =>
        r.kind === 'patch' &&
        r.entity === 'list' &&
        PATCH_OVERLAY_STATUSES.includes(r.status),
    )
    .sort((a, b) => a.updated_at - b.updated_at)

  const patchByListId = new Map<string, Record<string, unknown>>()
  for (const r of sorted) {
    const lid = String(r.entity_id ?? '')
    if (!lid) continue
    const p = r.payload as Record<string, unknown>
    const { id: _id, ...rest } = p
    const prev = patchByListId.get(lid) ?? {}
    patchByListId.set(lid, { ...prev, ...rest })
  }

  return rows.map((row) => {
    const merged = patchByListId.get(row.id)
    if (!merged) return row
    const next: Record<string, unknown> = { ...row }
    for (const [k, v] of Object.entries(merged)) {
      if (!LIST_SUMMARY_KEYS_FROM_PATCH.has(k)) continue
      if (v !== undefined) next[k] = v
    }
    return next as GetUserListsSummaryRow
  })
}

/**
 * Overlay pending outbound `patchListUser` + `reorderListUsers` RPCs so `get_user_lists` mirrors do not
 * regress behind in-flight archive/restore or home reorder (fetch/realtime can arrive before sync drains).
 */
export function reconcileUserListsSummaryRowsWithPendingCatalogQueue(
  rows: GetUserListsSummaryRow[],
  queueRows: readonly DbSyncQueueRow[],
  catalogUserId: string,
): GetUserListsSummaryRow[] {
  let next = reconcileUserListsSummaryRowsWithPendingPatches(rows, queueRows)

  const sorted = [...queueRows]
    .filter((r) => r.kind === 'rpc' && PATCH_OVERLAY_STATUSES.includes(r.status))
    .sort((a, b) => {
      const d = a.updated_at - b.updated_at
      if (d !== 0) return d
      return a.id.localeCompare(b.id)
    })

  const applyReorder = (ids: string[], rowsIn: GetUserListsSummaryRow[]) => {
    if (ids.length !== rowsIn.length) return rowsIn
    if (new Set(ids).size !== ids.length) return rowsIn
    if (!rowsIn.every((r) => ids.includes(r.id))) return rowsIn
    const n = ids.length
    const sortById = new Map(ids.map((id, idx) => [id, listCatalogSortOrderForVisualIndex(idx, n)]))
    return rowsIn.map((row) => {
      const so = sortById.get(row.id)
      if (so === undefined) return row
      return { ...row, sort_order: so }
    })
  }

  for (const r of sorted) {
    const pl = r.payload as Record<string, unknown>
    const method = String(pl.method ?? '')
    if (String(pl.user_id ?? '') !== catalogUserId) continue

    if (method === 'patchListUser') {
      const lid = String(pl.id ?? '')
      if (!lid) continue
      next = next.map((row) => {
        if (row.id !== lid) return row
        const out: Record<string, unknown> = { ...row }
        if (pl.archived !== undefined) out.userArchived = Boolean(pl.archived)
        if (pl.archived_at !== undefined) {
          out.userArchivedAt =
            pl.archived_at === null || pl.archived_at === '' ? null : String(pl.archived_at)
        } else if (pl.archived === false) {
          out.userArchivedAt = null
        }
        if (pl.sort_order !== undefined) out.sort_order = pl.sort_order
        if (pl.last_viewed !== undefined) out.last_viewed = pl.last_viewed
        return out as GetUserListsSummaryRow
      })
    } else if (method === 'reorderListUsers') {
      const list_ids = (Array.isArray(pl.list_ids) ? pl.list_ids : []).filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      )
      if (list_ids.length > 0) next = applyReorder(list_ids, next)
    } else if (method === 'bulkPatchListLabels') {
      const updates = (Array.isArray(pl.updates) ? pl.updates : []).filter(
        (u): u is { list_id: string; label: string } =>
          !!u &&
          typeof u === 'object' &&
          typeof (u as { list_id?: unknown }).list_id === 'string' &&
          typeof (u as { label?: unknown }).label === 'string',
      )
      if (updates.length > 0) {
        const byListId = new Map(updates.map((u) => [u.list_id, u.label]))
        next = next.map((row) => {
          const label = byListId.get(row.id)
          if (label === undefined) return row
          return { ...row, label }
        })
      }
    }
  }

  return next
}

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

/** Dexie-only home list catalog (same shape as former `useListsQuery` live read). */
export async function buildListsCatalogFromDexie(userId: string): Promise<ListWithRole[]> {
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
      userArchivedAt: listUser.archived_at ?? null,
      sort_order: listUser.sort_order,
      sumScope: listUser.sum_scope ?? 'none',
      label: listUser.label ?? '',
      last_viewed: listUser.last_viewed ?? null,
      memberCount: counts.memberCount,
      activeItemCount: counts.activeItemCount,
      archivedItemCount: counts.archivedItemCount,
      ownerNickname:
        listUser.role !== 'owner' ? (ownerNickById.get(row.owner_id) ?? null) : null,
      pending_items: countPendingOutboundForList(queueRows, row.id),
      sync_error: listUser.sync_error === true,
    }
  })

  return merged.sort(compareListsCatalogSortOrder)
}

export function useListsQuery(userId: string | null | undefined) {
  return useLiveQuery(
    () => (userId ? buildListsCatalogFromDexie(userId) : Promise.resolve([] as ListWithRole[])),
    [userId],
  )
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
  return useLiveQuery(
    async () => db.sync_queue.filter((r) => isOutboundRowPending(r)).count(),
    [],
    0,
  )
}
