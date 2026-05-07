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
  }
}

export const db = new FamilistDexie()
