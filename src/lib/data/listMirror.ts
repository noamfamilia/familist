import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { formatQuotedListName, logServerRoundTrip } from '@/lib/serverActionLog'
import { upsertListDataPayloadFromMirror } from '@/lib/data/serverDexieParity'
import {
  captureListReconcileGeneration,
  shouldDiscardListReconcileResult,
} from '@/lib/data/listReconcilePolicy'
import {
  canFetchFromServerNow,
  captureReadFlightGeneration,
  shouldDiscardReadFlightResult,
} from '@/lib/data/serverReadPolicy'
import { shouldDeferServerReadsForOutboundList } from '@/lib/data/outboundReadQuiet'
import { releaseListMirrorLock, waitForListMirrorLock } from '@/lib/data/listMirrorLock'

const supabase = createClient()

export const LIST_MIRROR_QUEUE_META_ID = 'list_mirror_queue'
const PRIORITY_META_ID = 'list_mirror_priority_list_id'
const MIRROR_DETAIL_VERSION_PREFIX = 'mirror_detail_list_version:'
export const LIST_MIRROR_RUNNING_META_ID = 'list_mirror_running'
export const LIST_MIRROR_LAST_SUCCESS_LIST_ID_META_ID = 'list_mirror_last_success'

/** Stable per-tab owner for list mirror locks (fetchList + background worker share this). */
export const LIST_MIRROR_SESSION_OWNER =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tab_${crypto.randomUUID()}`
    : `tab_${String(Date.now())}_${String(Math.random()).slice(2)}`

type QueuePayload = { ids: string[] }
type DetailMirrorWatermark = { version: number; last_content_update: string | null }

function detailVersionMetaId(listId: string) {
  return `${MIRROR_DETAIL_VERSION_PREFIX}${listId}`
}

export async function getLastMirroredListDetailVersion(listId: string): Promise<number> {
  const row = await db.meta.get(detailVersionMetaId(listId))
  const v = row?.value
  if (v && typeof v === 'object' && 'version' in v) {
    const version = (v as DetailMirrorWatermark).version
    return typeof version === 'number' && Number.isFinite(version) ? version : 0
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

async function getLastMirroredListDetailContentUpdate(listId: string): Promise<string | null> {
  const row = await db.meta.get(detailVersionMetaId(listId))
  const v = row?.value
  if (!v || typeof v !== 'object' || !('last_content_update' in v)) return null
  const lastContentUpdate = (v as DetailMirrorWatermark).last_content_update
  return typeof lastContentUpdate === 'string' ? lastContentUpdate : null
}

export async function setLastMirroredListDetailVersion(
  listId: string,
  version: number,
  lastContentUpdate?: string | null,
): Promise<void> {
  await db.meta.put({
    id: detailVersionMetaId(listId),
    value: { version, last_content_update: lastContentUpdate ?? null } satisfies DetailMirrorWatermark,
    updated_at: Date.now(),
  })
}

export async function setListMirrorPriorityListId(listId: string | null): Promise<void> {
  if (!listId) {
    await db.meta.delete(PRIORITY_META_ID)
    return
  }
  await db.meta.put({ id: PRIORITY_META_ID, value: listId, updated_at: Date.now() })
}

export async function getListMirrorPriorityListId(): Promise<string | null> {
  const row = await db.meta.get(PRIORITY_META_ID)
  return typeof row?.value === 'string' && row.value.length > 0 ? row.value : null
}

/** Merge list ids into the Dexie-backed mirror queue (deduped). */
export async function enqueueListMirrorJobs(listIds: string[]): Promise<void> {
  const queue = await db.sync_queue.toArray()
  const unique = [...new Set(listIds.filter((id) => id && id.length > 0))].filter(
    (id) => !shouldDeferServerReadsForOutboundList(id, queue),
  )
  if (unique.length === 0) return
  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(LIST_MIRROR_QUEUE_META_ID)
    const prev = (row?.value as QueuePayload | undefined)?.ids ?? []
    const merged = [...new Set([...unique, ...prev])]
    await db.meta.put({ id: LIST_MIRROR_QUEUE_META_ID, value: { ids: merged } satisfies QueuePayload, updated_at: Date.now() })
  })
}

export async function peekListMirrorQueue(): Promise<string[]> {
  const row = await db.meta.get(LIST_MIRROR_QUEUE_META_ID)
  const ids = (row?.value as QueuePayload | undefined)?.ids ?? []
  return ids
}

export async function popListMirrorQueueHead(listId: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(LIST_MIRROR_QUEUE_META_ID)
    const ids = (row?.value as QueuePayload | undefined)?.ids ?? []
    const next = ids.filter((id) => id !== listId)
    if (next.length === 0) {
      await db.meta.delete(LIST_MIRROR_QUEUE_META_ID)
    } else {
      await db.meta.put({
        id: LIST_MIRROR_QUEUE_META_ID,
        value: { ids: next } satisfies QueuePayload,
        updated_at: Date.now(),
      })
    }
  })
}

function sortQueueWithPriority(ids: string[], priority: string | null): string[] {
  if (!priority || !ids.includes(priority)) return ids
  return [priority, ...ids.filter((id) => id !== priority)]
}

/**
 * Version-gated background mirror: only calls get_list_data when Dexie `lists.version`
 * is strictly greater than the last mirrored detail watermark for this list.
 */
export async function runListMirrorJob(
  userId: string,
  listId: string,
  options?: { bypassVersionGate?: boolean },
): Promise<boolean> {
  if (!canFetchFromServerNow()) {
    return false
  }
  const outboundQueue = await db.sync_queue.toArray()
  if (shouldDeferServerReadsForOutboundList(listId, outboundQueue)) {
    return false
  }
  const owner = LIST_MIRROR_SESSION_OWNER
  const acquired = await waitForListMirrorLock(listId, owner, { maxWaitMs: 5_000, pollMs: 100 })
  if (!acquired) {
    return false
  }
  let rpcT0 = 0
  try {
    await db.meta.put({
      id: LIST_MIRROR_RUNNING_META_ID,
      value: { running: true, list_id: listId, since_ms: Date.now() },
      updated_at: Date.now(),
    })
    const list = await db.lists.get(listId)
    if (!list) {
      return false
    }
    if (isTombstoned(list.deleted_at ?? null)) {
      return false
    }
    const lastMirrored = await getLastMirroredListDetailVersion(listId)
    const lastMirroredContentUpdate = await getLastMirroredListDetailContentUpdate(listId)
    const contentChanged =
      typeof list.last_content_update === 'string' &&
      list.last_content_update.length > 0 &&
      list.last_content_update !== lastMirroredContentUpdate
    const bypass = options?.bypassVersionGate === true
    if (!bypass && !(list.version > lastMirrored) && !contentChanged) {
      return false
    }

    rpcT0 = performance.now()
    const readFlightGen = captureReadFlightGeneration()
    const listReconcileGen = captureListReconcileGeneration(listId)
    const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
    if (error) throw error
    if (shouldDiscardReadFlightResult(readFlightGen)) {
      logServerRoundTrip({
        description: `Fetched list ${formatQuotedListName(list.name, listId)} (background cache)`,
        ok: true,
        durationMs: performance.now() - rpcT0,
        respondsTo: 'Background list mirror (discarded: not online)',
      })
      return false
    }
    if (shouldDiscardListReconcileResult(listId, listReconcileGen)) {
      logServerRoundTrip({
        description: `Fetched list ${formatQuotedListName(list.name, listId)} (background cache)`,
        ok: true,
        durationMs: performance.now() - rpcT0,
        respondsTo: 'Background list mirror (discarded: newer list reconcile)',
      })
      return false
    }
    if (!data?.list) {
      logServerRoundTrip({
        description: `Fetched list ${formatQuotedListName(list.name, listId)} (background cache)`,
        ok: false,
        durationMs: performance.now() - rpcT0,
        respondsTo: 'Background list mirror',
        failure: 'Empty payload',
      })
      return false
    }

    const items = data.items ?? []
    const members = data.members ?? []
    await upsertListDataPayloadFromMirror(userId, listId, {
      list: data.list,
      items,
      members,
    })
    await setLastMirroredListDetailVersion(
      listId,
      data.list.version ?? list.version,
      data.list.last_content_update ?? null,
    )
    await db.meta.put({
      id: LIST_MIRROR_LAST_SUCCESS_LIST_ID_META_ID,
      value: { list_id: listId, at_iso: new Date().toISOString() },
      updated_at: Date.now(),
    })
    logServerRoundTrip({
      description: `Fetched list ${formatQuotedListName(data.list.name, listId)} (${items.length} items, ${members.length} members, background cache)`,
      ok: true,
      durationMs: performance.now() - rpcT0,
      respondsTo: 'Background list mirror',
    })
    return true
  } catch (e) {
    logServerRoundTrip({
      description: `Fetched list ${formatQuotedListName(null, listId)} (background cache)`,
      ok: false,
      durationMs: rpcT0 > 0 ? performance.now() - rpcT0 : 0,
      respondsTo: 'Background list mirror',
      failure: e,
    })
    return false
  } finally {
    await db.meta.put({
      id: LIST_MIRROR_RUNNING_META_ID,
      value: { running: false, list_id: listId, since_ms: null },
      updated_at: Date.now(),
    })
    await releaseListMirrorLock(listId, owner)
  }
}

export async function drainListMirrorQueueOnce(userId: string): Promise<{ processed: number; succeeded: boolean }> {
  const priority = await getListMirrorPriorityListId()
  const raw = await peekListMirrorQueue()
  if (raw.length === 0) return { processed: 0, succeeded: false }
  const ordered = sortQueueWithPriority(raw, priority)
  const head = ordered[0]
  if (!head) return { processed: 0, succeeded: false }
  const outboundQueue = await db.sync_queue.toArray()
  if (shouldDeferServerReadsForOutboundList(head, outboundQueue)) {
    return { processed: 0, succeeded: false }
  }
  const succeeded = await runListMirrorJob(userId, head)
  await popListMirrorQueueHead(head)
  return { processed: 1, succeeded }
}

