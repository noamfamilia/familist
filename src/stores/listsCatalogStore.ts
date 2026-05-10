'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
import { buildListsCatalogFromDexie } from '@/lib/data/queries'
import type { ListWithRole } from '@/lib/supabase/types'

export type ListsCatalogStatus = 'idle' | 'loading' | 'ready'

/** Full-opacity check after outbound pending (catalog) drops from above zero to zero (L2 bridge only). */
export const RECENT_SUCCESS_HOLD_MS = 10_000
/** Linear fade after hold. */
export const RECENT_SUCCESS_FADE_MS = 5_000
export const RECENT_SUCCESS_WINDOW_MS = RECENT_SUCCESS_HOLD_MS + RECENT_SUCCESS_FADE_MS

function pruneCompletedRecentSuccesses(m: Map<string, number>, now: number): Map<string, number> {
  const out = new Map(m)
  for (const [id, startedAt] of out) {
    if (now >= startedAt + RECENT_SUCCESS_WINDOW_MS) out.delete(id)
  }
  return out
}

function detectPendingToZeroSuccesses(
  prevLists: ListWithRole[],
  nextLists: ListWithRole[],
  existing: Map<string, number>,
  now: number,
): { next: Map<string, number>; newEntries: Array<{ listId: string; startedAt: number }> } {
  let next = pruneCompletedRecentSuccesses(existing, now)
  const prevPending = new Map(prevLists.map((l) => [l.id, l.pending_items ?? 0]))
  const newEntries: Array<{ listId: string; startedAt: number }> = []
  for (const list of nextLists) {
    const p0 = prevPending.get(list.id)
    const p1 = list.pending_items ?? 0
    if (p0 !== undefined && p0 > 0 && p1 === 0) {
      const startedAt = now
      next.set(list.id, startedAt)
      newEntries.push({ listId: list.id, startedAt })
    }
  }
  return { next, newEntries }
}

function scheduleRecentSuccessRemoval(listId: string, startedAt: number) {
  if (typeof window === 'undefined') return
  const delay = Math.max(0, startedAt + RECENT_SUCCESS_WINDOW_MS - Date.now()) + 20
  window.setTimeout(() => {
    useListsCatalogStore.getState().expireRecentSuccessIfMatches(listId, startedAt)
  }, delay)
}

type ListsCatalogState = {
  activeUserId: string | null
  listsCatalogStatus: ListsCatalogStatus
  lists: ListWithRole[]
  localCatalogMutationDepth: number
  /** listId → epoch ms when the success pulse started (hold + fade window). */
  recentSuccesses: Map<string, number>
}

type ListsCatalogActions = {
  clearListsCatalog: () => void
  beginHomeSession: (userId: string, cachedLists: ListWithRole[] | null) => void
  applyWarmResult: (userId: string, lists: ListWithRole[]) => void
  applyL2BridgePayload: (userId: string, lists: ListWithRole[]) => void
  setCatalogLists: (updater: ListWithRole[] | ((prev: ListWithRole[]) => ListWithRole[])) => void
  beginLocalCatalogPersistence: () => void
  endLocalCatalogPersistence: () => void
  expireRecentSuccessIfMatches: (listId: string, expectedStartedAt: number) => void
}

export const useListsCatalogStore = create<ListsCatalogState & ListsCatalogActions>((set, get) => ({
  activeUserId: null,
  listsCatalogStatus: 'idle',
  lists: [],
  localCatalogMutationDepth: 0,
  recentSuccesses: new Map(),

  clearListsCatalog: () =>
    set({
      activeUserId: null,
      listsCatalogStatus: 'idle',
      lists: [],
      recentSuccesses: new Map(),
    }),

  beginHomeSession: (userId, cachedLists) =>
    set({
      activeUserId: userId,
      listsCatalogStatus: 'loading',
      lists: cachedLists ? [...cachedLists] : [],
      recentSuccesses: new Map(),
    }),

  applyWarmResult: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    const pruned = pruneCompletedRecentSuccesses(st.recentSuccesses, Date.now())
    set({ lists, listsCatalogStatus: 'ready', recentSuccesses: pruned })
  },

  applyL2BridgePayload: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    if (st.localCatalogMutationDepth > 0) return
    const now = Date.now()
    const { next, newEntries } = detectPendingToZeroSuccesses(st.lists, lists, st.recentSuccesses, now)
    for (const { listId, startedAt } of newEntries) {
      scheduleRecentSuccessRemoval(listId, startedAt)
    }
    set({ lists, recentSuccesses: next })
  },

  setCatalogLists: (updater) =>
    set((s) => ({
      lists: typeof updater === 'function' ? (updater as (p: ListWithRole[]) => ListWithRole[])(s.lists) : updater,
    })),

  beginLocalCatalogPersistence: () => set((s) => ({ localCatalogMutationDepth: s.localCatalogMutationDepth + 1 })),

  endLocalCatalogPersistence: () =>
    set((s) => ({ localCatalogMutationDepth: Math.max(0, s.localCatalogMutationDepth - 1) })),

  expireRecentSuccessIfMatches: (listId, expectedStartedAt) =>
    set((s) => {
      if (s.recentSuccesses.get(listId) !== expectedStartedAt) return s
      const next = new Map(s.recentSuccesses)
      next.delete(listId)
      return { recentSuccesses: next }
    }),
}))

export async function warmListsCatalog(userId: string): Promise<void> {
  const rows = await buildListsCatalogFromDexie(userId)
  const st = useListsCatalogStore.getState()
  if (st.activeUserId !== userId) return
  st.applyWarmResult(userId, rows)
}

export function subscribeListsCatalogL2Bridge(userId: string): () => void {
  const subscription = liveQuery(async () => buildListsCatalogFromDexie(userId)).subscribe({
    next: (lists) => {
      useListsCatalogStore.getState().applyL2BridgePayload(userId, lists)
    },
    error: (err) => {
      console.error('[listsCatalogStore] L2 bridge liveQuery error', err)
    },
  })
  return () => subscription.unsubscribe()
}
