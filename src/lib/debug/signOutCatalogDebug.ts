'use client'

import { create } from 'zustand'
import { useListsCatalogStore } from '@/stores/listsCatalogStore'
import type { ListsCatalogStatus } from '@/stores/listsCatalogStore'

export type SignOutTracePayload = {
  authUserId?: string | null
  guestId?: string | null
  bootstrapUserId?: string | null
  resolvedUserId?: string | null
  selectedActiveUserId?: string | null
  selectedStatus?: ListsCatalogStatus | string | null
  selectedListsLen?: number
  selectedEpoch?: number
  directActiveUserId?: string | null
  directStatus?: ListsCatalogStatus | string | null
  directListsLen?: number
  directEpoch?: number
  selectedMatchesResolved?: boolean
  directMatchesResolved?: boolean
  selectorDirectMismatch?: boolean
  actorListsLen?: number
  loading?: boolean
  emptyState?: boolean
  listsViewRenderedCardsLen?: number
  renderCountUseLists?: number
  renderCountListsView?: number
  showListsShell?: boolean
  authLoading?: boolean
  hasMounted?: boolean
  uiMode?: 'spinner' | 'empty' | 'cards' | 'hidden'
  first3ListIds?: string[]
  note?: string
  [key: string]: unknown
}

export type SignOutCatalogDebugEntry = {
  id: number
  line: string
}

type SignOutCatalogDebugState = {
  entries: SignOutCatalogDebugEntry[]
  modalOpen: boolean
}

type SignOutCatalogDebugActions = {
  beginSession: (label: string) => void
  clear: () => void
  setModalOpen: (open: boolean) => void
  openModal: () => void
}

let traceSeq = 0
let sessionStartMs = 0
let useListsRenderCount = 0
let listsViewRenderCount = 0
let storeUnsub: (() => void) | null = null
let lastTracePayload: SignOutTracePayload | null = null

function first3Ids(ids: string[] | undefined): string[] {
  return (ids ?? []).slice(0, 3)
}

function storeDirectFields() {
  const s = useListsCatalogStore.getState()
  return {
    directActiveUserId: s.activeUserId,
    directStatus: s.listsCatalogStatus,
    directListsLen: s.lists.length,
    directEpoch: s.catalogSessionEpoch,
    first3ListIds: first3Ids(s.lists.map((l) => l.id)),
  }
}

function buildTracePayload(tag: string, extra: SignOutTracePayload = {}): SignOutTracePayload {
  const direct = storeDirectFields()
  const resolved = extra.resolvedUserId ?? extra.selectedActiveUserId ?? null
  const selectedActiveUserId = extra.selectedActiveUserId ?? null
  const selectedListsLen = extra.selectedListsLen ?? 0
  const payload: SignOutTracePayload = {
    ...direct,
    ...extra,
    selectedActiveUserId,
    selectedListsLen,
    selectedMatchesResolved:
      extra.selectedMatchesResolved ??
      Boolean(resolved && selectedActiveUserId && resolved === selectedActiveUserId),
    directMatchesResolved:
      extra.directMatchesResolved ??
      Boolean(resolved && direct.directActiveUserId && resolved === direct.directActiveUserId),
    selectorDirectMismatch:
      extra.selectorDirectMismatch ??
      Boolean(
        selectedActiveUserId !== direct.directActiveUserId ||
          selectedListsLen !== direct.directListsLen,
      ),
    first3ListIds: extra.first3ListIds ?? direct.first3ListIds,
  }
  return payload
}

function formatTraceLine(seq: number, elapsedMs: number, tag: string, payload: SignOutTracePayload): string {
  return `TRACE seq=${seq} t=${elapsedMs} tag=${tag}\n${JSON.stringify(payload)}`
}

export const useSignOutCatalogDebugStore = create<SignOutCatalogDebugState & SignOutCatalogDebugActions>(
  (set, get) => ({
    entries: [],
    modalOpen: false,

    beginSession: (_label) => {
      traceSeq = 0
      sessionStartMs = Date.now()
      useListsRenderCount = 0
      listsViewRenderCount = 0
      lastTracePayload = null
      storeUnsub?.()
      storeUnsub = useListsCatalogStore.subscribe((state, prevState) => {
        signOutTrace('store:subscribe fired', {
          beforeActiveUserId: prevState.activeUserId,
          beforeStatus: prevState.listsCatalogStatus,
          beforeListsLen: prevState.lists.length,
          beforeEpoch: prevState.catalogSessionEpoch,
          afterActiveUserId: state.activeUserId,
          afterStatus: state.listsCatalogStatus,
          afterListsLen: state.lists.length,
          afterEpoch: state.catalogSessionEpoch,
        })
      })
      set({ entries: [], modalOpen: false })
    },

    clear: () => {
      traceSeq = 0
      sessionStartMs = Date.now()
      set({ entries: [] })
      signOutTrace('session', { note: 'log cleared' })
    },

    setModalOpen: (open) => set({ modalOpen: open }),

    openModal: () => set({ modalOpen: true }),
  }),
)

/** Compact one-line-per-event sign-out render trace (only after beginSession). */
export function signOutTrace(tag: string, extra: SignOutTracePayload = {}): void {
  if (!sessionStartMs) return
  const elapsedMs = Date.now() - sessionStartMs
  const seq = ++traceSeq
  const payload = buildTracePayload(tag, extra)
  lastTracePayload = payload
  const line = formatTraceLine(seq, elapsedMs, tag, payload)
  const st = useSignOutCatalogDebugStore.getState()
  useSignOutCatalogDebugStore.setState({
    entries: [...st.entries, { id: seq, line }],
  })
  if (process.env.NODE_ENV === 'development') {
    console.info(line)
  }
}

export function bumpUseListsRenderCount(): number {
  useListsRenderCount += 1
  return useListsRenderCount
}

export function getUseListsRenderCount(): number {
  return useListsRenderCount
}

export function bumpListsViewRenderCount(): number {
  listsViewRenderCount += 1
  return listsViewRenderCount
}

export function formatSignOutCatalogDebugLog(entries: SignOutCatalogDebugEntry[]): string {
  return entries.map((e) => e.line).join('\n\n')
}

/** @deprecated use signOutTrace */
export function signOutCatalogDebugLog(_phase: string, _message: string, data?: Record<string, unknown>): void {
  signOutTrace(_phase, { note: _message, ...data })
}

let pageShellGate: SignOutTracePayload = {}

/** Latest home shell gate (merged into delayed snapshots). */
export function registerPageShellGate(payload: SignOutTracePayload): void {
  pageShellGate = payload
}

export function schedulePostSignOutDelayedSnapshots(_guestId: string): void {
  const delays: Array<{ tag: string; ms: number }> = [
    { tag: 'delayed:250ms', ms: 250 },
    { tag: 'delayed:1000ms', ms: 1000 },
    { tag: 'delayed:3000ms', ms: 3000 },
  ]
  for (const { tag, ms } of delays) {
    const run = () => {
      signOutTrace(tag, {
        ...(lastTracePayload ?? {}),
        ...pageShellGate,
        note: 'delayed snapshot',
        ...storeDirectFields(),
        renderCountUseLists: useListsRenderCount,
        renderCountListsView: listsViewRenderCount,
      })
    }
    if (ms === 0) run()
    else setTimeout(run, ms)
  }
}
