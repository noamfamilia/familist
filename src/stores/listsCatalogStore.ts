'use client'

import { liveQuery } from 'dexie'
import { create } from 'zustand'
import { DIAGNOSTICS_DATA_COLLECTION_ENABLED } from '@/lib/diagnosticsFlags'
import { getCachedLists } from '@/lib/cache'
import { signOutCatalogDebugLog, catalogStoreSnapshot } from '@/lib/debug/signOutCatalogDebug'
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
export async function warmListsCatalog(
  userId: string,
  sessionEpoch?: number,
  source = 'unknown',
): Promise<{ applied: boolean; dexieLength: number; discardReason?: string }> {
  const before = useListsCatalogStore.getState()
  signOutCatalogDebugLog('warmListsCatalog', `start source=${source}`, {
    userId,
    sessionEpoch: sessionEpoch ?? null,
    storeBefore: catalogStoreSnapshot(),
  })

  const rows = await buildListsCatalogFromDexie(userId)
  const st = useListsCatalogStore.getState()

  let discardReason: string | undefined
  if (st.activeUserId !== userId) {
    discardReason = `activeUserId mismatch (store=${st.activeUserId ?? 'null'} expected=${userId})`
  } else if (sessionEpoch != null && st.catalogSessionEpoch !== sessionEpoch) {
    discardReason = `epoch mismatch (store=${st.catalogSessionEpoch} expected=${sessionEpoch})`
  }

  if (discardReason) {
    signOutCatalogDebugLog('warmListsCatalog', `DISCARDED source=${source}`, {
      userId,
      dexieLength: rows.length,
      discardReason,
      storeAfter: catalogStoreSnapshot(),
    })
    return { applied: false, dexieLength: rows.length, discardReason }
  }

  st.applyWarmResult(userId, rows)
  signOutCatalogDebugLog('warmListsCatalog', `APPLIED source=${source}`, {
    userId,
    dexieLength: rows.length,
    storeAfter: catalogStoreSnapshot(),
  })
  return { applied: true, dexieLength: rows.length }
}

/** Begin catalog session + Dexie warm (actor change: sign-in, sign-out, refresh). */
export async function bootstrapListsCatalogSession(userId: string, source = 'unknown'): Promise<void> {
  const storeBefore = useListsCatalogStore.getState()
  const cachedLists = getCachedLists(userId)?.lists ?? []
  const epochBefore = storeBefore.catalogSessionEpoch

  signOutCatalogDebugLog('bootstrap', `start source=${source}`, {
    userId,
    activeUserIdBefore: storeBefore.activeUserId,
    epochBefore,
    cachedListsLength: cachedLists.length,
    cachedListIds: cachedLists.map((l) => l.id),
    storeBefore: catalogStoreSnapshot(),
  })

  const store = useListsCatalogStore.getState()
  const epoch = store.beginHomeSession(userId, cachedLists.length > 0 ? cachedLists : null)
  const afterBegin = useListsCatalogStore.getState()

  signOutCatalogDebugLog('bootstrap', `after beginHomeSession source=${source}`, {
    userId,
    epochBefore,
    epochAfter: epoch,
    listsLengthAfterBegin: afterBegin.lists.length,
    statusAfterBegin: afterBegin.listsCatalogStatus,
    listIdsAfterBegin: afterBegin.lists.map((l) => l.id),
  })

  const warm = await warmListsCatalog(userId, epoch, source)
  const final = useListsCatalogStore.getState()

  signOutCatalogDebugLog('bootstrap', `end source=${source}`, {
    userId,
    warmApplied: warm.applied,
    warmDexieLength: warm.dexieLength,
    warmDiscardReason: warm.discardReason ?? null,
    finalActiveUserId: final.activeUserId,
    finalListsLength: final.lists.length,
    finalStatus: final.listsCatalogStatus,
    finalEpoch: final.catalogSessionEpoch,
    finalListIds: final.lists.map((l) => l.id),
  })
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
