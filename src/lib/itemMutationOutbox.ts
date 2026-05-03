/**
 * Persisted queue for list-detail mutations when offline or after connectivity failures.
 * Last-write-wins per (listId, itemKey) where itemKey scopes the entity (item id, ims:…, mbr:…, mbrNew:…).
 */

import type { ItemMemberState } from '@/lib/supabase/types'
import { appendOfflineNavDiagnostic } from '@/lib/offlineNavDiagnostics'

const DB_NAME = 'familist-item-mutation-outbox'
const DB_VERSION = 1
const STORE = 'mutations'

export type QueuedCreatePayload = {
  text: string
  category: number
  comment: string | null
  sort_order: number
  archived: boolean
  archived_at: string | null
  /** Target member rows to insert after items.insert (member_id -> state). */
  memberStates: Record<string, ItemMemberState>
}

export type QueuedCreateRecord = {
  kind: 'create'
  listId: string
  itemKey: string
  updatedAt: number
  payload: QueuedCreatePayload
}

/** @deprecated use patchServerItem; kept for IndexedDB rows written before upgrade */
export type QueuedPatchArchivedRecord = {
  kind: 'patchArchived'
  listId: string
  itemKey: string
  updatedAt: number
  archived: boolean
  archived_at: string | null
}

/** Server item id in itemKey — optional fields merged LWW */
export type QueuedPatchServerItemRecord = {
  kind: 'patchServerItem'
  listId: string
  itemKey: string
  updatedAt: number
  archived?: boolean
  archived_at?: string | null
  text?: string
  comment?: string | null
  category?: number
}

export type QueuedItemMemberStateRecord = {
  kind: 'itemMemberState'
  listId: string
  itemKey: string
  updatedAt: number
  itemId: string
  memberId: string
  insert: boolean
  quantity: number
  done: boolean
  assigned: boolean
}

export type QueuedPatchMemberRecord = {
  kind: 'patchMember'
  listId: string
  itemKey: string
  updatedAt: number
  memberId: string
  name?: string | null
  is_public?: boolean | null
}

export type QueuedAddMemberRecord = {
  kind: 'addMember'
  listId: string
  itemKey: string
  updatedAt: number
  name: string
  sort_order: number
  creator_nickname: string | null
}

export type QueuedItemMutationRecord =
  | QueuedCreateRecord
  | QueuedPatchArchivedRecord
  | QueuedPatchServerItemRecord
  | QueuedItemMemberStateRecord
  | QueuedPatchMemberRecord
  | QueuedAddMemberRecord

type StoredRow = {
  key: string
  listId: string
  itemKey: string
  updatedAt: number
  record: QueuedItemMutationRecord
}

function storeKey(listId: string, itemKey: string) {
  return `${listId}|${itemKey}`
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openOutboxDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onerror = () => {
        dbPromise = null
        resolve(null)
      }
      req.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key' })
          os.createIndex('by_list', 'listId', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onblocked = () => resolve(null)
    })
  }
  return dbPromise
}

function asPatchServerItem(r: QueuedPatchArchivedRecord | QueuedPatchServerItemRecord): QueuedPatchServerItemRecord {
  if (r.kind === 'patchServerItem') return r
  return {
    kind: 'patchServerItem',
    listId: r.listId,
    itemKey: r.itemKey,
    updatedAt: r.updatedAt,
    archived: r.archived,
    archived_at: r.archived_at,
  }
}

/** `b` is the newer enqueue; its defined fields win. */
function mergePatchServerItem(
  a: QueuedPatchServerItemRecord,
  b: QueuedPatchServerItemRecord,
): QueuedPatchServerItemRecord {
  const now = Date.now()
  return {
    kind: 'patchServerItem',
    listId: b.listId,
    itemKey: b.itemKey,
    updatedAt: now,
    archived: b.archived !== undefined ? b.archived : a.archived,
    archived_at: b.archived_at !== undefined ? b.archived_at : a.archived_at,
    text: b.text !== undefined ? b.text : a.text,
    comment: b.comment !== undefined ? b.comment : a.comment,
    category: b.category !== undefined ? b.category : a.category,
  }
}

