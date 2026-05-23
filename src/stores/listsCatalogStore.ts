'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
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
    const incoming = cachedLists ? [...cachedLists] : []
    const st = get()

    if (st.activeUserId === userId) {
      if (st.lists.length > 0 && incoming.length === 0) {
        return st.catalogSessionEpoch
      }
      if (st.lists.length > 0) {
        return st.catalogSessionEpoch
      }
      if (incoming.length > 0) {
        const lists = [...incoming]
        set({ lists, listsCatalogStatus: 'ready' })
        return st.catalogSessionEpoch
      }
      if (st.listsCatalogStatus === 'loading') {
        return st.catalogSessionEpoch
      }
    }

    const lists = [...incoming]
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
    const nextLists = [...lists]
    set({ lists: nextLists, listsCatalogStatus: 'ready' })
  },

  applyL2BridgePayload: (userId, lists) => {
    const st = get()
    if (st.activeUserId !== userId) return
    if (st.localCatalogMutationDepth > 0) return
    const nextLists = [...lists]
    set({
      lists: nextLists,
      ...(st.listsCatalogStatus !== 'ready' ? { listsCatalogStatus: 'ready' as const } : {}),
    })
  },

  setCatalogLists: (updater) =>
    set((s) => {
      const next =
        typeof updater === 'function'
          ? [...(updater as (p: ListWithRole[]) => ListWithRole[])(s.lists)]
          : [...updater]
      return { lists: next }
    }),

  beginLocalCatalogPersistence: () => set((s) => ({ localCatalogMutationDepth: s.localCatalogMutationDepth + 1 })),

  endLocalCatalogPersistence: () =>
    set((s) => ({ localCatalogMutationDepth: Math.max(0, s.localCatalogMutationDepth - 1) })),
}))

/**
 * Apply Dexie catalog rows for `userId`. Never switches `activeUserId` — only
 * `beginHomeSession` / `bootstrapListsCatalogSession` may start a new actor session.
 */
export async function warmListsCatalog(
  userId: string,
  sessionEpoch?: number,
  _source = 'unknown',
): Promise<{ applied: boolean; dexieLength: number; discardReason?: string }> {
  const rows = await buildListsCatalogFromDexie(userId)
  const st = useListsCatalogStore.getState()

  let discardReason: string | undefined
  if (st.activeUserId !== userId) {
    discardReason = `activeUserId mismatch (store=${st.activeUserId ?? 'null'} expected=${userId})`
  } else if (sessionEpoch != null && st.catalogSessionEpoch !== sessionEpoch) {
    discardReason = `epoch mismatch (store=${st.catalogSessionEpoch} expected=${sessionEpoch})`
  }

  if (discardReason) {
    return { applied: false, dexieLength: rows.length, discardReason }
  }

  st.applyWarmResult(userId, rows)
  return { applied: true, dexieLength: rows.length }
}

/** Begin catalog session + Dexie warm (actor change: sign-in, sign-out, refresh). */
export async function bootstrapListsCatalogSession(userId: string, _source = 'unknown'): Promise<void> {
  const storeBefore = useListsCatalogStore.getState()
  const cachedLists = getCachedLists(userId)?.lists ?? []

  if (
    storeBefore.activeUserId === userId &&
    storeBefore.lists.length > 0 &&
    storeBefore.listsCatalogStatus === 'ready'
  ) {
    return
  }

  if (storeBefore.activeUserId === userId && storeBefore.listsCatalogStatus === 'loading') {
    await warmListsCatalog(userId, storeBefore.catalogSessionEpoch, _source)
    return
  }

  const epoch = useListsCatalogStore.getState().beginHomeSession(
    userId,
    cachedLists.length > 0 ? cachedLists : null,
  )
  await warmListsCatalog(userId, epoch, _source)
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
