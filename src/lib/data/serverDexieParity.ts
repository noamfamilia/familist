import Dexie from 'dexie'
import { APP_VERSION } from '@/lib/appVersion'
import { removeCachedList } from '@/lib/cache'
import { db } from '@/lib/db'
import { isoNow, isTombstoned, legacyDeletedAtToIso, withLastSyncedNow } from '@/lib/data/base_sync_fields'
import {
  catalogRemovalBlockedForList,
  loadPendingOutboundQueueSnapshot,
  pendingCreateForEntity,
  pendingCreateForItemMemberStateComposite,
  pendingRpcTouchesList,
} from '@/lib/data/syncPruneGuards'
import { maxIsoTimestamp, pickLastContentUpdateBy } from '@/lib/data/listActivity'
import {
  reconcileListDetailPayloadWithPendingSyncPatches,
  reconcileUserListsSummaryRowsWithPendingCatalogQueue,
} from '@/lib/data/queries'
import { stableItemMemberStateDexieId, syncQueueRowTouchesListId } from '@/lib/data/syncQueue'
import type {
  Database,
  DbSyncableFields,
  ItemWithState,
  List,
  MemberWithCreator,
  Profile,
} from '@/lib/supabase/types'
import type { DbSyncQueueRow, SyncQueueEntity } from '@/lib/db'

export type GetUserListsRow = Database['public']['Functions']['get_user_lists']['Returns'][number]

export const PARITY_SCOPE = {
  get_user_lists: ['lists', 'list_users'],
  get_list_data_list: ['lists'],
  get_list_data_items: ['items'],
  get_list_data_member_states: ['item_member_state'],
  get_list_data_members: ['members'],
  list_users_prefs: ['list_users'],
  profiles_row: ['profiles'],
} as const

const PARITY_SCOPED_TABLES = [
  'lists',
  'items',
  'item_member_state',
  'members',
  'list_users',
  'profiles',
] as const

function normalizeListUserSumScope(raw: unknown): 'none' | 'all' | 'active' | 'archived' {
  if (raw === 'none' || raw === 'all' || raw === 'active' || raw === 'archived') return raw
  return 'none'
}

/** Align RPC rows with unified `DbSyncableFields` before Dexie put (ISO `deleted_at`, numeric `version`). */
export function normalizeServerSyncableFields(row: Record<string, unknown>): DbSyncableFields {
  return {
    client_created_at: typeof row.client_created_at === 'string' ? row.client_created_at : isoNow(),
    server_created_at: typeof row.server_created_at === 'string' ? row.server_created_at : null,
    deleted_at: legacyDeletedAtToIso(row.deleted_at),
    version: typeof row.version === 'number' && Number.isFinite(row.version) ? row.version : 1,
    last_synced_at: typeof row.last_synced_at === 'string' ? row.last_synced_at : null,
  }
}

async function outboundDeletePending(entity: SyncQueueEntity, entityId: string): Promise<boolean> {
  const hit = await db.sync_queue
    .where('[entity+entity_id]')
    .equals([entity, entityId])
    .filter(
      (r) =>
        r.kind === 'delete' &&
        (r.status === 'queued' || r.status === 'processing' || r.status === 'failed'),
    )
    .first()
  return !!hit
}

function buildServerImsCompositeKeySet(payload: { items: ItemWithState[] }): Set<string> {
  const keys = new Set<string>()
  for (const item of payload.items) {
    for (const ms of Object.values(item.memberStates ?? {})) {
      keys.add(`${ms.item_id}\t${ms.member_id}`)
    }
  }
  return keys
}

/**
 * Remove Dexie rows under `listId` that are absent from the server payload.
 * Must run inside the same Dexie `rw` transaction as the preceding upserts (includes `sync_queue` for snapshot reads).
 */