function mergeRecords(
  existing: QueuedItemMutationRecord | null,
  incoming: QueuedItemMutationRecord,
): QueuedItemMutationRecord {
  const now = Date.now()
  if (!existing) {
    return { ...incoming, updatedAt: now }
  }
  if (existing.kind === 'create' && incoming.kind === 'create' && existing.itemKey === incoming.itemKey) {
    return {
      kind: 'create',
      listId: incoming.listId,
      itemKey: incoming.itemKey,
      updatedAt: now,
      payload: {
        ...existing.payload,
        ...incoming.payload,
        memberStates: incoming.payload.memberStates ?? existing.payload.memberStates,
      },
    }
  }
  if (existing.kind === 'create' && incoming.kind === 'patchArchived' && existing.itemKey === incoming.itemKey) {
    const p = asPatchServerItem(incoming)
    return {
      kind: 'create',
      listId: existing.listId,
      itemKey: existing.itemKey,
      updatedAt: now,
      payload: {
        ...existing.payload,
        archived: p.archived ?? existing.payload.archived,
        archived_at: p.archived_at ?? existing.payload.archived_at,
        ...(p.text !== undefined ? { text: p.text } : {}),
        ...(p.comment !== undefined ? { comment: p.comment } : {}),
        ...(p.category !== undefined ? { category: p.category } : {}),
      },
    }
  }
  if (existing.kind === 'create' && incoming.kind === 'patchServerItem' && existing.itemKey === incoming.itemKey) {
    return {
      kind: 'create',
      listId: existing.listId,
      itemKey: existing.itemKey,
      updatedAt: now,
      payload: {
        ...existing.payload,
        ...(incoming.archived !== undefined
          ? { archived: incoming.archived, archived_at: incoming.archived_at ?? null }
          : {}),
        ...(incoming.text !== undefined ? { text: incoming.text } : {}),
        ...(incoming.comment !== undefined ? { comment: incoming.comment } : {}),
        ...(incoming.category !== undefined ? { category: incoming.category } : {}),
      },
    }
  }
  if (existing.kind === 'patchArchived' && incoming.kind === 'patchArchived' && existing.itemKey === incoming.itemKey) {
    return { ...incoming, updatedAt: now }
  }
  if (
    (existing.kind === 'patchArchived' || existing.kind === 'patchServerItem') &&
    (incoming.kind === 'patchArchived' || incoming.kind === 'patchServerItem') &&
    existing.itemKey === incoming.itemKey
  ) {
    return mergePatchServerItem(
      asPatchServerItem(existing as QueuedPatchArchivedRecord | QueuedPatchServerItemRecord),
      asPatchServerItem(incoming as QueuedPatchArchivedRecord | QueuedPatchServerItemRecord),
    )
  }
  if (existing.kind === 'patchArchived' && incoming.kind === 'create') {
    return { ...incoming, updatedAt: now }
  }
  if (existing.kind === 'itemMemberState' && incoming.kind === 'itemMemberState' && existing.itemKey === incoming.itemKey) {
    return { ...incoming, updatedAt: now }
  }
  if (existing.kind === 'patchMember' && incoming.kind === 'patchMember' && existing.itemKey === incoming.itemKey) {
    const next: QueuedPatchMemberRecord = {
      ...existing,
      ...incoming,
      updatedAt: now,
      name: incoming.name !== undefined ? incoming.name : existing.name,
      is_public: incoming.is_public !== undefined ? incoming.is_public : existing.is_public,
    }
    return next
  }
  if (existing.kind === 'addMember' && incoming.kind === 'addMember' && existing.itemKey === incoming.itemKey) {
    return { ...incoming, updatedAt: now }
  }
  return { ...incoming, updatedAt: now }
}

