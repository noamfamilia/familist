/**
 * Persisted queue for add / archive / restore item when offline or after connectivity failures.
 * Last-write-wins per (listId, itemKey) where itemKey is temp item id or server item id.
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

export type QueuedPatchArchivedRecord = {
  kind: 'patchArchived'
  listId: string
  /** Server item id, or temp item id (merged into pending create). */
  itemKey: string
  updatedAt: number
  archived: boolean
  archived_at: string | null
}

export type QueuedItemMutationRecord = QueuedCreateRecord | QueuedPatchArchivedRecord

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
    return {
      kind: 'create',
      listId: existing.listId,
      itemKey: existing.itemKey,
      updatedAt: now,
      payload: {
        ...existing.payload,
        archived: incoming.archived,
        archived_at: incoming.archived_at,
      },
    }
  }
  if (existing.kind === 'patchArchived' && incoming.kind === 'patchArchived' && existing.itemKey === incoming.itemKey) {
    return { ...incoming, updatedAt: now }
  }
  if (existing.kind === 'patchArchived' && incoming.kind === 'create') {
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

/** Sort: creates first (by sort_order then updatedAt), then patchArchived by updatedAt. */
export function sortPendingForDrain(records: QueuedItemMutationRecord[]): QueuedItemMutationRecord[] {
  const creates = records.filter((r): r is QueuedCreateRecord => r.kind === 'create')
  const patches = records.filter((r): r is QueuedPatchArchivedRecord => r.kind === 'patchArchived')
  creates.sort((a, b) => {
    const o = a.payload.sort_order - b.payload.sort_order
    if (o !== 0) return o
    return a.updatedAt - b.updatedAt
  })
  patches.sort((a, b) => a.updatedAt - b.updatedAt)
  return [...creates, ...patches]
}
