'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DbSyncQueueRow } from '@/lib/db'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { createClient } from '@/lib/supabase/client'
import {
  isLikelyConnectivityError,
  isOutboundSyncTerminalError,
  resolveOutboundRetryDelayMs,
  shouldSetListUserSyncErrorAfterOutboundFailure,
} from '@/lib/connectivityErrors'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { useToast } from '@/components/ui/Toast'
import { syncListDetail, syncLists } from '@/lib/data/sync'
import { getActiveCacheUserId } from '@/lib/cache'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'
import { scrubAfterTerminalOutboundFailure } from '@/lib/data/outboundTerminalScrub'
import { applyListUserSyncErrorForListIds } from '@/lib/data/listUserSyncStatus'
import { clearListSyncErrorMessages, setListSyncErrorMessages } from '@/lib/data/listSyncErrorMessage'
import { isoNow } from '@/lib/data/base_sync_fields'
import {
  cleanupDexieAfterItemMemberStateServerDeleted,
  cleanupDexieAfterItemServerDeleted,
  cleanupDexieAfterListServerDeleted,
  cleanupDexieAfterMemberServerDeleted,
} from '@/lib/data/shadowDeleteDexieCleanup'
import { resetFailedSyncQueueRows } from '@/lib/data/syncQueue'
import { subscribeOutboundSyncKick } from '@/lib/outboundSyncKick'
import { normalizeServerSyncableFields, upsertListDataPayloadFromServer } from '@/lib/data/serverDexieParity'
import { describeOutboundSyncRow } from '@/lib/data/outboundSyncDescription'
import { logServerRoundTrip } from '@/lib/serverActionLog'
import {
  normalizeItemCategory,
  type ItemWithState,
  type List,
  type MemberWithCreator,
} from '@/lib/supabase/types'
import { useListsCatalogStore } from '@/stores/listsCatalogStore'
import { useListDataStore } from '@/stores/listDataStore'

const supabase = createClient()

const LOCK_STALE_MS = 60_000
const CONNECTIVITY_RETRY_DELAY_MS = 2_000

/** First list id for verification (`syncListDetail`); multi-list RPCs use the primary id only here. */
function rowListIdForSync(row: DbSyncQueueRow): string | null {
  const ids = listIdsTouchingOutboundRow(row)
  return ids[0] ?? null
}

function queueDiagKey(row: DbSyncQueueRow): string {
  return row.entity_id
}

type CreateListRpcEnvelope = {
  list?: Record<string, unknown>
  display_name_changed?: boolean
  requested_name?: string
}

type UpsertItemRpcEnvelope = {
  item?: Record<string, unknown>
  display_name_changed?: boolean
  requested_text?: string
}

type UpsertMemberRpcEnvelope = {
  member?: Record<string, unknown>
  display_name_changed?: boolean
  requested_name?: string | null
}

type ApplyItemPatchRpcEnvelope = {
  item?: Record<string, unknown>
  display_name_changed?: boolean
  requested_text?: string | null
}

type ApplyListPatchRpcEnvelope = {
  list?: Record<string, unknown>
  display_name_changed?: boolean
  requested_name?: string | null
}

async function mergeDedupedMemberNameFromRpc(
  memberId: string,
  listId: string,
  env: UpsertMemberRpcEnvelope,
  showInfoToast: (message: string) => void,
): Promise<void> {
  if (!env?.display_name_changed || !env.member) return
  const newName = typeof env.member.name === 'string' ? env.member.name : String(env.member.name ?? '')
  const serverUpdatedAt =
    typeof env.member.updated_at === 'string' ? env.member.updated_at : isoNow()
  if (!newName) return
  await db.members.update(memberId, {
    name: newName,
    updated_at: serverUpdatedAt,
  })
  const { activeListId, setMembers } = useListDataStore.getState()
  if (activeListId === listId) {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId ? { ...m, name: newName, updated_at: serverUpdatedAt } : m,
      ),
    )
  }
  const label = newName.length > 40 ? `${newName.slice(0, 37)}…` : newName
  showInfoToast(`Member renamed to avoid a name collision (“${label}”).`)
}

async function mergeDedupedItemTextFromPatchRpc(
  itemId: string,
  listId: string,
  env: ApplyItemPatchRpcEnvelope,
  showInfoToast: (message: string) => void,
): Promise<void> {
  if (!env?.display_name_changed || !env.item) return
  const newText = typeof env.item.text === 'string' ? env.item.text : String(env.item.text ?? '')
  const serverUpdatedAt =
    typeof env.item.updated_at === 'string' ? env.item.updated_at : isoNow()
  if (!newText) return
  await db.items.update(itemId, { text: newText, updated_at: serverUpdatedAt })
  const { activeListId, setItems } = useListDataStore.getState()
  if (activeListId === listId) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, text: newText, updated_at: serverUpdatedAt } : i,
      ),
    )
  }
  const label = newText.length > 40 ? `${newText.slice(0, 37)}…` : newText
  showInfoToast(`Item renamed to avoid a name collision (“${label}”).`)
}

async function mergeDedupedListNameFromPatchRpc(
  listId: string,
  env: ApplyListPatchRpcEnvelope,
  showInfoToast: (message: string) => void,
): Promise<void> {
  if (!env?.display_name_changed || !env.list) return
  const name = typeof env.list.name === 'string' ? env.list.name : String(env.list.name ?? '')
  const updatedAt =
    typeof env.list.updated_at === 'string' ? env.list.updated_at : isoNow()
  if (!name) return
  await db.lists.update(listId, {
    name,
    updated_at: updatedAt,
    cached_at: Date.now(),
  })
  useListsCatalogStore.getState().setCatalogLists((prev) =>
    prev.map((l) => (l.id === listId ? { ...l, name } : l)),
  )
  const label = name.length > 40 ? `${name.slice(0, 37)}…` : name
  showInfoToast(`List renamed to avoid a name collision (“${label}”).`)
}