async function pruneListDetailAfterServerUpsert(
  listId: string,
  payload: { items: ItemWithState[]; members: MemberWithCreator[] },
  queue: readonly DbSyncQueueRow[],
  preserveItemIds?: ReadonlySet<string>,
  preserveMemberIds?: ReadonlySet<string>,
): Promise<void> {
  if (pendingRpcTouchesList(queue, listId)) return

  const serverItemIds = new Set(payload.items.map((i) => i.id))
  const serverMemberIds = new Set(payload.members.map((m) => m.id))
  if (preserveItemIds) for (const id of preserveItemIds) serverItemIds.add(id)
  if (preserveMemberIds) for (const id of preserveMemberIds) serverMemberIds.add(id)

  const serverImsKeys = buildServerImsCompositeKeySet(payload)

  const localItems = await db.items.where('list_id').equals(listId).toArray()
  for (const it of localItems) {
    if (serverItemIds.has(it.id)) continue
    if (pendingCreateForEntity(queue, 'item', it.id)) continue
    await db.item_member_state.filter((s) => s.list_id === listId && s.item_id === it.id).delete()
    await db.items.delete(it.id)
  }

  const localMembers = await db.members.where('list_id').equals(listId).toArray()
  for (const m of localMembers) {
    if (serverMemberIds.has(m.id)) continue
    if (pendingCreateForEntity(queue, 'member', m.id)) continue
    await db.item_member_state.where('member_id').equals(m.id).delete()
    await db.members.delete(m.id)
  }

  const imsRows = await db.item_member_state
    .where('[list_id+item_id]')
    .between([listId, Dexie.minKey], [listId, Dexie.maxKey])
    .toArray()
  for (const s of imsRows) {
    const key = `${s.item_id}\t${s.member_id}`
    if (serverImsKeys.has(key)) continue
    if (pendingCreateForEntity(queue, 'item', s.item_id)) continue
    if (pendingCreateForEntity(queue, 'member', s.member_id)) continue
    if (pendingCreateForItemMemberStateComposite(queue, s.item_id, s.member_id)) continue
    await db.item_member_state.delete(s.id)
  }
}

type ListUserPrefsServerRow = {
  member_filter?: string | null
  item_text_width?: string | number | null
  item_name_font_step?: number | null
  last_viewed_members?: string | null
  last_viewed?: string | null
  sum_scope?: unknown
}

