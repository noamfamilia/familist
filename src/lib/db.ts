import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { Feedback, Item, ItemMemberState, List, ListUser, MemberWithCreator, Profile } from '@/lib/supabase/types'
import { normalizeDexieEntityRow } from '@/lib/data/base_sync_fields'

type Uuid = string

export type DbListRow = List & {
  cached_at: number
  app_version?: string | null
}

export type DbListUserRow = ListUser & {
  id: Uuid
  /**
   * Dexie-only. When true, last outbound attempt for this membership’s lists failed (see `useSyncStore` /
   * `listUserSyncStatus`). Cleared on new worker attempt, successful send, enqueue of new work, or
   * `clearSyncQueueForList`. Drives **error** vs **stale** on `ListSyncStatusIcon` with `pending_items`.
   */
  sync_error?: boolean
}

export type DbItemRow = Item

export type DbMemberRow = MemberWithCreator

export type DbItemMemberStateRow = ItemMemberState & {
  id: Uuid
  list_id: Uuid
}

export type DbProfileRow = Profile
export type DbFeedbackRow = Feedback

/** Tables that can appear in the outbound sync queue. */
export type SyncQueueEntity =
  | 'list'
  | 'list_users'
  | 'item'
  | 'member'
  | 'item_member_state'
  | 'profile'
  | 'feedback'

export type SyncQueueKind = 'create' | 'patch' | 'delete' | 'rpc'

/**
 * Outbound Dexie `sync_queue` row state — driven by `useSyncStore` (see `tryClaimSyncRow`, drain loop).
 *
 * - **queued** — Not being executed yet. Worker picks it when `isEligibleForSync` passes (`next_retry_at`,
 *   lock freshness). New rows default here.
 * - **processing** — Worker claimed the row (`tryClaimSyncRow`), is running `executeOutboundRow` (Supabase RPC/table writes).
 *   On success the row is **deleted**. On failure → **failed** or connectivity retry → back to **queued** with delay.
 * - **failed** — Non-connectivity error or verification failure; `last_error` set, `attempt_count` bumped,
 *   `next_retry_at` from **exponential backoff** (HTTP 429 / 5xx only) or **linear** backoff otherwise.
 *   **Terminal** logical errors (any explicit HTTP status except **429** and **5xx**, or structured Postgres/PostgREST `code`) **drop** the row
 *   instead of `failed`. Window `online` resets remaining `failed` → `queued` (`resetFailedSyncQueueRows`).
 *
 * **Consumers:** `useSyncStore` (drain), `buildListsCatalogFromDexie` / `useListsQuery` / `countPendingOutboundForList` (per-list `pending_items`),
 * `outboundDeletePending` in serverDexieParity, `waitForSyncQueueRowCompletion`, `versionCheck` prune, dev Diagnostics.
 */
export type SyncQueueStatus = 'queued' | 'processing' | 'failed'

export type DbSyncQueueRow = {
  id: Uuid
  entity: SyncQueueEntity
  /** Row id, or `batch:${uuid}` for non-row RPC scopes. */
  entity_id: string
  kind: SyncQueueKind
  payload: Record<string, unknown>
  parent1_type: 'user' | 'list' | 'item' | null
  parent1_id: string | null
  parent2_type: 'user' | 'member' | null
  parent2_id: string | null
  status: SyncQueueStatus
  locked_at: number | null
  attempt_count: number
  last_error: string | null
  /** When set and in the future, queued/failed work waits until this time (ms epoch). */
  next_retry_at: number | null
  updated_at: number
}

export type DbOfflineRouteMarkerRow = {
  id: Uuid
  user_id: Uuid
  list_id: Uuid
  build_id: string
  verified_at: number
}

export type DbMetaRow = {
  id: string
  value: unknown
  updated_at: number
}

async function migrateV9SyncFields(trans: Transaction) {
  const migrateTable = async (tableName: 'lists' | 'items' | 'members' | 'list_users' | 'profiles' | 'feedback') => {
    const tbl = trans.table(tableName)
    const rows = await tbl.toArray()
    for (const row of rows) {
      await tbl.put(
        normalizeDexieEntityRow(row as Record<string, unknown>, { legacyCreatedKey: 'created_at' }) as never,
      )
    }
  }
  const migrateIms = async () => {
    const tbl = trans.table('item_member_state')
    const rows = await tbl.toArray()
    for (const row of rows) {
      const r = row as Record<string, unknown>
      await tbl.put(
        normalizeDexieEntityRow(r, {
          serverFallback: typeof r.updated_at === 'string' ? r.updated_at : undefined,
        }) as never,
      )
    }
  }
  await migrateTable('lists')
  await migrateTable('items')
  await migrateTable('members')
  await migrateTable('list_users')
  await migrateTable('profiles')
  await migrateTable('feedback')
  await migrateIms()
}

/** Invert legacy list_users.sort_order per user (0 = top → higher = top). Runs once on schema v12. */
async function migrateV12ListCatalogSortOrder(trans: Transaction) {
  const lu = trans.table('list_users')
  const rows = (await lu.toArray()) as Array<{
    id: string
    user_id: string
    list_id: string
    sort_order?: number | null
  }>
  const byUser = new Map<string, typeof rows>()
  for (const r of rows) {
    const g = byUser.get(r.user_id) ?? []
    g.push(r)
    byUser.set(r.user_id, g)
  }
  for (const [, group] of byUser) {
    const sorted = [...group].sort((a, b) => {
      const ao =
        typeof a.sort_order === 'number' && Number.isFinite(a.sort_order) ? a.sort_order : Number.POSITIVE_INFINITY
      const bo =
        typeof b.sort_order === 'number' && Number.isFinite(b.sort_order) ? b.sort_order : Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return a.list_id.localeCompare(b.list_id)
    })
    const n = sorted.length
    for (let i = 0; i < n; i++) {
      await lu.update(sorted[i]!.id, { sort_order: n - 1 - i } as never)
    }
  }
}