function readBulkLineTextChanges(
  data: unknown,
): Array<{ item_id: string; requested_text: string; text: string }> {
  if (!data || typeof data !== 'object') return []
  const rec = data as Record<string, unknown>
  const raw = rec.line_text_changes
  if (!Array.isArray(raw)) return []
  const out: Array<{ item_id: string; requested_text: string; text: string }> = []
  for (const el of raw) {
    if (!el || typeof el !== 'object') continue
    const o = el as Record<string, unknown>
    const itemId = typeof o.item_id === 'string' ? o.item_id : String(o.item_id ?? '')
    if (!itemId) continue
    out.push({
      item_id: itemId,
      requested_text: typeof o.requested_text === 'string' ? o.requested_text : String(o.requested_text ?? ''),
      text: typeof o.text === 'string' ? o.text : String(o.text ?? ''),
    })
  }
  return out
}

/** Best-effort names from Dexie for sync diagnostics (e.g. bulk label RPC failures). */
async function localListNamesForIds(ids: string[]): Promise<string> {
  if (ids.length === 0) return ''
  try {
    await db.open()
    const rows = await Promise.all(ids.map((id) => db.lists.get(id)))
    return ids
      .map((id, i) => {
        const raw = rows[i]?.name
        if (raw == null || raw === '') return `${id}:—`
        const n = String(raw).replace(/\s+/g, ' ').trim().slice(0, 80)
        return `${id}:${n || '—'}`
      })
      .join('; ')
  } catch {
    return '(local names unavailable)'
  }
}

function isEligibleForSync(row: DbSyncQueueRow, now: number): boolean {
  const nr = row.next_retry_at ?? null
  const stale = row.locked_at != null && now - row.locked_at > LOCK_STALE_MS

  if (row.status === 'processing') {
    return stale
  }
  if (row.status === 'queued') {
    return nr == null || nr <= now
  }
  if (row.status === 'failed') {
    return nr == null || nr <= now
  }
  return false
}

async function tryClaimSyncRow(id: string): Promise<DbSyncQueueRow | null> {
  return db.transaction('rw', db.sync_queue, async () => {
    const row = await db.sync_queue.get(id)
    if (!row) return null
    const now = Date.now()
    const nr = row.next_retry_at ?? null
    const stale = row.locked_at != null && now - row.locked_at > LOCK_STALE_MS

    if (row.status === 'processing') {
      if (!stale) return null
      await db.sync_queue.update(id, { locked_at: now, updated_at: now })
      return (await db.sync_queue.get(id)) ?? null
    }

    if (row.status === 'queued') {
      if (nr != null && nr > now) return null
      await db.sync_queue.update(id, {
        status: 'processing',
        locked_at: now,
        updated_at: now,
      })
      return (await db.sync_queue.get(id)) ?? null
    }

    if (row.status === 'failed') {
      if (nr != null && nr > now) return null
      await db.sync_queue.update(id, {
        status: 'processing',
        locked_at: now,
        updated_at: now,
      })
      return (await db.sync_queue.get(id)) ?? null
    }

    return null
  })
}

async function releaseRowForConnectivityRetry(rowId: string): Promise<void> {
  const now = Date.now()
  await db.sync_queue.update(rowId, {
    status: 'queued',
    locked_at: null,
    next_retry_at: now + CONNECTIVITY_RETRY_DELAY_MS,
    updated_at: now,
  })
}

async function markRowFailedAfterError(row: DbSyncQueueRow, message: string, error: unknown): Promise<void> {
  const now = Date.now()
  const ac = row.attempt_count + 1
  await db.sync_queue.update(row.id, {
    status: 'failed',
    attempt_count: ac,
    last_error: message,
    locked_at: null,
    next_retry_at: now + resolveOutboundRetryDelayMs(error, ac),
    updated_at: now,
  })
}

type SyncStoreState = {
  pendingCount: number
  isDraining: boolean
  lastError: string | null
  hasSyncFailures: boolean
}