export async function upsertListsSummaryFromServer(userId: string, rows: GetUserListsRow[]) {
  const now = Date.now()
  const removedListIds: string[] = []
  await db.transaction(
    'rw',
    [
      db.lists,
      db.list_users,
      db.items,
      db.members,
      db.item_member_state,
      db.offline_route_markers,
      db.sync_queue,
      db.profiles,
    ],
    async () => {
      const queue = await loadPendingOutboundQueueSnapshot()
      const rowsReconciled = reconcileUserListsSummaryRowsWithPendingCatalogQueue(rows, queue, userId)
      const pendingListCreateIds = new Set(
        queue
          .filter(
            (r) =>
              r.kind === 'create' &&
              r.entity === 'list' &&
              (r.status === 'queued' || r.status === 'processing' || r.status === 'failed'),
          )
          .map((r) => r.entity_id),
      )
      const incomingIds = new Set(rowsReconciled.map((row) => row.id))
      for (const row of rowsReconciled) {
        const { role, userArchived, userArchivedAt, sort_order, sumScope, label, ownerNickname } = row
        if (role !== 'owner' && row.owner_id) {
          await upsertOwnerProfileNicknameFromCatalog(row.owner_id, ownerNickname)
        }
        const existingList = await db.lists.get(row.id)
        const listSync = normalizeServerSyncableFields(row as unknown as Record<string, unknown>)
        await db.lists.put(
          withLastSyncedNow({
            id: row.id,
            name: row.name,
            owner_id: row.owner_id,
            visibility: row.visibility,
            archived: row.archived,
            client_created_at: listSync.client_created_at,
            server_created_at: listSync.server_created_at,
            deleted_at: listSync.deleted_at,
            version: listSync.version,
            last_synced_at: listSync.last_synced_at,
            updated_at: row.updated_at,
            last_content_update: maxIsoTimestamp(
              row.last_content_update,
              existingList?.last_content_update,
              row.updated_at,
            ),
            // Server is authoritative once it has stamped an author; only fall back to the
            // local value while server still returns null (pre-deploy rows).
            last_content_update_by: row.last_content_update_by ?? existingList?.last_content_update_by ?? null,
            comment: row.comment ?? null,
            category_names: existingList?.category_names ?? null,
            category_order: existingList?.category_order ?? null,
            join_token: existingList?.join_token ?? null,
            join_role_granted: existingList?.join_role_granted ?? 'editor',
            join_expires_at: existingList?.join_expires_at ?? null,
            join_revoked_at: existingList?.join_revoked_at ?? null,
            join_use_count: existingList?.join_use_count ?? 0,
            cached_at: now,
            app_version: APP_VERSION,
          }),
        )
        const existingListUser = await db.list_users.where('[list_id+user_id]').equals([row.id, userId]).first()
        const resolvedSortOrder =
          pendingListCreateIds.has(row.id) &&
          typeof existingListUser?.sort_order === 'number' &&
          Number.isFinite(existingListUser.sort_order)
            ? existingListUser.sort_order
            : (sort_order ?? null)
        await db.list_users.put(
          withLastSyncedNow({
            id: existingListUser?.id ?? crypto.randomUUID(),
            list_id: row.id,
            user_id: userId,
            role,
            archived: userArchived,
            archived_at: userArchivedAt ?? null,
            sort_order: resolvedSortOrder,
            client_created_at: existingListUser?.client_created_at ?? isoNow(),
            server_created_at: existingListUser?.server_created_at ?? row.server_created_at,
            deleted_at: existingListUser?.deleted_at ?? null,
            version: existingListUser?.version ?? row.version ?? 1,
            last_synced_at: existingListUser?.last_synced_at ?? null,
            member_filter: existingListUser?.member_filter ?? 'all',
            item_text_width: existingListUser?.item_text_width ?? 'auto',
            item_name_font_step: existingListUser?.item_name_font_step ?? 3,
            show_targets: existingListUser?.show_targets ?? false,
            last_viewed_members: existingListUser?.last_viewed_members ?? null,
            last_viewed: row.last_viewed ?? existingListUser?.last_viewed ?? null,
            sum_scope: sumScope ?? 'none',
            label: label ?? '',
            sync_error: existingListUser?.sync_error ?? false,
          }),
        )
      }
      const memberships = await db.list_users.where('user_id').equals(userId).toArray()
      for (const lu of memberships) {
        if (incomingIds.has(lu.list_id)) continue
        if (catalogRemovalBlockedForList(queue, lu.list_id)) continue

        await db.item_member_state
          .where('[list_id+item_id]')
          .between([lu.list_id, Dexie.minKey], [lu.list_id, Dexie.maxKey])
          .delete()
        await db.items.where('list_id').equals(lu.list_id).delete()
        await db.members.where('list_id').equals(lu.list_id).delete()
        await db.list_users.filter((x) => x.list_id === lu.list_id).delete()
        await db.offline_route_markers.filter((m) => m.list_id === lu.list_id).delete()
        await db.sync_queue.filter((r) => syncQueueRowTouchesListId(r, lu.list_id)).delete()
        await db.lists.delete(lu.list_id)
        removedListIds.push(lu.list_id)
      }
    },
  )
  for (const lid of removedListIds) {
    removeCachedList(userId, lid)
  }
}

export async function upsertListDataPayloadFromServer(
  userId: string,
  listId: string,
  payload: {
    list: List | null
    items: ItemWithState[]
    members: MemberWithCreator[]
  },
) {
  void userId
  const now = Date.now()
  await db.transaction('rw', [db.lists, db.items, db.members, db.item_member_state, db.sync_queue], async () => {
    const queue = await loadPendingOutboundQueueSnapshot()
    const payloadReconciled = reconcileListDetailPayloadWithPendingSyncPatches(listId, payload, queue)
    if (payloadReconciled.list) {
      const listSync = normalizeServerSyncableFields(payloadReconciled.list as unknown as Record<string, unknown>)
      const existingListRow = await db.lists.get(listId)
      const keepMsg = existingListRow?.sync_error_message
      await db.lists.put(
        withLastSyncedNow({
          ...payloadReconciled.list,
          ...listSync,
          last_content_update: maxIsoTimestamp(
            payloadReconciled.list.last_content_update,
            existingListRow?.last_content_update,
            payloadReconciled.list.updated_at,
          ),
          last_content_update_by: pickLastContentUpdateBy([
            { ts: payloadReconciled.list.last_content_update, by: payloadReconciled.list.last_content_update_by },
            { ts: existingListRow?.last_content_update, by: existingListRow?.last_content_update_by },
          ]),
          cached_at: now,
          app_version: APP_VERSION,
          ...(typeof keepMsg === 'string' && keepMsg.trim() !== '' ? { sync_error_message: keepMsg } : {}),
        }),
      )
    }
    for (const item of payloadReconciled.items) {
      const itemSync = normalizeServerSyncableFields(item as unknown as Record<string, unknown>)
      await db.items.put(withLastSyncedNow({ ...item, ...itemSync }))
      for (const memberState of Object.values(item.memberStates ?? {})) {
        const rowId = await stableItemMemberStateDexieId(memberState.item_id, memberState.member_id)
        const imsDupes = await db.item_member_state
          .where('[item_id+member_id]')
          .equals([memberState.item_id, memberState.member_id])
          .toArray()
        for (const r of imsDupes) {
          if (r.id !== rowId) await db.item_member_state.delete(r.id)
        }
        const imsSync = normalizeServerSyncableFields(memberState as unknown as Record<string, unknown>)
        await db.item_member_state.put(
          withLastSyncedNow({
            id: rowId,
            ...memberState,
            ...imsSync,
            list_id: listId,
          }),
        )
      }
    }
    for (const member of payloadReconciled.members) {
      const memSync = normalizeServerSyncableFields(member as unknown as Record<string, unknown>)
      await db.members.put(withLastSyncedNow({ ...member, ...memSync }))
    }
    await pruneListDetailAfterServerUpsert(listId, payloadReconciled, queue)
  })
}

