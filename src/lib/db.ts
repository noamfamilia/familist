import Dexie, { type EntityTable } from 'dexie'
import type { Item, ItemMemberState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

export type SoftDeleteMeta = {
  deleted_at: number | null
}

export type DbListRow = ListWithRole &
  SoftDeleteMeta & {
    userId: string
    cachedAt: number
    app_version?: string | null
  }

export type DbListDetailRow = SoftDeleteMeta & {
  userId: string
  listId: string
  list: ListWithRole | null
  cachedAt: number
  schemaVersion: number
  app_version?: string | null
}

export type DbItemRow = Item &
  SoftDeleteMeta & {
    userId: string
    listId: string
  }

export type DbMemberRow = MemberWithCreator &
  SoftDeleteMeta & {
    userId: string
    listId: string
  }

export type DbItemMemberStateRow = ItemMemberState &
  SoftDeleteMeta & {
    listId: string
  }

export type DbListPrefRow = {
  userId: string
  listId: string
  memberFilter: string | null
  itemTextWidth: number | null
  itemTextWidthMode: 'auto' | 'manual' | null
  itemNameFontStep: number | null
  updatedAt: number
}

export type SyncEntityKind = 'list' | 'item' | 'member' | 'item_member_state'
export type SyncMutationKind =
  | 'create'
  | 'patchServerItem'
  | 'patchList'
  | 'patchListUser'
  | 'reorderListUsers'
  | 'patchArchived'
  | 'itemMemberState'
  | 'patchMember'
  | 'addMember'
  | 'delete'

export type DbSyncQueueRow = {
  listId: string
  itemKey: string
  kind: SyncMutationKind
  entity: SyncEntityKind
  payload: Record<string, unknown>
  updatedAt: number
  attemptCount: number
  lastError: string | null
}

export type DbOfflineRouteMarkerRow = {
  userId: string
  listId: string
  buildId: string
  verifiedAt: number
}

export type DbMetaRow = {
  key: string
  value: unknown
  updatedAt: number
}

export class FamilistDexie extends Dexie {
  lists!: EntityTable<DbListRow, '[userId+id]'>
  listDetails!: EntityTable<DbListDetailRow, '[userId+listId]'>
  items!: EntityTable<DbItemRow, '[userId+listId+id]'>
  members!: EntityTable<DbMemberRow, '[userId+listId+id]'>
  item_member_state!: EntityTable<DbItemMemberStateRow, '[listId+item_id+member_id]'>
  listPrefs!: EntityTable<DbListPrefRow, '[userId+listId]'>
  sync_queue!: EntityTable<DbSyncQueueRow, '[listId+itemKey]'>
  offlineRouteMarkers!: EntityTable<DbOfflineRouteMarkerRow, '[userId+listId+buildId]'>
  meta!: EntityTable<DbMetaRow, 'key'>

  constructor() {
    super('familist')
    this.version(2).stores({
      lists: '&[userId+id], userId, userArchived, sort_order, deleted_at',
      listDetails: '&[userId+listId], userId, listId, cachedAt, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      listPrefs: '&[userId+listId]',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
  }
}

export const db = new FamilistDexie()