export function useSyncStore(): SyncStoreState {
  const allRows = useLiveQuery(async () => db.sync_queue.orderBy('updated_at').toArray(), [], [])
  const rows = useMemo(() => allRows ?? [], [allRows])
  const { status, markOnlineRecovered } = useConnectivity()
  const statusRef = useRef(status)
  useEffect(() => {
    statusRef.current = status
  }, [status])

  useLayoutEffect(() => {
    return subscribeOutboundSyncKick(() => {
      void resetFailedSyncQueueRows()
      setOutboundSyncKick((n) => n + 1)
    })
  }, [])

  const { error: showErrorToast, info: showInfoToast } = useToast()
  const drainingRef = useRef(false)
  const [isDraining, setIsDraining] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [retryPulse, setRetryPulse] = useState(0)
  const [outboundSyncKick, setOutboundSyncKick] = useState(0)

  const normalizeErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
      const record = error as { message?: unknown; details?: unknown; code?: unknown }
      const message = typeof record.message === 'string' ? record.message : String(record.message ?? '')
      const details = typeof record.details === 'string' ? record.details : String(record.details ?? '')
      const code = typeof record.code === 'string' ? record.code : String(record.code ?? '')
      const parts = [message, details, code].filter((p) => p && p !== 'undefined' && p !== 'null')
      if (parts.length > 0) return parts.join(' | ')
    }
    return String(error ?? 'Unknown sync error')
  }, [])

  const resolveSyncUserId = useCallback((payloadUserId?: unknown): string | null => {
    if (typeof payloadUserId === 'string' && payloadUserId) return payloadUserId
    return getActiveCacheUserId()
  }, [])

  const isVirtualUserListKey = (listId: string): boolean => listId.startsWith('user:')

  const verifyMutationApplied = useCallback(
    async (row: DbSyncQueueRow): Promise<boolean> => {
      const userId = resolveSyncUserId((row.payload as { user_id?: unknown })?.user_id)
      if (!userId) return true
      await syncLists(userId, 'Post-mutation verification: list catalog')
      const listId = rowListIdForSync(row)
      if (listId && !isVirtualUserListKey(listId)) {
        const pl = row.payload as { method?: unknown }
        const skipListDetail =
          (row.kind === 'rpc' && String(pl?.method ?? '') === 'leaveList') || row.kind === 'patch'
        if (!skipListDetail) {
          await syncListDetail(userId, listId, 'Post-mutation verification: list detail')
        }
      }
      return true
    },
    [resolveSyncUserId],
  )

  const executeOutboundRow = useCallback(
    async (row: DbSyncQueueRow): Promise<void> => {
      const t0 = performance.now()
      const description = await describeOutboundSyncRow(row)
      const respondsTo = `Sync queue · ${row.kind}/${row.entity}`
      appendMutationDiagnostic(
        `[sync->server] send kind=${row.kind} entity=${row.entity} key=${queueDiagKey(row)}`,
      )
      try {
      if (row.kind === 'delete') {
        if (row.entity === 'item') {
          const id = String(row.payload.id ?? '')
          if (id) {
            const { error } = await supabase.from('items').delete().eq('id', id)
            if (error) throw error
            const listHint = row.parent1_type === 'list' ? row.parent1_id : null
            await cleanupDexieAfterItemServerDeleted(id, listHint)
          }
        } else if (row.entity === 'member') {
          const id = String(row.payload.id ?? '')
          if (id) {
            const { error } = await supabase.rpc('delete_member', { p_member_id: id })
            if (error) throw error
            await cleanupDexieAfterMemberServerDeleted(id)
          }
        } else if (row.entity === 'item_member_state') {
          const itemId = String(row.payload.item_id ?? '')
          const memberId = String(row.payload.member_id ?? '')
          if (itemId && memberId) {
            const { error } = await supabase
              .from('item_member_state')
              .delete()
              .eq('item_id', itemId)
              .eq('member_id', memberId)
            if (error) throw error
            await cleanupDexieAfterItemMemberStateServerDeleted(itemId, memberId)
          }
        } else if (row.entity === 'list') {
          const id = String(row.payload.id ?? '')
          if (id) {
            const { error } = await supabase.from('lists').delete().eq('id', id)
            if (error) throw error
            await cleanupDexieAfterListServerDeleted(id)
          }
        }
        appendMutationDiagnostic(
          `[sync<-server] ok kind=${row.kind} entity=${row.entity} key=${queueDiagKey(row)}`,
        )
        logServerRoundTrip({
          description,
          ok: true,
          durationMs: performance.now() - t0,
          respondsTo,
        })
        return
      }

      if (row.kind === 'create' && row.entity === 'item') {
        const payload = row.payload as {
          id?: string
          list_id?: string
          text?: string
          category?: number
          comment?: string | null
          sort_order?: number | null
          client_created_at?: string
        }
        const id = String(payload.id ?? '')
        const listId = String(payload.list_id ?? '')
        if (!id || !listId) throw new Error('create item missing id/list_id')
        const t = typeof payload.client_created_at === 'string' ? payload.client_created_at : isoNow()
        const baseItem = {
          id,
          list_id: listId,
          text: payload.text ?? '',
          category: payload.category ?? 1,
          comment: payload.comment ?? null,
          sort_order: payload.sort_order ?? null,
          client_created_at: t,
          server_created_at: t,
          deleted_at: null,
          version: 1,
          last_synced_at: null,
          updated_at: t,
        }
        const itemSync = normalizeServerSyncableFields(baseItem as Record<string, unknown>)
        const pItem = { ...baseItem, ...itemSync } as Record<string, unknown>
        const { data: itemRpcData, error } = await supabase.rpc('upsert_item_sync', {
          p_item: pItem as never,
        })
        if (error) throw error
        const env = itemRpcData as UpsertItemRpcEnvelope | null
        if (env?.display_name_changed && env.item) {
          const newText = typeof env.item.text === 'string' ? env.item.text : String(env.item.text ?? '')
          const serverUpdatedAt =
            typeof env.item.updated_at === 'string' ? env.item.updated_at : isoNow()
          if (newText) {
            await db.items.update(id, { text: newText, updated_at: serverUpdatedAt })
            const { activeListId, setItems } = useListDataStore.getState()
            if (activeListId === listId) {
              setItems((prev) =>
                prev.map((i) =>
                  i.id === id ? { ...i, text: newText, updated_at: serverUpdatedAt } : i,
                ),
              )
            }
            const label = newText.length > 40 ? `${newText.slice(0, 37)}…` : newText
            showInfoToast(`Item renamed to avoid a name collision (“${label}”).`)
          }
        }
      } else if (row.kind === 'create' && row.entity === 'list') {
        const payload = row.payload as {
          id?: string
          name?: string
          label?: string
          client_created_at?: string
        }
        const t =
          typeof payload.client_created_at === 'string' ? payload.client_created_at : isoNow()
        const listIdForCreate = String(payload.id ?? '')
        const { data: createListData, error } = await supabase.rpc('create_list', {
          p_id: payload.id,
          p_name: payload.name ?? '',
          p_label: payload.label ?? '',
          p_client_created_at: t,
        })
        if (error) throw error
        const env = createListData as CreateListRpcEnvelope | null
        if (env?.display_name_changed && env.list && listIdForCreate) {
          const name = typeof env.list.name === 'string' ? env.list.name : String(env.list.name ?? '')
          const updatedAt =
            typeof env.list.updated_at === 'string' ? env.list.updated_at : isoNow()
          if (name) {
            await db.lists.update(listIdForCreate, {
              name,
              updated_at: updatedAt,
              cached_at: Date.now(),
            })
            useListsCatalogStore.getState().setCatalogLists((prev) =>
              prev.map((l) => (l.id === listIdForCreate ? { ...l, name } : l)),
            )
            const label = name.length > 40 ? `${name.slice(0, 37)}…` : name
            showInfoToast(`List renamed to avoid a name collision (“${label}”).`)
          }
        }
      } else if (row.kind === 'create' && row.entity === 'member') {
        const payload = row.payload as {
          id?: string
          list_id?: string
          name?: string
          client_created_at?: string
          created_by?: string | null
          sort_order?: number | null
          is_public?: boolean
          is_target?: boolean
        }
        const id = String(payload.id ?? '')
        const listId = String(payload.list_id ?? '')
        if (!id || !listId) throw new Error('create member missing id/list_id')
        const t = typeof payload.client_created_at === 'string' ? payload.client_created_at : isoNow()
        const baseRow = {
          id,
          list_id: listId,
          name: payload.name ?? '',
          created_by: payload.created_by ?? null,
          sort_order: payload.sort_order ?? null,
          is_public: payload.is_public ?? false,
          is_target: payload.is_target ?? false,
          client_created_at: t,
          server_created_at: t,
          deleted_at: null,
          version: 1,
          last_synced_at: null,
          updated_at: t,
        }
        const sync = normalizeServerSyncableFields(baseRow as Record<string, unknown>)
        const pMember = { ...baseRow, ...sync } as Record<string, unknown>
        const { data: memberRpcData, error } = await supabase.rpc('upsert_member_sync', {
          p_member: pMember as never,
        })
        if (error) throw error
        const mEnv = memberRpcData as UpsertMemberRpcEnvelope | null
        await mergeDedupedMemberNameFromRpc(id, listId, mEnv ?? {}, showInfoToast)
      } else if (row.kind === 'create' && row.entity === 'feedback') {
        const payload = row.payload as {
          id?: string
          user_id?: string
          email?: string | null
          message?: string
          client_created_at?: string
        }
        const id = String(payload.id ?? '')
        const userForFeedback = String(payload.user_id ?? '')
        if (!id || !userForFeedback) throw new Error('feedback create missing id/user_id')
        const t = typeof payload.client_created_at === 'string' ? payload.client_created_at : isoNow()
        const baseRow = {
          id,
          user_id: userForFeedback,
          email: typeof payload.email === 'string' ? payload.email : '',
          message: payload.message ?? '',
          client_created_at: t,
          server_created_at: t,
          deleted_at: null,
          version: 1,
          last_synced_at: null,
        }
        const sync = normalizeServerSyncableFields(baseRow as Record<string, unknown>)
        const { error } = await supabase.from('feedback').insert({
          ...baseRow,
          ...sync,
        })
        if (error) throw error
      } else if (row.kind === 'patch' && row.entity === 'item_member_state') {
        const fresh = (await db.sync_queue.get(row.id)) ?? row
        const payload = fresh.payload as {
          item_id?: string
          member_id?: string
          quantity?: number
          done?: boolean
          assigned?: boolean
        }
        const itemId = String(payload.item_id ?? '')
        const memberId = String(payload.member_id ?? '')
        if (!itemId || !memberId) throw new Error('item_member_state missing item_id/member_id')
        const u = isoNow()
        const baseIms = {
          item_id: itemId,
          member_id: memberId,
          quantity: payload.quantity ?? 1,
          done: payload.done ?? false,
          assigned: payload.assigned ?? false,
          client_created_at: u,
          server_created_at: u,
          deleted_at: null,
          version: 1,
          last_synced_at: null,
          updated_at: u,
        }
        const imsSync = normalizeServerSyncableFields(baseIms as Record<string, unknown>)
        const { error } = await supabase.from('item_member_state').upsert({
          ...baseIms,
          ...imsSync,
        })
        if (error) throw error
      } else if (row.kind === 'patch' && row.entity === 'item') {
        const payload = row.payload as {
          id?: string
          [key: string]: unknown
        }
        const id = String(payload.id ?? '')
        if (!id) throw new Error('patch item missing id')
        const patch: Record<string, unknown> = { ...payload }
        delete patch.id
        const patchJson: Record<string, unknown> = {}
        for (const key of ['text', 'comment', 'category', 'archived', 'archived_at', 'sort_order'] as const) {
          if (key in patch && patch[key] !== undefined) patchJson[key] = patch[key]
        }
        if (Object.keys(patchJson).length > 0) {
          const { data: itemPatchRpcData, error } = await supabase.rpc('apply_item_patch_sync', {
            p_item_id: id,
            p_patch: patchJson as never,
          })
          if (error) throw error
          const itemRow = await db.items.get(id)
          const itemListId = itemRow?.list_id ?? rowListIdForSync(row) ?? ''
          await mergeDedupedItemTextFromPatchRpc(
            id,
            itemListId,
            (itemPatchRpcData ?? {}) as ApplyItemPatchRpcEnvelope,
            showInfoToast,
          )
        }
      } else if (row.kind === 'patch' && row.entity === 'list') {
        const payload = row.payload as {
          id?: string
          [key: string]: unknown
        }
        const id = String(payload.id ?? '')
        if (!id) throw new Error('patch list missing id')
        const patch: Record<string, unknown> = { ...payload }
        delete patch.id
        const patchJson: Record<string, unknown> = {}
        for (const key of ['name', 'archived', 'comment', 'category_names', 'category_order'] as const) {
          if (key in patch && patch[key] !== undefined) patchJson[key] = patch[key]
        }
        if (Object.keys(patchJson).length > 0) {
          const { data: listPatchRpcData, error } = await supabase.rpc('apply_list_patch_sync', {
            p_list_id: id,
            p_patch: patchJson as never,
          })
          if (error) throw error
          await mergeDedupedListNameFromPatchRpc(id, (listPatchRpcData ?? {}) as ApplyListPatchRpcEnvelope, showInfoToast)
        }
      } else if (row.kind === 'patch' && row.entity === 'member') {
        const payload = row.payload as {
          memberId?: string
          name?: string
          is_public?: boolean
        }
        const memberId = String(payload.memberId ?? row.entity_id ?? '')
        if (!memberId) throw new Error('patch member missing memberId')
        const { data: updateMemberRpcData, error } = await supabase.rpc('update_member', {
          p_member_id: memberId,
          p_name: payload.name ?? null,
          p_is_public: payload.is_public ?? null,
        })
        if (error) throw error
        const memberRow = await db.members.get(memberId)
        const memberListId = memberRow?.list_id ?? rowListIdForSync(row) ?? ''
        await mergeDedupedMemberNameFromRpc(
          memberId,
          memberListId,
          (updateMemberRpcData ?? {}) as UpsertMemberRpcEnvelope,
          showInfoToast,
        )
      } else if (row.kind === 'rpc') {
        const payload = row.payload as {
          method?: string
          list_id?: string
          item_ids?: string[]
          category?: number
          lines?: string[]
          items?: Array<Record<string, unknown>>
          user_id?: string
          list_ids?: string[]
          updates?: Array<{ list_id: string; label: string }>
          id?: string
          archived?: boolean
          sort_order?: number
          label?: string
          token?: string
          source_list_id?: string
          duplicate_id?: string
          new_name?: string
          imported_id?: string
          p_name?: string
          p_label?: string
          p_category_names?: string
          p_rows?: unknown
          p_has_targets?: boolean
          member_id?: string
          force_regenerate?: boolean
          p_user_ids?: string[]
        }
        const method = String(payload.method ?? '')
        if (method === 'reorderListItems') {
          const rpcListId = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          const itemIds = Array.isArray(payload.item_ids) ? payload.item_ids : []
          appendMutationDiagnostic(
            `[sync->server] reorderListItems payload listId=${rpcListId} count=${itemIds.length} head=${itemIds.slice(0, 5).join(',')} tail=${itemIds.slice(-5).join(',')}`,
          )
          if (rpcListId && itemIds.length > 0) {
            const { error } = await supabase.rpc('reorder_list_items', {
              p_list_id: rpcListId,
              p_item_ids: itemIds,
            } as never)
            if (error) throw error
          }
        } else if (method === 'bulkAddListItems') {
          const rpcListId = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          const category = Number(payload.category ?? 1)
          const lines = Array.isArray(payload.lines) ? payload.lines : []
          const itemRows = Array.isArray(payload.items) ? payload.items : []
          appendMutationDiagnostic(
            `[sync->server] bulkAddListItems payload listId=${rpcListId} lines=${lines.length} items=${itemRows.length}`,
          )
          if (rpcListId && itemRows.length > 0) {
            let bulkItemRenameCount = 0
            for (const raw of itemRows) {
              const it = raw as {
                id?: string
                list_id?: string
                text?: string
                category?: number
                comment?: string | null
                archived?: boolean
                archived_at?: string | null
                sort_order?: number | null
                client_created_at?: string
                server_created_at?: string | null
                deleted_at?: string | null
                version?: number
                last_synced_at?: string | null
                updated_at?: string
              }
              const id = String(it.id ?? '')
              if (!id) continue
              const t = typeof it.client_created_at === 'string' ? it.client_created_at : isoNow()
              const baseRow = {
                id,
                list_id: String(it.list_id ?? rpcListId),
                text: it.text ?? '',
                category: it.category ?? category,
                comment: it.comment ?? null,
                archived: it.archived ?? false,
                archived_at: it.archived_at ?? null,
                sort_order: it.sort_order ?? null,
                client_created_at: t,
                server_created_at: typeof it.server_created_at === 'string' ? it.server_created_at : t,
                deleted_at: it.deleted_at ?? null,
                version: typeof it.version === 'number' ? it.version : 1,
                last_synced_at: it.last_synced_at ?? null,
                updated_at: typeof it.updated_at === 'string' ? it.updated_at : t,
              }
              const sync = normalizeServerSyncableFields(baseRow as Record<string, unknown>)
              const pItem = { ...baseRow, ...sync } as Record<string, unknown>
              const { data: rowRpcData, error } = await supabase.rpc('upsert_item_sync', {
                p_item: pItem as never,
              })
              if (error) throw error
              const env = rowRpcData as UpsertItemRpcEnvelope | null
              if (env?.display_name_changed && env.item) {
                const newText = typeof env.item.text === 'string' ? env.item.text : String(env.item.text ?? '')
                const serverUpdatedAt =
                  typeof env.item.updated_at === 'string' ? env.item.updated_at : isoNow()
                if (newText) {
                  await db.items.update(id, { text: newText, updated_at: serverUpdatedAt })
                  const { activeListId, setItems } = useListDataStore.getState()
                  if (activeListId === rpcListId) {
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === id ? { ...i, text: newText, updated_at: serverUpdatedAt } : i,
                      ),
                    )
                  }
                  bulkItemRenameCount += 1
                }
              }
            }
            if (bulkItemRenameCount > 0) {
              showInfoToast(
                bulkItemRenameCount === 1
                  ? 'Item renamed to avoid a name collision.'
                  : `${bulkItemRenameCount} items renamed to avoid name collisions.`,
              )
            }
          } else if (rpcListId && lines.length > 0) {
            const { data: bulkData, error } = await supabase.rpc('bulk_add_list_items', {
              p_list_id: rpcListId,
              p_category: category,
              p_lines: lines,
            } as never)
            if (error) throw error
            const changes = readBulkLineTextChanges(bulkData)
            if (changes.length > 0) {
              const nowIso = isoNow()
              for (const ch of changes) {
                await db.items.update(ch.item_id, { text: ch.text, updated_at: nowIso })
              }
              const { activeListId, setItems } = useListDataStore.getState()
              if (activeListId === rpcListId) {
                setItems((prev) =>
                  prev.map((i) => {
                    const ch = changes.find((c) => c.item_id === i.id)
                    return ch ? { ...i, text: ch.text, updated_at: nowIso } : i
                  }),
                )
              }
              showInfoToast(
                changes.length === 1
                  ? `Item renamed to avoid a name collision (“${changes[0]!.text.length > 40 ? `${changes[0]!.text.slice(0, 37)}…` : changes[0]!.text}”).`
                  : `${changes.length} items renamed to avoid name collisions.`,
              )
            }
          }
        } else if (method === 'patchListUser') {
          const id = String(payload.id ?? '')
          const patchUserId = String(payload.user_id ?? '')
          if (!id || !patchUserId) throw new Error('patchListUser missing id/user_id')
          const patch: Record<string, unknown> = {}
          if (payload.archived !== undefined) patch.archived = payload.archived
          if (payload.sort_order !== undefined) patch.sort_order = payload.sort_order
          if (payload.label !== undefined) patch.label = payload.label
          const plWide = payload as Record<string, unknown>
          if (plWide.member_filter !== undefined) patch.member_filter = plWide.member_filter
          if (plWide.item_text_width !== undefined) patch.item_text_width = plWide.item_text_width
          if (plWide.sum_scope !== undefined) patch.sum_scope = plWide.sum_scope
          if (plWide.item_name_font_step !== undefined) patch.item_name_font_step = plWide.item_name_font_step
          if (plWide.last_viewed_members !== undefined) patch.last_viewed_members = plWide.last_viewed_members
          const shouldTouchLastViewed = plWide.last_viewed !== undefined
          if (Object.keys(patch).length > 0) {
            const { error } = await supabase
              .from('list_users')
              .update(patch)
              .eq('list_id', id)
              .eq('user_id', patchUserId)
            if (error) throw error
          }
          if (shouldTouchLastViewed) {
            const { data: serverLastViewed, error } = await supabase.rpc('touch_list_viewed', {
              p_list_id: id,
            })
            if (error) throw error
            if (typeof serverLastViewed === 'string') {
              const listUser = await db.list_users.where('[list_id+user_id]').equals([id, patchUserId]).first()
              if (listUser) {
                await db.list_users.update(listUser.id, { last_viewed: serverLastViewed })
              }
            }
          }
        } else if (method === 'reorderListUsers') {
          const listIds = Array.isArray(payload.list_ids) ? payload.list_ids : []
          appendMutationDiagnostic(
            `[sync->server] reorderListUsers payload count=${listIds.length} head=${listIds.slice(0, 5).join(',')} tail=${listIds.slice(-5).join(',')}`,
          )
          if (listIds.length > 0) {
            const { error } = await supabase.rpc('reorder_user_lists', {
              p_list_ids: listIds,
            } as never)
            if (error) throw error
          }
        } else if (method === 'bulkPatchListLabels') {
          const updates = Array.isArray(payload.updates) ? payload.updates : []
          appendMutationDiagnostic(`[sync->server] bulkPatchListLabels payload count=${updates.length}`)
          if (updates.length > 0) {
            const { error } = await supabase.rpc('bulk_update_list_labels', {
              p_updates: updates,
            } as never)
            if (error) throw error
          }
        } else if (method === 'deleteArchivedItems') {
          const rpcListId = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          if (!rpcListId) throw new Error('deleteArchivedItems missing list_id')
          const itemIds = Array.isArray(payload.item_ids)
            ? (payload.item_ids as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
            : []
          appendMutationDiagnostic(
            `[sync->server] deleteArchivedItems listId=${rpcListId} itemIds=${itemIds.length}`,
          )
          const { error } = await supabase.rpc('delete_archived_items', { p_list_id: rpcListId })
          if (error) throw error
          for (const id of itemIds) {
            await cleanupDexieAfterItemServerDeleted(id, rpcListId)
          }
        } else if (method === 'restoreArchivedItems') {
          const rpcListId = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          if (!rpcListId) throw new Error('restoreArchivedItems missing list_id')
          appendMutationDiagnostic(`[sync->server] restoreArchivedItems listId=${rpcListId}`)
          const { error } = await supabase.rpc('restore_archived_items', { p_list_id: rpcListId })
          if (error) throw error
        } else if (method === 'joinListByToken') {
          const token = String(payload.token ?? '')
          if (!token) throw new Error('joinListByToken missing token')
          appendMutationDiagnostic('[sync->server] joinListByToken')
          const { error } = await supabase.rpc('join_list_by_token', { p_token: token } as never)
          if (error) throw error
        } else if (method === 'leaveList') {
          const lid = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          if (!lid) throw new Error('leaveList missing list_id')
          appendMutationDiagnostic(`[sync->server] leaveList listId=${lid}`)
          const { error } = await supabase.rpc('leave_list', { p_list_id: lid } as never)
          if (error) throw error
          await cleanupDexieAfterListServerDeleted(lid)
        } else if (method === 'duplicateList') {
          const sourceListId = String(payload.source_list_id ?? '')
          const dupId = String(payload.duplicate_id ?? '')
          const newName = String(payload.new_name ?? '')
          const pLabel = String(payload.label ?? '')
          const plDup = payload as Record<string, unknown>
          const dupClientCreated =
            typeof plDup.client_created_at === 'string' ? plDup.client_created_at : isoNow()
          if (!sourceListId || !dupId) throw new Error('duplicateList missing source_list_id/duplicate_id')
          appendMutationDiagnostic(`[sync->server] duplicateList source=${sourceListId} dup=${dupId}`)
          const { data, error } = await supabase.rpc('duplicate_list', {
            p_source_list_id: sourceListId,
            p_id: dupId,
            p_new_name: newName,
            p_label: pLabel,
            p_client_created_at: dupClientCreated,
          })
          if (error) throw error
          const uid = resolveSyncUserId(payload.user_id)
          if (!uid) throw new Error('duplicateList missing user_id')
          if (data?.list) {
            const rawItems = (data.items ?? []) as ItemWithState[]
            const items = rawItems.map((item) => ({
              ...item,
              category: normalizeItemCategory(item.category),
            }))
            const members = (data.members ?? []) as MemberWithCreator[]
            await upsertListDataPayloadFromServer(uid, dupId, {
              list: data.list as List,
              items,
              members,
            })
          }
        } else if (method === 'ownMember') {
          const memberId = String(payload.member_id ?? '')
          if (!memberId) throw new Error('ownMember missing member_id')
          appendMutationDiagnostic(`[sync->server] ownMember memberId=${memberId}`)
          const { error } = await supabase.rpc('own_member', { p_member_id: memberId } as never)
          if (error) throw error
        } else if (method === 'importList') {
          const importedId = String(payload.imported_id ?? '')
          const pName = String(payload.p_name ?? '')
          const pLabel = String(payload.p_label ?? '')
          const pCategoryNames = String(payload.p_category_names ?? '{}')
          const pHasTargets = Boolean(payload.p_has_targets)
          const pRows = payload.p_rows
          const plImp = payload as Record<string, unknown>
          const importClientCreated =
            typeof plImp.p_client_created_at === 'string' ? plImp.p_client_created_at : isoNow()
          if (!importedId || !pName) throw new Error('importList missing imported_id/p_name')
          appendMutationDiagnostic(`[sync->server] importList id=${importedId}`)
          const { data, error } = await supabase.rpc('import_list', {
            p_id: importedId,
            p_name: pName,
            p_label: pLabel,
            p_category_names: pCategoryNames,
            p_rows: (pRows ?? []) as never,
            p_has_targets: pHasTargets,
            p_client_created_at: importClientCreated,
          })
          if (error) throw error
          const uid = resolveSyncUserId(payload.user_id)
          if (!uid) throw new Error('importList missing user_id')
          if (data) {
            await upsertListDataPayloadFromServer(uid, importedId, {
              list: data as List,
              items: [],
              members: [],
            })
          }
        } else if (method === 'generateShareToken') {
          const lid = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          const force = Boolean((payload as Record<string, unknown>).force_regenerate)
          if (!lid) throw new Error('generateShareToken missing list_id')
          appendMutationDiagnostic(`[sync->server] generateShareToken listId=${lid} force=${force ? 1 : 0}`)
          const { error } = await supabase.rpc('generate_share_token', {
            p_list_id: lid,
            p_force_regenerate: force,
          } as never)
          if (error) throw error
          const uidShare = resolveSyncUserId(payload.user_id)
          if (uidShare) {
            await syncListDetail(uidShare, lid, 'After saving: refresh list (share token)')
          }
        } else if (method === 'revokeShareToken') {
          const lid = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          if (!lid) throw new Error('revokeShareToken missing list_id')
          appendMutationDiagnostic(`[sync->server] revokeShareToken listId=${lid}`)
          const { error } = await supabase.rpc('revoke_share_token', { p_list_id: lid } as never)
          if (error) throw error
          const uidRev = resolveSyncUserId(payload.user_id)
          if (uidRev) {
            await syncListDetail(uidRev, lid, 'After saving: refresh list (revoke share)')
          }
        } else if (method === 'removeUsersFromList') {
          const lid = String(payload.list_id ?? rowListIdForSync(row) ?? '')
          const pUserIds = (payload as Record<string, unknown>).p_user_ids
          const ids = Array.isArray(pUserIds) ? (pUserIds as string[]) : []
          if (!lid || ids.length === 0) throw new Error('removeUsersFromList missing list_id/p_user_ids')
          appendMutationDiagnostic(`[sync->server] removeUsersFromList listId=${lid} count=${ids.length}`)
          const { error } = await supabase.rpc('remove_users_from_list', {
            p_list_id: lid,
            p_user_ids: ids,
          } as never)
          if (error) throw error
          const uidRm = resolveSyncUserId(payload.user_id)
          if (uidRm) {
            await syncListDetail(uidRm, lid, 'After saving: refresh list (remove users)')
          }
        } else {
          throw new Error(`Unknown rpc method: ${method || '(empty)'}`)
        }
      }

      const verified = await verifyMutationApplied(row)
      if (!verified) {
        throw new Error(`Verification failed for ${row.kind}/${row.entity}/${queueDiagKey(row)}`)
      }
      appendMutationDiagnostic(
        `[sync<-server] ok kind=${row.kind} entity=${row.entity} key=${queueDiagKey(row)}`,
      )
      logServerRoundTrip({
        description,
        ok: true,
        durationMs: performance.now() - t0,
        respondsTo,
      })
      } catch (err) {
        if (row.kind === 'rpc') {
          const p = row.payload as { method?: string; updates?: Array<{ list_id?: string }> }
          if (p.method === 'bulkPatchListLabels' && Array.isArray(p.updates)) {
            const ids = p.updates.map((u) => String(u.list_id ?? '')).filter(Boolean)
            const localNames = await localListNamesForIds(ids)
            appendMutationDiagnostic(
              `[sync] bulkPatchListLabels batch list_ids=${ids.join(',')} local=${localNames} err=${normalizeErrorMessage(err)}`,
            )
          }
        }
        logServerRoundTrip({
          description,
          ok: false,
          durationMs: performance.now() - t0,
          respondsTo,
          failure: err,
        })
        throw err
      }
    },
    [normalizeErrorMessage, verifyMutationApplied, resolveSyncUserId, syncListDetail, showInfoToast],
  )

  const needsBackoffWake = useMemo(() => {
    const now = Date.now()
    return rows.some((r) => {
      const nr = r.next_retry_at ?? null
      return nr != null && nr > now
    })
  }, [rows])

  useEffect(() => {
    if (status !== 'online' || rows.length === 0 || !needsBackoffWake) return
    const id = window.setInterval(() => {
      setRetryPulse((p) => p + 1)
    }, 3_000)
    return () => window.clearInterval(id)
  }, [needsBackoffWake, rows.length, status])

  useEffect(() => {
    if (status !== 'online') return
    if (rows.length === 0) return
    if (drainingRef.current) return

    const now = Date.now()
    const hasEligible = rows.some((r) => isEligibleForSync(r, now))
    if (!hasEligible && !needsBackoffWake) return

    let cancelled = false
    const run = async () => {
      drainingRef.current = true
      setIsDraining(true)
      try {
        while (!cancelled && statusRef.current === 'online') {
          const tick = Date.now()
          const batch = await db.sync_queue.orderBy('updated_at').toArray()
          const eligible = batch
            .filter((r) => isEligibleForSync(r, tick))
            .sort((a, b) => a.updated_at - b.updated_at)
          const next = eligible[0]
          if (!next) break

          const claimed = await tryClaimSyncRow(next.id)
          if (!claimed) continue

          const syncUserId = getActiveCacheUserId()
          if (syncUserId) {
            await applyListUserSyncErrorForListIds(listIdsTouchingOutboundRow(claimed), syncUserId, false)
          }

          try {
            await executeOutboundRow(claimed)
            await clearListSyncErrorMessages(listIdsTouchingOutboundRow(claimed))
            await db.sync_queue.delete(claimed.id)
            markOnlineRecovered('use-sync-store-drain')
          } catch (error) {
            const message = normalizeErrorMessage(error)
            appendMutationDiagnostic(
              `[sync<-server] error kind=${claimed.kind} entity=${claimed.entity} key=${queueDiagKey(claimed)} msg=${message}`,
            )
            if (isLikelyConnectivityError(error)) {
              setLastError(message)
              await releaseRowForConnectivityRetry(claimed.id)
              break
            }
            if (isOutboundSyncTerminalError(error)) {
              await scrubAfterTerminalOutboundFailure(claimed, syncUserId, normalizeErrorMessage)
              if (syncUserId) {
                await applyListUserSyncErrorForListIds(listIdsTouchingOutboundRow(claimed), syncUserId, false)
              }
              await db.sync_queue.delete(claimed.id)
              const terminalListIds = listIdsTouchingOutboundRow(claimed)
              await setListSyncErrorMessages(terminalListIds, message)
              setLastError(message)
              continue
            }
            if (
              syncUserId &&
              shouldSetListUserSyncErrorAfterOutboundFailure(error, claimed.attempt_count)
            ) {
              await applyListUserSyncErrorForListIds(listIdsTouchingOutboundRow(claimed), syncUserId, true)
            }
            await markRowFailedAfterError(claimed, message, error)
            if (claimed.attempt_count === 0) {
              showErrorToast(message || 'Sync failed; will retry.', { serverError: error })
            }
            setLastError(message)
          }
        }
      } catch (error) {
        const msg = normalizeErrorMessage(error)
        setLastError(msg)
      } finally {
        drainingRef.current = false
        setIsDraining(false)
        if (cancelled) {
          queueMicrotask(() => setRetryPulse((p) => p + 1))
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [
    executeOutboundRow,
    markOnlineRecovered,
    needsBackoffWake,
    normalizeErrorMessage,
    outboundSyncKick,
    retryPulse,
    rows,
    showErrorToast,
    status,
  ])

  return useMemo(
    () => ({
      pendingCount: rows.length,
      isDraining,
      lastError,
      hasSyncFailures: rows.some((row) => row.status === 'failed' || (row.attempt_count > 0 && Boolean(row.last_error))),
    }),
    [isDraining, lastError, rows],
  )
}