/**
 * Background mirror path: same tables as `upsertListDataPayloadFromServer`, plus tombstone respect —
 * does not overwrite a locally tombstoned row with a live server row when an outbound `delete` is still queued.
 */
export async function upsertListDataPayloadFromMirror(
  userId: string,
  listId: string,
  payload: {
    list: List | null
    items: ItemWithState[]
    members: MemberWithCreator[]
  },
) {
  void userId
  const now = Date.now()

  const skipItemIds = new Set<string>()
  for (const item of payload.items) {
    const itemSync = normalizeServerSyncableFields(item as unknown as Record<string, unknown>)
    const localItem = await db.items.get(item.id)
    const serverLive = !isTombstoned(itemSync.deleted_at)
    if (localItem && isTombstoned(localItem.deleted_at ?? null) && serverLive) {
      if (await outboundDeletePending('item', item.id)) {
        skipItemIds.add(item.id)
      }
    }
  }

  const skipMemberIds = new Set<string>()
  for (const member of payload.members) {
    const memSync = normalizeServerSyncableFields(member as unknown as Record<string, unknown>)
    const localMember = await db.members.get(member.id)
    const memServerLive = !isTombstoned(memSync.deleted_at)
    if (localMember && isTombstoned(localMember.deleted_at ?? null) && memServerLive) {
      if (await outboundDeletePending('member', member.id)) {
        skipMemberIds.add(member.id)
      }
    }
  }

  await db.transaction('rw', [db.lists, db.items, db.members, db.item_member_state, db.sync_queue], async () => {
    const queue = await loadPendingOutboundQueueSnapshot()
    const payloadReconciled = reconcileListDetailPayloadWithPendingSyncPatches(listId, payload, queue)
    if (payloadReconciled.list) {
      const listSync = normalizeServerSyncableFields(payloadReconciled.list as unknown as Record<string, unknown>)
      const existingListRow = await db.lists.get(listId)
      const keepMsg = existingListRow?.sync_error_message
      await db.lists.put(
        withLastSyncedNow({
          ...payloadReconciled.list,
          ...listSync,
          last_content_update: maxIsoTimestamp(
            payloadReconciled.list.last_content_update,
            existingListRow?.last_content_update,
            payloadReconciled.list.updated_at,
          ),
          last_content_update_by: pickLastContentUpdateBy([
            { ts: payloadReconciled.list.last_content_update, by: payloadReconciled.list.last_content_update_by },
            { ts: existingListRow?.last_content_update, by: existingListRow?.last_content_update_by },
          ]),
          cached_at: now,
          app_version: APP_VERSION,
          ...(typeof keepMsg === 'string' && keepMsg.trim() !== '' ? { sync_error_message: keepMsg } : {}),
        }),
      )
    }
    for (const item of payloadReconciled.items) {
      if (skipItemIds.has(item.id)) continue
      const itemSync = normalizeServerSyncableFields(item as unknown as Record<string, unknown>)
      await db.items.put(withLastSyncedNow({ ...item, ...itemSync }))
      for (const memberState of Object.values(item.memberStates ?? {})) {
        const rowId = await stableItemMemberStateDexieId(memberState.item_id, memberState.member_id)
        const imsDupes = await db.item_member_state
          .where('[item_id+member_id]')
          .equals([memberState.item_id, memberState.member_id])
          .toArray()
        for (const r of imsDupes) {
          if (r.id !== rowId) await db.item_member_state.delete(r.id)
        }
        const imsSync = normalizeServerSyncableFields(memberState as unknown as Record<string, unknown>)
        await db.item_member_state.put(
          withLastSyncedNow({
            id: rowId,
            ...memberState,
            ...imsSync,
            list_id: listId,
          }),
        )
      }
    }
    for (const member of payloadReconciled.members) {
      if (skipMemberIds.has(member.id)) continue
      const memSync = normalizeServerSyncableFields(member as unknown as Record<string, unknown>)
      await db.members.put(withLastSyncedNow({ ...member, ...memSync }))
    }
    await pruneListDetailAfterServerUpsert(listId, payloadReconciled, queue, skipItemIds, skipMemberIds)
  })
}

