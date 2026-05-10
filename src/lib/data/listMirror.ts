import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { isTombstoned } from '@/lib/data/base_sync_fields'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import { formatQuotedListName, logServerRoundTrip } from '@/lib/serverActionLog'
import { upsertListDataPayloadFromMirror } from '@/lib/data/serverDexieParity'
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

function detailVersionMetaId(listId: string) {
  return `${MIRROR_DETAIL_VERSION_PREFIX}${listId}`
}

export async function getLastMirroredListDetailVersion(listId: string): Promise<number> {
  const row = await db.meta.get(detailVersionMetaId(listId))
  const v = row?.value
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export async function setLastMirroredListDetailVersion(listId: string, version: number): Promise<void> {
  await db.meta.put({
    id: detailVersionMetaId(listId),
    value: version,
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
  const unique = [...new Set(listIds.filter((id) => id && id.length > 0))]
  if (unique.length === 0) return
  await db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(LIST_MIRROR_QUEUE_META_ID)
    const prev = (row?.value as QueuePayload | undefined)?.ids ?? []
    const merged = [...new Set([...unique, ...prev])]
    await db.meta.put({ id: LIST_MIRROR_QUEUE_META_ID, value: { ids: merged } satisfies QueuePayload, updated_at: Date.now() })
  })
  appendMutationDiagnostic(`[list-mirror] enqueue count=${unique.length}`)
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
  const owner = LIST_MIRROR_SESSION_OWNER
  const acquired = await waitForListMirrorLock(listId, owner, { maxWaitMs: 5_000, pollMs: 100 })
  if (!acquired) {
    appendMutationDiagnostic(`[list-mirror] skip lock timeout listId=${listId}`)
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
      appendMutationDiagnostic(`[list-mirror] skip no list row listId=${listId}`)
      return false
    }
    if (isTombstoned(list.deleted_at ?? null)) {
      appendMutationDiagnostic(`[list-mirror] skip tombstoned local list listId=${listId}`)
      return false
    }
    const lastMirrored = await getLastMirroredListDetailVersion(listId)
    const bypass = options?.bypassVersionGate === true
    if (!bypass && !(list.version > lastMirrored)) {
      appendMutationDiagnostic(
        `[list-mirror] skip version gate listId=${listId} list.version=${list.version} lastMirrored=${lastMirrored}`,
      )
      return false
    }

    appendMutationDiagnostic(
      `[list-mirror] fetch get_list_data listId=${listId} list.version=${list.version} lastMirrored=${lastMirrored} bypass=${bypass ? 1 : 0}`,
    )
    rpcT0 = performance.now()
    const { data, error } = await supabase.rpc('get_list_data', { p_list_id: listId })
    if (error) throw error
    if (!data?.list) {
      appendMutationDiagnostic(`[list-mirror] skip empty payload listId=${listId}`)
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
    await setLastMirroredListDetailVersion(listId, data.list.version ?? list.version)
    await db.meta.put({
      id: LIST_MIRROR_LAST_SUCCESS_LIST_ID_META_ID,
      value: { list_id: listId, at_iso: new Date().toISOString() },
      updated_at: Date.now(),
    })
    appendMutationDiagnostic(`[list-mirror] ok listId=${listId} items=${items.length} members=${members.length}`)
    logServerRoundTrip({
      description: `Fetched list ${formatQuotedListName(data.list.name, listId)} (${items.length} items, ${members.length} members, background cache)`,
      ok: true,
      durationMs: performance.now() - rpcT0,
      respondsTo: 'Background list mirror',
    })
    return true
  } catch (e) {
    appendMutationDiagnostic(`[list-mirror] error listId=${listId} msg=${e instanceof Error ? e.message : String(e)}`)
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
  const succeeded = await runListMirrorJob(userId, head)
  await popListMirrorQueueHead(head)
  return { processed: 1, succeeded }
}

