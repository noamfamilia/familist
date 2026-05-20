'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
import { DIAGNOSTICS_DATA_COLLECTION_ENABLED } from '@/lib/diagnosticsFlags'
import { getCachedLists } from '@/lib/cache'
import { buildListsCatalogFromDexie } from '@/lib/data/queries'
import type { ListWithRole } from '@/lib/supabase/types'

export type ListsCatalogStatus = 'idle' | 'loading' | 'ready'

type ListsCatalogState = {
  activeUserId: string | null
  listsCatalogStatus: ListsCatalogStatus
  lists: ListWithRole[]
  localCatalogMutationDepth: number
  /** Bumped on actor/session changes so stale warm flights are ignored. */
  catalogSessionEpoch: number
}

type ListsCatalogActions = {
  clearListsCatalog: () => void
  beginHomeSession: (userId: string, cachedLists: ListWithRole[] | null) => number
  applyWarmResult: (userId: string, lists: ListWithRole[]) => void
  applyL2BridgePayload: (userId: string, lists: ListWithRole[]) => void
  setCatalogLists: (updater: ListWithRole[] | ((prev: ListWithRole[]) => ListWithRole[])) => void
  beginLocalCatalogPersistence: () => void
  endLocalCatalogPersistence: () => void
}

export const useListsCatalogStore = create<ListsCatalogState & ListsCatalogActions>((set, get) => ({
  activeUserId: null,
  listsCatalogStatus: 'idle',
  lists: [],
  localCatalogMutationDepth: 0,
  catalogSessionEpoch: 0,

  clearListsCatalog: () =>
    set((s) => ({
      activeUserId: null,
      listsCatalogStatus: 'idle',
      lists: [],
      catalogSessionEpoch: s.catalogSessionEpoch + 1,
    })),

  beginHomeSession: (userId, cachedLists) => {
    const lists = cachedLists ? [...cachedLists] : []
    let nextEpoch = 0
    set((s) => {
      nextEpoch = s.catalogSessionEpoch + 1
      return {
        activeUserId: userId,
        listsCatalogStatus: lists.length > 0 ? 'ready' : 'loading',
        lists,
        catalogSessionEpoch: nextEpoch,
      }
    })
    return nextEpoch
  },

  applyWarmResult: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    set({ lists, listsCatalogStatus: 'ready' })
  },

  applyL2BridgePayload: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    if (st.localCatalogMutationDepth > 0) return
    set({
      lists,
      ...(st.listsCatalogStatus !== 'ready' ? { listsCatalogStatus: 'ready' as const } : {}),
    })
  },

  setCatalogLists: (updater) =>
    set((s) => ({
      lists: typeof updater === 'function' ? (updater as (p: ListWithRole[]) => ListWithRole[])(s.lists) : updater,
    })),

  beginLocalCatalogPersistence: () => set((s) => ({ localCatalogMutationDepth: s.localCatalogMutationDepth + 1 })),

  endLocalCatalogPersistence: () =>
    set((s) => ({ localCatalogMutationDepth: Math.max(0, s.localCatalogMutationDepth - 1) })),
}))

/**
 * Apply Dexie catalog rows for `userId`. Never switches `activeUserId` — only
 * `beginHomeSession` / `bootstrapListsCatalogSession` may start a new actor session.
 */
export async function warmListsCatalog(userId: string, sessionEpoch?: number): Promise<void> {
  const rows = await buildListsCatalogFromDexie(userId)
  const st = useListsCatalogStore.getState()
  if (st.activeUserId !== userId) return
  if (sessionEpoch != null && st.catalogSessionEpoch !== sessionEpoch) return
  st.applyWarmResult(userId, rows)
}

/** Begin catalog session + Dexie warm (actor change: sign-in, sign-out, refresh). */
export async function bootstrapListsCatalogSession(userId: string): Promise<void> {
  const cachedLists = getCachedLists(userId)?.lists ?? []
  const store = useListsCatalogStore.getState()
  const epoch = store.beginHomeSession(userId, cachedLists.length > 0 ? cachedLists : null)
  await warmListsCatalog(userId, epoch)
}

export function subscribeListsCatalogL2Bridge(userId: string): () => void {
  const subscription = liveQuery(async () => buildListsCatalogFromDexie(userId)).subscribe({
    next: (lists) => {
      useListsCatalogStore.getState().applyL2BridgePayload(userId, lists)
    },
    error: (err) => {
      if (DIAGNOSTICS_DATA_COLLECTION_ENABLED) {
        console.error('[listsCatalogStore] L2 bridge liveQuery error', err)
      }
    },
  })
  return () => subscription.unsubscribe()
}
