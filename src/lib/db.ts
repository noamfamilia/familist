import Dexie, { type EntityTable } from 'dexie'
import type {
  Feedback,
  List,
  Item,
  ItemMemberState,
  ListUser,
  MemberWithCreator,
  Profile,
} from '@/lib/supabase/types'

export type SoftDeleteMeta = {
  deleted_at: number | null
}

export type DbListRow = List &
  SoftDeleteMeta & {
    userId: string
    cachedAt: number
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

export type DbListUserRow = ListUser

export type DbFeedbackRow = Feedback
export type DbListSummaryRow = {
  userId: string
  listId: string
  memberCount: number
  activeItemCount: number
  archivedItemCount: number
  ownerNickname: string | null
  cachedAt: number
}

export type DbJoinedUserRow = {
  listId: string
  userId: string
  nickname: string | null
  memberCount: number
  cachedAt: number
}

export type DbListShareTokenRow = {
  listId: string
  joinToken: string | null
  cachedAt: number
}

export type DbProfileRow = Profile & {
  cachedAt: number
}

export type SyncEntityKind = 'list' | 'item' | 'member' | 'item_member_state'
export type SyncMutationKind =
  | 'create'
  | 'patchServerItem'
  | 'reorderListItems'
  | 'bulkAddListItems'
  | 'bulkPatchListLabels'
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
  items!: EntityTable<DbItemRow, '[userId+listId+id]'>
  members!: EntityTable<DbMemberRow, '[userId+listId+id]'>
  item_member_state!: EntityTable<DbItemMemberStateRow, '[listId+item_id+member_id]'>
  list_users!: EntityTable<DbListUserRow, '[list_id+user_id]'>
  listSummaries!: EntityTable<DbListSummaryRow, '[userId+listId]'>
  feedback!: EntityTable<DbFeedbackRow, 'id'>
  joinedUsers!: EntityTable<DbJoinedUserRow, '[listId+userId]'>
  listShareTokens!: EntityTable<DbListShareTokenRow, 'listId'>
  profiles!: EntityTable<DbProfileRow, 'id'>
  sync_queue!: EntityTable<DbSyncQueueRow, '[listId+itemKey]'>
  offlineRouteMarkers!: EntityTable<DbOfflineRouteMarkerRow, '[userId+listId+buildId]'>
  meta!: EntityTable<DbMetaRow, 'key'>

  constructor() {
    super('familist')
    this.version(2).stores({
      lists: '&[userId+id], userId, owner_id, visibility, archived, updated_at, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      list_users: '&[list_id+user_id], list_id, user_id, sort_order, role, archived, sum_scope',
      listSummaries: '&[userId+listId], userId, listId, cachedAt',
      feedback: '&id, user_id, created_at',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
    this.version(3).stores({
      lists: '&[userId+id], userId, owner_id, visibility, archived, updated_at, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      list_users: '&[list_id+user_id], list_id, user_id, sort_order, role, archived, sum_scope',
      listSummaries: '&[userId+listId], userId, listId, cachedAt',
      feedback: '&id, user_id, created_at',
      joinedUsers: '&[listId+userId], listId, cachedAt',
      listShareTokens: '&listId, cachedAt',
      profiles: '&id, updated_at, cachedAt',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
    this.version(4).stores({
      lists: '&[userId+id], userId, owner_id, visibility, archived, updated_at, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      list_users: '&[list_id+user_id], list_id, user_id, sort_order, role, archived, sum_scope',
      listSummaries: '&[userId+listId], userId, listId, cachedAt',
      feedback: '&id, user_id, created_at',
      joinedUsers: '&[listId+userId], listId, cachedAt',
      listShareTokens: '&listId, cachedAt',
      profiles: '&id, updated_at, cachedAt',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
    this.version(5).stores({
      lists: '&[userId+id], userId, owner_id, visibility, archived, updated_at, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      list_users: '&[list_id+user_id], list_id, user_id, sort_order, role, archived, sum_scope',
      listSummaries: '&[userId+listId], userId, listId, cachedAt',
      feedback: '&id, user_id, created_at',
      joinedUsers: '&[listId+userId], listId, cachedAt',
      listShareTokens: '&listId, cachedAt',
      profiles: '&id, updated_at, cachedAt',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
    this.version(6).stores({
      lists: '&[userId+id], userId, owner_id, visibility, archived, updated_at, deleted_at',
      items: '&[userId+listId+id], [userId+listId], list_id, archived, sort_order, category, deleted_at',
      members: '&[userId+listId+id], [userId+listId], list_id, sort_order, deleted_at',
      item_member_state:
        '&[listId+item_id+member_id], [listId+item_id], [listId+member_id], item_id, member_id, deleted_at',
      list_users: '&[list_id+user_id], list_id, user_id, sort_order, role, archived, sum_scope',
      listSummaries: '&[userId+listId], userId, listId, cachedAt',
      feedback: '&id, user_id, created_at',
      joinedUsers: '&[listId+userId], listId, cachedAt',
      listShareTokens: '&listId, cachedAt',
      profiles: '&id, updated_at, cachedAt',
      sync_queue: '&[listId+itemKey], listId, kind, updatedAt',
      offlineRouteMarkers: '&[userId+listId+buildId], [userId+listId], buildId',
      meta: '&key',
    })
  }
}

export const db = new FamilistDexie()
