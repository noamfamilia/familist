'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
import { db, type DbListRow, type DbListUserRow } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { loadListDetailFromDexie, type ListDetailDexieSnapshot } from '@/lib/data/queries'
import { normalizeItemsCategory } from '@/lib/items/normalizeItemsCategory'
import type { ItemWithState, List, MemberWithCreator } from '@/lib/supabase/types'

export type ListDataStatus = 'idle' | 'loading' | 'ready'

type CachedListPayload = {
  list: List | null
  items: ItemWithState[]
  members: MemberWithCreator[]
} | null

export type L2BridgePayload = {
  listRow: DbListRow | undefined | null
  detail: ListDetailDexieSnapshot
  /** `null` when there is no `list_users` row for this list + user in Dexie. */
  listUserRow: DbListUserRow | null
}

function ts(v: string | null | undefined): string {
  return v ?? ''
}

function shouldTakeMember(l1: MemberWithCreator | undefined, inc: MemberWithCreator): boolean {
  if (!l1) return true
  return ts(inc.updated_at) > ts(l1.updated_at)
}

function shouldTakeItem(l1: ItemWithState | undefined, inc: ItemWithState): boolean {
  if (!l1) return true
  const ti = ts(inc.updated_at)
  const tl = ts(l1.updated_at)
  if (ti > tl) return true
  if (ti === tl && JSON.stringify(l1.memberStates) !== JSON.stringify(inc.memberStates)) return true
  return false
}

function shouldTakeListUser(l1: DbListUserRow | null | undefined, inc: DbListUserRow): boolean {
  if (!l1) return true
  return ts(inc.updated_at) > ts(l1.updated_at)
}

function mergeMembers(l1: MemberWithCreator[], incoming: MemberWithCreator[]): MemberWithCreator[] {
  const l1ById = new Map(l1.map((m) => [m.id, m]))
  const incomingIds = new Set(incoming.map((m) => m.id))
  const mergedIncoming = incoming.map((inc) => {
    const prev = l1ById.get(inc.id)
    if (shouldTakeMember(prev, inc)) return inc
    return prev!
  })
  const extras = l1.filter((m) => !incomingIds.has(m.id))
  const out = [...mergedIncoming, ...extras]
  if (out.length === l1.length && out.every((row, i) => row === l1[i])) return l1
  return out
}

function mergeItems(l1: ItemWithState[], incoming: ItemWithState[]): ItemWithState[] {
  const l1ById = new Map(l1.map((i) => [i.id, i]))
  const incomingIds = new Set(incoming.map((i) => i.id))
  const mergedIncoming = incoming.map((inc) => {
    const prev = l1ById.get(inc.id)
    if (shouldTakeItem(prev, inc)) return inc
    return prev!
  })
  const extras = l1.filter((i) => !incomingIds.has(i.id))
  const out = [...mergedIncoming, ...extras]
  if (out.length === l1.length && out.every((row, i) => row === l1[i])) return l1
  return out
}

function mergeListRow(l1: List | null, row: DbListRow | null | undefined): List | null {
  if (!row || isTombstoned(row.deleted_at)) return null
  const incoming = row as List
  if (!l1) return incoming
  if (ts(row.updated_at) > ts(l1.updated_at)) return incoming
  return l1
}

type ListDataState = {
  activeUserId: string | null
  activeListId: string | null
  listDataStatus: ListDataStatus
  list: List | null
  items: ItemWithState[]
  members: MemberWithCreator[]
  localPersistenceDepth: number
  /** Blocks applying `list_users` prefs from L2 while prefs-only Dexie transactions run. */
  prefsPersistenceDepth: number
  /** Dexie-backed `list_users` row for prefs (null = hydrated, no row). Undefined only before first warm for this session. */
  mirroredListUserRow: DbListUserRow | null | undefined
  /** True after first `warmListData` prefs application for the active session. */
  prefsMirrorReady: boolean
}

type ListDataActions = {
  clearActiveListData: () => void
  /** Sets active list, `listDataStatus` to loading, and seeds list/items/members from memory cache (instant paint). */
  beginListSession: (userId: string, listId: string, cached: CachedListPayload) => void
  setList: (updater: List | null | ((prev: List | null) => List | null)) => void
  setItems: (updater: ItemWithState[] | ((prev: ItemWithState[]) => ItemWithState[])) => void
  setMembers: (updater: MemberWithCreator[] | ((prev: MemberWithCreator[]) => MemberWithCreator[])) => void
  beginLocalListPersistence: () => void
  endLocalListPersistence: () => void
  beginPrefsPersistence: () => void
  endPrefsPersistence: () => void
  applyWarmResult: (
    userId: string,
    listId: string,
    listRow: DbListRow | undefined,
    detail: ListDetailDexieSnapshot,
    listUserRow: DbListUserRow | null,
  ) => void
  applyL2BridgePayload: (userId: string, listId: string, payload: L2BridgePayload) => void
}