export async function enqueueItemMutation(record: QueuedItemMutationRecord): Promise<void> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : null
  appendOfflineNavDiagnostic(
    `[db-write] target=indexeddb store=${STORE} action=enqueue-start kind=${record.kind} listId=${record.listId} itemKey=${record.itemKey}`,
  )
  const db = await openOutboxDb()
  if (!db) return
  const key = storeKey(record.listId, record.itemKey)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const getReq = os.get(key)
    getReq.onsuccess = () => {
      const prev = (getReq.result as StoredRow | undefined)?.record ?? null
      const merged = mergeRecords(prev, record)
      const row: StoredRow = {
        key,
        listId: merged.listId,
        itemKey: merged.itemKey,
        updatedAt: merged.updatedAt,
        record: merged,
      }
      os.put(row)
    }
    tx.oncomplete = () => {
      appendOfflineNavDiagnostic(
        `[db-write] target=indexeddb store=${STORE} action=enqueue-end kind=${record.kind} listId=${record.listId} itemKey=${record.itemKey} durationMs=${t0 == null ? 'n/a' : String(Math.round(performance.now() - t0))}`,
      )
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/** Merge archived flags into an existing queued create for the same temp item (no separate read). */
export async function mergeQueuedCreateArchived(
  listId: string,
  tempItemId: string,
  archived: boolean,
  archived_at: string | null,
): Promise<void> {
  await enqueueItemMutation({
    kind: 'patchArchived',
    listId,
    itemKey: tempItemId,
    updatedAt: Date.now(),
    archived,
    archived_at,
  })
}

export function itemMemberStateOutboxKey(itemId: string, memberId: string) {
  return `ims:${itemId}:${memberId}`
}

export function memberProfileOutboxKey(memberId: string) {
  return `mbr:${memberId}`
}

export async function getPendingItemMutationsForList(listId: string): Promise<QueuedItemMutationRecord[]> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : null
  appendOfflineNavDiagnostic(
    `[db-read] target=indexeddb store=${STORE} action=get-pending-start listId=${listId}`,
  )
  const db = await openOutboxDb()
  if (!db) return []
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const idx = os.index('by_list')
    const req = idx.getAll(listId)
    req.onsuccess = () => {
      const rows = (req.result as StoredRow[]) || []
      const records = rows.map((r) => r.record)
      appendOfflineNavDiagnostic(
        `[db-read] target=indexeddb store=${STORE} action=get-pending-end listId=${listId} count=${records.length} durationMs=${t0 == null ? 'n/a' : String(Math.round(performance.now() - t0))}`,
      )
      resolve(records)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function removePendingItemMutation(listId: string, itemKey: string): Promise<void> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : null
  appendOfflineNavDiagnostic(
    `[db-write] target=indexeddb store=${STORE} action=remove-start listId=${listId} itemKey=${itemKey}`,
  )
  const db = await openOutboxDb()
  if (!db) return
  const key = storeKey(listId, itemKey)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => {
      appendOfflineNavDiagnostic(
        `[db-write] target=indexeddb store=${STORE} action=remove-end listId=${listId} itemKey=${itemKey} durationMs=${t0 == null ? 'n/a' : String(Math.round(performance.now() - t0))}`,
      )
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/** Drain order: creates → add members → server item patches → member states → member profile patches */
export function sortPendingForDrain(records: QueuedItemMutationRecord[]): QueuedItemMutationRecord[] {
  const creates = records.filter((r): r is QueuedCreateRecord => r.kind === 'create')
  const addMembers = records.filter((r): r is QueuedAddMemberRecord => r.kind === 'addMember')
  const patchItems = records.filter(
    (r): r is QueuedPatchArchivedRecord | QueuedPatchServerItemRecord =>
      r.kind === 'patchArchived' || r.kind === 'patchServerItem',
  )
  const ims = records.filter((r): r is QueuedItemMemberStateRecord => r.kind === 'itemMemberState')
  const mbr = records.filter((r): r is QueuedPatchMemberRecord => r.kind === 'patchMember')

  creates.sort((a, b) => {
    const o = a.payload.sort_order - b.payload.sort_order
    if (o !== 0) return o
    return a.updatedAt - b.updatedAt
  })
  addMembers.sort((a, b) => a.updatedAt - b.updatedAt)
  patchItems.sort((a, b) => a.updatedAt - b.updatedAt)
  ims.sort((a, b) => a.updatedAt - b.updatedAt)
  mbr.sort((a, b) => a.updatedAt - b.updatedAt)
  return [...creates, ...addMembers, ...patchItems, ...ims, ...mbr]
}

/** After a queued member insert gets a server id, fix temp member ids in pending rows for this list. */
export async function remapMemberDependentQueuedRecords(
  listId: string,
  tempMemberId: string,
  serverMemberId: string,
): Promise<void> {
  if (tempMemberId === serverMemberId) return

  let pendingCreates = await getPendingItemMutationsForList(listId)
  let guard = 0
  while (guard++ < 500) {
    const next = pendingCreates.find(
      (r): r is QueuedCreateRecord =>
        r.kind === 'create' && Boolean(r.payload.memberStates[tempMemberId]),
    )
    if (!next) break
    const ms = next.payload.memberStates[tempMemberId]
    const { [tempMemberId]: _removed, ...rest } = next.payload.memberStates
    const nextStates = {
      ...rest,
      [serverMemberId]: { ...ms, member_id: serverMemberId },
    }
    await enqueueItemMutation({
      kind: 'create',
      listId: next.listId,
      itemKey: next.itemKey,
      updatedAt: Date.now(),
      payload: { ...next.payload, memberStates: nextStates },
    })
    pendingCreates = await getPendingItemMutationsForList(listId)
  }

  const pending = await getPendingItemMutationsForList(listId)
  for (const r of pending) {
    if (r.kind === 'itemMemberState' && r.memberId === tempMemberId) {
      await removePendingItemMutation(listId, r.itemKey)
      await enqueueItemMutation({
        kind: 'itemMemberState',
        listId: r.listId,
        itemKey: itemMemberStateOutboxKey(r.itemId, serverMemberId),
        updatedAt: Date.now(),
        itemId: r.itemId,
        memberId: serverMemberId,
        insert: r.insert,
        quantity: r.quantity,
        done: r.done,
        assigned: r.assigned,
      })
    } else if (r.kind === 'patchMember' && r.memberId === tempMemberId) {
      await removePendingItemMutation(listId, r.itemKey)
      await enqueueItemMutation({
        kind: 'patchMember',
        listId: r.listId,
        itemKey: memberProfileOutboxKey(serverMemberId),
        updatedAt: Date.now(),
        memberId: serverMemberId,
        ...(r.name !== undefined ? { name: r.name } : {}),
        ...(r.is_public !== undefined ? { is_public: r.is_public } : {}),
      })
    }
  }
}