export async function upsertListPrefsFromServer(
  userId: string,
  listId: string,
  row: ListUserPrefsServerRow | null | undefined,
) {
  if (!row) return
  const itemTextWidthRaw = row.item_text_width
  const itemTextWidth =
    typeof itemTextWidthRaw === 'number'
      ? String(itemTextWidthRaw)
      : typeof itemTextWidthRaw === 'string'
        ? itemTextWidthRaw
        : 'auto'
  const existingByComposite = await db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
  await db.list_users.put(
    withLastSyncedNow({
      id: existingByComposite?.id ?? crypto.randomUUID(),
      list_id: listId,
      user_id: userId,
      role: existingByComposite?.role ?? 'viewer',
      archived: existingByComposite?.archived ?? false,
      archived_at: existingByComposite?.archived_at ?? null,
      sort_order: existingByComposite?.sort_order ?? null,
      client_created_at: existingByComposite?.client_created_at ?? isoNow(),
      server_created_at: existingByComposite?.server_created_at ?? null,
      deleted_at: existingByComposite?.deleted_at ?? null,
      version: existingByComposite?.version ?? 1,
      last_synced_at: existingByComposite?.last_synced_at ?? null,
      member_filter: row.member_filter ?? existingByComposite?.member_filter ?? 'all',
      item_text_width: itemTextWidth,
      label: existingByComposite?.label ?? '',
      last_viewed_members: row.last_viewed_members ?? null,
      last_viewed: row.last_viewed ?? existingByComposite?.last_viewed ?? null,
      show_targets: existingByComposite?.show_targets ?? false,
      item_name_font_step: row.item_name_font_step ?? existingByComposite?.item_name_font_step ?? 3,
      sum_scope: normalizeListUserSumScope(row.sum_scope),
      sync_error: existingByComposite?.sync_error ?? false,
    }),
  )
}

export async function readListPrefsFromDexie(userId: string, listId: string) {
  return db.list_users.where('[list_id+user_id]').equals([listId, userId]).first()
}

export async function upsertProfileFromServer(row: Profile) {
  const sync = normalizeServerSyncableFields(row as unknown as Record<string, unknown>)
  await db.profiles.put(withLastSyncedNow({ ...row, ...sync }))
}

/** Persist list-owner display names from `get_user_lists` so shared list cards can resolve `ownerNickname` offline. */
async function upsertOwnerProfileNicknameFromCatalog(
  ownerId: string,
  nickname: string | null | undefined,
): Promise<void> {
  const trimmed = nickname?.trim()
  if (!trimmed) return

  const existing = await db.profiles.get(ownerId)
  if (existing?.nickname === trimmed) return

  await db.profiles.put(
    withLastSyncedNow({
      id: ownerId,
      email: existing?.email ?? null,
      nickname: trimmed,
      label_filter: existing?.label_filter ?? 'Any',
      theme: existing?.theme ?? 'light',
      client_created_at: existing?.client_created_at ?? isoNow(),
      server_created_at: existing?.server_created_at ?? null,
      deleted_at: existing?.deleted_at ?? null,
      version: existing?.version ?? 1,
      last_synced_at: existing?.last_synced_at ?? null,
    }),
  )
}