export const useListDataStore = create<ListDataState & ListDataActions>((set, get) => ({
  activeUserId: null,
  activeListId: null,
  listDataStatus: 'idle',
  list: null,
  items: [],
  members: [],
  localPersistenceDepth: 0,
  prefsPersistenceDepth: 0,
  mirroredListUserRow: undefined,
  prefsMirrorReady: false,

  clearActiveListData: () =>
    set({
      activeUserId: null,
      activeListId: null,
      listDataStatus: 'idle',
      list: null,
      items: [],
      members: [],
      prefsPersistenceDepth: 0,
      mirroredListUserRow: undefined,
      prefsMirrorReady: false,
    }),

  beginListSession: (userId, listId, cached) => {
    const st = get()
    if (
      st.activeUserId === userId &&
      st.activeListId === listId &&
      st.listDataStatus === 'ready' &&
      st.prefsMirrorReady
    ) {
      return
    }
    const seed =
      cached?.list != null
        ? {
            list: cached.list,
            items: normalizeItemsCategory(cached.items || []),
            members: cached.members || [],
          }
        : { list: null as List | null, items: [] as ItemWithState[], members: [] as MemberWithCreator[] }
    set({
      activeUserId: userId,
      activeListId: listId,
      listDataStatus: 'loading',
      prefsMirrorReady: false,
      mirroredListUserRow: undefined,
      ...seed,
    })
  },

  setList: (updater) =>
    set((s) => ({
      list: typeof updater === 'function' ? (updater as (p: List | null) => List | null)(s.list) : updater,
    })),

  setItems: (updater) =>
    set((s) => ({
      items: typeof updater === 'function' ? (updater as (p: ItemWithState[]) => ItemWithState[])(s.items) : updater,
    })),

  setMembers: (updater) =>
    set((s) => ({
      members:
        typeof updater === 'function'
          ? (updater as (p: MemberWithCreator[]) => MemberWithCreator[])(s.members)
          : updater,
    })),

  beginLocalListPersistence: () => set((s) => ({ localPersistenceDepth: s.localPersistenceDepth + 1 })),

  endLocalListPersistence: () =>
    set((s) => ({ localPersistenceDepth: Math.max(0, s.localPersistenceDepth - 1) })),

  beginPrefsPersistence: () => set((s) => ({ prefsPersistenceDepth: s.prefsPersistenceDepth + 1 })),

  endPrefsPersistence: () =>
    set((s) => ({ prefsPersistenceDepth: Math.max(0, s.prefsPersistenceDepth - 1) })),

  applyWarmResult: (userId, listId, listRow, detail, listUserRow) => {
    const st = get()
    if (st.activeUserId !== userId || st.activeListId !== listId) return
    if (!listRow || isTombstoned(listRow.deleted_at)) {
      set({
        list: null,
        items: [],
        members: [],
        listDataStatus: 'ready',
        mirroredListUserRow: listUserRow,
        prefsMirrorReady: true,
      })
      return
    }
    set({
      list: listRow as List,
      items: normalizeItemsCategory(detail.items),
      members: detail.members,
      listDataStatus: 'ready',
      mirroredListUserRow: listUserRow,
      prefsMirrorReady: true,
    })
  },

  applyL2BridgePayload: (userId, listId, payload) => {
    const st = get()
    if (st.activeUserId !== userId || st.activeListId !== listId) return
    const { listRow, detail, listUserRow } = payload
    const canMergeEntities = st.localPersistenceDepth === 0
    const canMergePrefs = st.localPersistenceDepth === 0 && st.prefsPersistenceDepth === 0

    let nextList = st.list
    let nextItems = st.items
    let nextMembers = st.members
    let nextMirroredUser = st.mirroredListUserRow
    let prefsChanged = false

    if (canMergeEntities) {
      if (!listRow || isTombstoned(listRow.deleted_at)) {
        nextList = null
        nextItems = []
        nextMembers = []
      } else {
        const incomingItems = normalizeItemsCategory(detail.items)
        const incomingMembers = detail.members
        nextList = mergeListRow(st.list, listRow)
        nextItems = mergeItems(st.items, incomingItems)
        nextMembers = mergeMembers(st.members, incomingMembers)
      }
    }

    if (canMergePrefs) {
      const prevLu = st.mirroredListUserRow
      const inc = listUserRow
      if (inc === null) {
        if (prevLu != null) {
          nextMirroredUser = null
          prefsChanged = true
        }
      } else if (shouldTakeListUser(prevLu ?? undefined, inc)) {
        nextMirroredUser = inc
        prefsChanged = true
      }
    }

    const entitiesChanged =
      canMergeEntities &&
      (nextList !== st.list || nextItems !== st.items || nextMembers !== st.members)

    if (!entitiesChanged && !prefsChanged) return

    set({
      ...(canMergeEntities
        ? { list: nextList, items: nextItems, members: nextMembers }
        : {}),
      ...(prefsChanged ? { mirroredListUserRow: nextMirroredUser } : {}),
    })
  },
}))

/** Dexie read for the active list session; expects `beginListSession` to have run for the same `userId` + `listId`. */
export async function warmListData(userId: string, listId: string): Promise<void> {
  const listRow = await db.lists.get(listId)
  const detail = await loadListDetailFromDexie(userId, listId)
  const listUserRow = (await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()) ?? null
  const st = useListDataStore.getState()
  if (st.activeUserId !== userId || st.activeListId !== listId) return
  st.applyWarmResult(userId, listId, listRow, detail, listUserRow)
}

/** Dexie `liveQuery` for the active list: L2 → L1, gated by persistence depth and per-row `updated_at`. */
export function subscribeListDataL2Bridge(userId: string, listId: string): () => void {
  const subscription = liveQuery(async (): Promise<L2BridgePayload> => {
    const listRow = await db.lists.get(listId)
    const detail = await loadListDetailFromDexie(userId, listId)
    const listUserRow = (await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()) ?? null
    return { listRow, detail, listUserRow }
  }).subscribe({
    next: (payload) => {
      useListDataStore.getState().applyL2BridgePayload(userId, listId, payload)
    },
    error: (err) => {
      console.error('[listDataStore] L2 bridge liveQuery error', err)
    },
  })
  return () => subscription.unsubscribe()
}
