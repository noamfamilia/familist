'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
import { buildListsCatalogFromDexie } from '@/lib/data/queries'
import type { ListWithRole } from '@/lib/supabase/types'

export type ListsCatalogStatus = 'idle' | 'loading' | 'ready'

type ListsCatalogState = {
  activeUserId: string | null
  listsCatalogStatus: ListsCatalogStatus
  lists: ListWithRole[]
  localCatalogMutationDepth: number
}

type ListsCatalogActions = {
  clearListsCatalog: () => void
  beginHomeSession: (userId: string, cachedLists: ListWithRole[] | null) => void
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

  clearListsCatalog: () =>
    set({
      activeUserId: null,
      listsCatalogStatus: 'idle',
      lists: [],
    }),

  beginHomeSession: (userId, cachedLists) =>
    set({
      activeUserId: userId,
      listsCatalogStatus: 'loading',
      lists: cachedLists ? [...cachedLists] : [],
    }),

  applyWarmResult: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    set({ lists, listsCatalogStatus: 'ready' })
  },

  applyL2BridgePayload: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    if (st.localCatalogMutationDepth > 0) return
    set({ lists })
  },

  setCatalogLists: (updater) =>
    set((s) => ({
      lists: typeof updater === 'function' ? (updater as (p: ListWithRole[]) => ListWithRole[])(s.lists) : updater,
    })),

  beginLocalCatalogPersistence: () => set((s) => ({ localCatalogMutationDepth: s.localCatalogMutationDepth + 1 })),

  endLocalCatalogPersistence: () =>
    set((s) => ({ localCatalogMutationDepth: Math.max(0, s.localCatalogMutationDepth - 1) })),
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