export class FamilistDexie extends Dexie {
  lists!: EntityTable<DbListRow, 'id'>
  list_users!: EntityTable<DbListUserRow, 'id'>
  items!: EntityTable<DbItemRow, 'id'>
  members!: EntityTable<DbMemberRow, 'id'>
  item_member_state!: EntityTable<DbItemMemberStateRow, 'id'>
  profiles!: EntityTable<DbProfileRow, 'id'>
  feedback!: EntityTable<DbFeedbackRow, 'id'>
  sync_queue!: EntityTable<DbSyncQueueRow, 'id'>
  offline_route_markers!: EntityTable<DbOfflineRouteMarkerRow, 'id'>
  meta!: EntityTable<DbMetaRow, 'id'>

  constructor() {
    super('familist')
    this.version(7).stores({
      lists: '&id, owner_id',
      list_users: '&id, [list_id+user_id], user_id',
      items: '&id, list_id, text',
      members: '&id, [list_id+name], list_id',
      item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
      profiles: '&id',
      feedback: '&id, user_id',
      sync_queue: '&id, [list_id+item_key], kind',
      offline_route_markers: '&id',
      meta: '&id',
    })
    this.version(8)
      .stores({
        lists: '&id, owner_id',
        list_users: '&id, [list_id+user_id], user_id',
        items: '&id, list_id, text',
        members: '&id, [list_id+name], list_id',
        item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
        profiles: '&id',
        feedback: '&id, user_id',
        sync_queue:
          '&id, status, [entity+entity_id], [status+updated_at], parent1_type, parent1_id, parent2_id, updated_at',
        offline_route_markers: '&id',
        meta: '&id',
      })
      .upgrade(async (trans) => {
        await trans.table('sync_queue').clear()
      })
    this.version(9)
      .stores({
        lists: '&id, owner_id',
        list_users: '&id, [list_id+user_id], user_id',
        items: '&id, list_id, text',
        members: '&id, [list_id+name], list_id',
        item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
        profiles: '&id',
        feedback: '&id, user_id',
        sync_queue:
          '&id, status, [entity+entity_id], [status+updated_at], parent1_type, parent1_id, parent2_id, updated_at',
        offline_route_markers: '&id',
        meta: '&id',
      })
      .upgrade(async (trans) => {
        await migrateV9SyncFields(trans)
      })
    this.version(10)
      .stores({
        lists: '&id, owner_id',
        list_users: '&id, [list_id+user_id], user_id',
        items: '&id, list_id, text',
        members: '&id, [list_id+name], list_id',
        item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
        profiles: '&id',
        feedback: '&id, user_id',
        sync_queue:
          '&id, status, [entity+entity_id], [status+updated_at], parent1_type, parent1_id, parent2_id, updated_at, next_retry_at',
        offline_route_markers: '&id',
        meta: '&id',
      })
      .upgrade(async (trans) => {
        const tbl = trans.table('sync_queue')
        const rows = await tbl.toArray()
        for (const row of rows as Array<Record<string, unknown>>) {
          if (row.next_retry_at === undefined) {
            await tbl.update(row.id as string, { next_retry_at: null } as never)
          }
        }
        /** Must match `PENDING_SCHEMA_10_MIRROR_RECONCILE_META_ID` in `versionCheck.ts`. */
        await trans.table('meta').put({
          id: 'pending_schema_10_full_mirror_reconcile',
          value: true,
          updated_at: Date.now(),
        } as never)
      })
    this.version(11)
      .stores({
        lists: '&id, owner_id',
        list_users: '&id, [list_id+user_id], user_id',
        items: '&id, list_id, text',
        members: '&id, [list_id+name], list_id',
        item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
        profiles: '&id',
        feedback: '&id, user_id',
        sync_queue:
          '&id, status, [entity+entity_id], [status+updated_at], parent1_type, parent1_id, parent2_id, updated_at, next_retry_at',
        offline_route_markers: '&id',
        meta: '&id',
      })
      .upgrade(async (trans) => {
        const lu = trans.table('list_users')
        const rows = await lu.toArray()
        for (const r of rows as Array<Record<string, unknown> & { id: string }>) {
          if (r.sync_error === undefined) {
            await lu.update(r.id, { sync_error: false } as never)
          }
        }
      })
    this.version(12)
      .stores({
        lists: '&id, owner_id',
        list_users: '&id, [list_id+user_id], user_id',
        items: '&id, list_id, text',
        members: '&id, [list_id+name], list_id',
        item_member_state: '&id, [item_id+member_id], member_id, [list_id+item_id]',
        profiles: '&id',
        feedback: '&id, user_id',
        sync_queue:
          '&id, status, [entity+entity_id], [status+updated_at], parent1_type, parent1_id, parent2_id, updated_at, next_retry_at',
        offline_route_markers: '&id',
        meta: '&id',
      })
      .upgrade(async (trans) => {
        await migrateV12ListCatalogSortOrder(trans)
      })
  }
}

export const db = new FamilistDexie()
