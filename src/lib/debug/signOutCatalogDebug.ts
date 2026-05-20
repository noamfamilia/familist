'use client'

import { create } from 'zustand'
import { getCachedLists } from '@/lib/cache'
import { db } from '@/lib/db'
import { logHomeCatalogEmptyPathsAudit } from '@/lib/debug/homeCatalogEmptyPathsAudit'
import { getStoredGuestId } from '@/lib/guestSession'
import { useListsCatalogStore } from '@/stores/listsCatalogStore'

export type SignOutCatalogDebugEntry = {
  id: number
  ts: string
  elapsedMs: number
  phase: string
  message: string
  data?: Record<string, unknown>
}

type SignOutCatalogDebugState = {
  entries: SignOutCatalogDebugEntry[]
  modalOpen: boolean
  sessionStartMs: number
  nextId: number
}

type SignOutCatalogDebugActions = {
  beginSession: (label: string) => void
  append: (phase: string, message: string, data?: Record<string, unknown>) => void
  clear: () => void
  setModalOpen: (open: boolean) => void
  openModal: () => void
}

let idCounter = 0

export type HomeRenderDebugSnapshot = {
  at: string
  delayMs?: number
  catalogStore: Record<string, unknown>
  useListsHook: Record<string, unknown> | null
  listsViewRender: Record<string, unknown> | null
}

let lastUseListsHookSnapshot: Record<string, unknown> | null = null
let lastListsViewRenderSnapshot: Record<string, unknown> | null = null

export function registerUseListsHookSnapshot(snapshot: Record<string, unknown>): void {
  lastUseListsHookSnapshot = snapshot
}

export function registerListsViewRenderSnapshot(snapshot: Record<string, unknown>): void {
  lastListsViewRenderSnapshot = snapshot
}

function listIdNamePairs(lists: { id: string; name: string }[]): { id: string; name: string }[] {
  return lists.map((l) => ({ id: l.id, name: l.name }))
}

function readFamilistGuestIdFromLocalStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('familist_guest_id')
  } catch {
    return null
  }
}

export const useSignOutCatalogDebugStore = create<SignOutCatalogDebugState & SignOutCatalogDebugActions>(
  (set, get) => ({
    entries: [],
    modalOpen: false,
    sessionStartMs: 0,
    nextId: 0,

    beginSession: (label) => {
      const now = Date.now()
      idCounter = 0
      lastUseListsHookSnapshot = null
      lastListsViewRenderSnapshot = null
      set({
        entries: [],
        sessionStartMs: now,
        nextId: 0,
      })
      get().append('session', label, { iso: new Date(now).toISOString() })
      logHomeCatalogEmptyPathsAudit()
    },

    append: (phase, message, data) => {
      const st = get()
      const now = Date.now()
      const entry: SignOutCatalogDebugEntry = {
        id: ++idCounter,
        ts: new Date(now).toISOString().slice(11, 23),
        elapsedMs: st.sessionStartMs ? now - st.sessionStartMs : 0,
        phase,
        message,
        data,
      }
      set({ entries: [...st.entries, entry], nextId: entry.id })
      if (process.env.NODE_ENV === 'development') {
        console.info(`[signOutCatalogDebug] [${phase}] ${message}`, data ?? '')
      }
    },

    clear: () => {
      const now = Date.now()
      set({ entries: [], sessionStartMs: now, nextId: 0 })
      get().append('session', 'log cleared', { iso: new Date(now).toISOString() })
    },

    setModalOpen: (open) => set({ modalOpen: open }),

    openModal: () => set({ modalOpen: true }),
  }),
)

/** Append a structured sign-out / catalog debug line (always captured in-memory). */
export function signOutCatalogDebugLog(
  phase: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  useSignOutCatalogDebugStore.getState().append(phase, message, data)
}

export function formatSignOutCatalogDebugLog(entries: SignOutCatalogDebugEntry[]): string {
  return entries
    .map((e) => {
      const payload = e.data ? ` ${JSON.stringify(e.data, null, 0)}` : ''
      return `[${e.ts} +${e.elapsedMs}ms] [${e.phase}] ${e.message}${payload}`
    })
    .join('\n')
}

export function catalogStoreSnapshot(): Record<string, unknown> {
  const s = useListsCatalogStore.getState()
  return {
    activeUserId: s.activeUserId,
    listsCatalogStatus: s.listsCatalogStatus,
    listsLength: s.lists.length,
    catalogSessionEpoch: s.catalogSessionEpoch,
    listIds: s.lists.map((l) => l.id),
    listIdNames: listIdNamePairs(s.lists),
  }
}

function delayedRenderSnapshot(delayMs: number): HomeRenderDebugSnapshot {
  return {
    at: new Date().toISOString(),
    delayMs,
    catalogStore: catalogStoreSnapshot(),
    useListsHook: lastUseListsHookSnapshot,
    listsViewRender: lastListsViewRenderSnapshot,
  }
}

/** Post-sign-out UI snapshots — focus on store vs hook vs ListsView desync. */
export function schedulePostSignOutDelayedSnapshots(guestId: string): void {
  const delays = [0, 250, 1000, 3000] as const
  for (const delayMs of delays) {
    const run = () => {
      signOutCatalogDebugLog('postSignOutUI', `delayed snapshot +${delayMs}ms`, {
        guestId,
        ...delayedRenderSnapshot(delayMs),
      })
    }
    if (delayMs === 0) run()
    else setTimeout(run, delayMs)
  }
}

/** Dexie + cache snapshot for guest catalog debugging. */
export async function logDexieGuestCatalogSnapshot(
  guestId: string,
  source: string,
): Promise<void> {
  const lsGuestId = readFamilistGuestIdFromLocalStorage()
  const storedGuestId = getStoredGuestId()
  const cached = getCachedLists(guestId)?.lists ?? []

  const memberships = await db.list_users.where('user_id').equals(guestId).toArray()
  const listIds = memberships.map((m) => m.list_id)
  const listsTotal = await db.lists.count()

  const listRows: { listId: string; listExists: boolean; listName: string | null; role: string }[] = []
  for (const m of memberships) {
    const row = await db.lists.get(m.list_id)
    listRows.push({
      listId: m.list_id,
      listExists: !!row,
      listName: row?.name ?? null,
      role: m.role,
    })
  }

  signOutCatalogDebugLog('dexie', `guest catalog snapshot (${source})`, {
    guestId,
    localStorage_familist_guest_id: lsGuestId,
    getStoredGuestId: storedGuestId,
    list_users_count: memberships.length,
    list_users_list_ids: listIds,
    lists_table_total_count: listsTotal,
    cached_lists_length: cached.length,
    cached_list_ids: cached.map((l) => l.id),
    membership_details: listRows,
    catalogStore: catalogStoreSnapshot(),
  })
}
