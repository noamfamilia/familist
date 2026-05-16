import { APP_VERSION } from '@/lib/appVersion'
import { db, type DbItemMemberStateRow, type DbItemRow, type DbListRow, type DbListUserRow, type DbMemberRow } from '@/lib/db'
import { syncFieldsForLocalInsert, isTombstoned, isoNow } from '@/lib/data/base_sync_fields'
import { normalizeServerSyncableFields } from '@/lib/data/serverDexieParity'
import { loadListDetailFromDexie } from '@/lib/data/queries'
import {
  enqueueSyncQueueRecord,
  listQueueParent,
  stableItemMemberStateDexieId,
} from '@/lib/data/syncQueue'
import { nextListCatalogSortOrderFromMembershipRows } from '@/lib/data/listCatalogSort'
import type { ItemWithState, ListWithRole, MemberWithCreator } from '@/lib/supabase/types'

export const DUPLICATE_OFFLINE_CACHE_MESSAGE =
  'Please open the source list once while online before duplicating offline.'

export const DUPLICATE_MAX_ITEMS = 500

export class DuplicateListError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message)
    this.name = 'DuplicateListError'
  }
}

export type DuplicateListLocalInput = {
  sourceListId: string
  newName: string
  label?: string
  mutationUserId: string
  /** Shown in member menu as Owner; falls back to Dexie `profiles` when omitted. */
  duplicatorNickname?: string | null
}

export type DuplicateListLocalResult = {
  duplicateId: string
  optimisticList: ListWithRole
}

function countItemBuckets(items: readonly { archived?: boolean | null }[]) {
  let active = 0
  let archived = 0
  for (const it of items) {
    if (it.archived) archived += 1
    else active += 1
  }
  return { active, archived }
}

async function resolveDuplicatorCreator(
  mutationUserId: string,
  duplicatorNickname?: string | null,
): Promise<{ nickname: string } | null> {
  const fromInput = duplicatorNickname?.trim()
  if (fromInput) return { nickname: fromInput }
  const profile = await db.profiles.get(mutationUserId)
  const fromDexie = profile?.nickname?.trim()
  if (fromDexie) return { nickname: fromDexie }
  return null
}

export async function duplicateListLocalFirst(input: DuplicateListLocalInput): Promise<DuplicateListLocalResult> {
  const { sourceListId, newName, label, mutationUserId, duplicatorNickname } = input
  const trimmedName = newName.trim()
  if (!trimmedName) {
    throw new DuplicateListError('List name is required', 'List name is required')
  }

  const sourceListRow = await db.lists.get(sourceListId)
  if (!sourceListRow || isTombstoned(sourceListRow.deleted_at)) {
    throw new DuplicateListError('Source list not found', DUPLICATE_OFFLINE_CACHE_MESSAGE)
  }

  const sourceMembership = await db.list_users
    .where('[list_id+user_id]')
    .equals([sourceListId, mutationUserId])
    .first()

  const detail = await loadListDetailFromDexie(mutationUserId, sourceListId)
  if (detail.items.length === 0) {
    throw new DuplicateListError('Source detail cache empty', DUPLICATE_OFFLINE_CACHE_MESSAGE)
  }
  if (detail.items.length > DUPLICATE_MAX_ITEMS) {
    throw new DuplicateListError(
      `Too many items (${detail.items.length})`,
      `This list has too many items to duplicate offline (max ${DUPLICATE_MAX_ITEMS}).`,
    )
  }

  const duplicateId = crypto.randomUUID()
  const now = isoNow()
  const sync = syncFieldsForLocalInsert({ client_created_at: now })
  const itemIdMap = new Map<string, string>()
  const memberIdMap = new Map<string, string>()

  const clonedItems: DbItemRow[] = []
  const bulkItemPayloads: Record<string, unknown>[] = []
  const bulkLines: string[] = []

  for (const src of detail.items) {
    const newItemId = crypto.randomUUID()
    itemIdMap.set(src.id, newItemId)
    const base: DbItemRow = {
      id: newItemId,
      list_id: duplicateId,
      text: src.text,
      comment: src.comment ?? null,
      archived: src.archived ?? false,
      archived_at: src.archived_at ?? null,
      sort_order: src.sort_order ?? null,
      category: src.category,
      ...syncFieldsForLocalInsert({
        client_created_at: src.client_created_at ?? now,
        server_created_at: src.server_created_at,
        deleted_at: src.deleted_at ?? null,
        version: src.version ?? 0,
        last_synced_at: src.last_synced_at ?? null,
      }),
      updated_at: now,
    }
    const normalized = normalizeServerSyncableFields(base as unknown as Record<string, unknown>)
    const row = { ...base, ...normalized } as DbItemRow
    clonedItems.push(row)
    bulkLines.push(row.text)
    bulkItemPayloads.push({ ...row })
  }

  const memberCreator = await resolveDuplicatorCreator(mutationUserId, duplicatorNickname)

  const clonedMembers: DbMemberRow[] = []
  const bulkMemberPayloads: Record<string, unknown>[] = []

  for (const src of detail.members) {
    const newMemberId = crypto.randomUUID()
    memberIdMap.set(src.id, newMemberId)
    const base: DbMemberRow = {
      id: newMemberId,
      list_id: duplicateId,
      name: src.name,
      created_by: mutationUserId,
      sort_order: src.sort_order ?? null,
      is_public: src.is_public ?? false,
      is_target: src.is_target ?? false,
      ...syncFieldsForLocalInsert({
        client_created_at: src.client_created_at ?? now,
        server_created_at: src.server_created_at,
        deleted_at: src.deleted_at ?? null,
        version: src.version ?? 0,
        last_synced_at: src.last_synced_at ?? null,
      }),
      updated_at: now,
      creator: memberCreator,
    }
    const normalized = normalizeServerSyncableFields(base as unknown as Record<string, unknown>)
    const row = { ...base, ...normalized, creator: memberCreator } as DbMemberRow
    clonedMembers.push(row)
    bulkMemberPayloads.push({
      id: row.id,
      list_id: row.list_id,
      name: row.name,
      created_by: row.created_by,
      sort_order: row.sort_order,
      is_public: row.is_public,
      is_target: row.is_target,
      client_created_at: row.client_created_at,
      server_created_at: row.server_created_at,
      deleted_at: row.deleted_at,
      version: row.version,
      last_synced_at: row.last_synced_at,
      updated_at: row.updated_at,
    })
  }

  const bulkStatePayloads: Record<string, unknown>[] = []
  const clonedImsRows: DbItemMemberStateRow[] = []

  for (const srcItem of detail.items) {
    const newItemId = itemIdMap.get(srcItem.id)!
    const states = srcItem.memberStates ?? {}
    for (const [oldMemberId, st] of Object.entries(states)) {
      const newMemberId = memberIdMap.get(oldMemberId)
      if (!newMemberId) continue
      const imsId = await stableItemMemberStateDexieId(newItemId, newMemberId)
      const row: DbItemMemberStateRow = {
        id: imsId,
        list_id: duplicateId,
        item_id: newItemId,
        member_id: newMemberId,
        quantity: st.quantity ?? 1,
        done: st.done ?? false,
        assigned: st.assigned ?? false,
        ...syncFieldsForLocalInsert({
          client_created_at: st.client_created_at ?? now,
          server_created_at: st.server_created_at,
          deleted_at: st.deleted_at ?? null,
          version: st.version ?? 0,
          last_synced_at: st.last_synced_at ?? null,
        }),
        updated_at: st.updated_at ?? now,
      }
      clonedImsRows.push(row)
      bulkStatePayloads.push({
        item_id: newItemId,
        member_id: newMemberId,
        quantity: row.quantity,
        done: row.done,
        assigned: row.assigned,
        client_created_at: row.client_created_at,
        server_created_at: row.server_created_at,
        deleted_at: row.deleted_at,
        version: row.version,
        last_synced_at: row.last_synced_at,
        updated_at: row.updated_at,
      })
    }
  }

  const existingMemberships = await db.list_users.where('user_id').equals(mutationUserId).toArray()
  const nextSortDup = nextListCatalogSortOrderFromMembershipRows(existingMemberships, duplicateId)
  const { active: activeItemCount, archived: archivedItemCount } = countItemBuckets(clonedItems)
  const labelValue = label ?? sourceMembership?.label ?? ''

  const listBase: DbListRow = {
    ...(sourceListRow as ListWithRole),
    id: duplicateId,
    name: trimmedName,
    owner_id: mutationUserId,
    visibility: 'private',
    archived: false,
    join_token: null,
    join_expires_at: null,
    join_revoked_at: null,
    join_use_count: 0,
    category_names: sourceListRow.category_names ?? null,
    category_order: sourceListRow.category_order ?? null,
    comment: sourceListRow.comment ?? null,
    ...sync,
    updated_at: now,
    last_content_update: now,
    cached_at: Date.now(),
    app_version: APP_VERSION,
  }

  const listUserId = crypto.randomUUID()
  const listUserRow: DbListUserRow = {
    id: listUserId,
    list_id: duplicateId,
    user_id: mutationUserId,
    role: 'owner',
    archived: false,
    sort_order: nextSortDup,
    ...syncFieldsForLocalInsert(),
    member_filter: sourceMembership?.member_filter ?? 'all',
    item_text_width: sourceMembership?.item_text_width ?? 'auto',
    label: labelValue,
    last_viewed_members: sourceMembership?.last_viewed_members ?? null,
    last_viewed: now,
    show_targets: sourceMembership?.show_targets ?? clonedMembers.some((m) => m.is_target),
    item_name_font_step: sourceMembership?.item_name_font_step ?? 3,
    sum_scope: sourceMembership?.sum_scope ?? 'none',
    sync_error: false,
  }

  const queueBaseTs = Date.now()
  const defaultCategory = clonedItems[0]?.category ?? 1

  await db.transaction(
    'rw',
    [db.lists, db.list_users, db.items, db.members, db.item_member_state, db.sync_queue],
    async () => {
      await db.lists.put(listBase)
      await db.list_users.put(listUserRow)
      await db.items.bulkPut(clonedItems)
      if (clonedMembers.length > 0) await db.members.bulkPut(clonedMembers)
      if (clonedImsRows.length > 0) await db.item_member_state.bulkPut(clonedImsRows)

      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: duplicateId,
        kind: 'create',
        payload: {
          id: duplicateId,
          name: trimmedName,
          label: labelValue,
          client_created_at: sync.client_created_at,
          category_names: listBase.category_names,
          category_order: listBase.category_order,
          comment: listBase.comment,
          member_filter: listUserRow.member_filter,
          item_text_width: listUserRow.item_text_width,
          item_name_font_step: listUserRow.item_name_font_step,
          sum_scope: listUserRow.sum_scope,
          show_targets: listUserRow.show_targets,
        },
        ...listQueueParent(duplicateId),
        status: 'queued',
        updated_at: queueBaseTs,
      })

      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: crypto.randomUUID(),
        kind: 'rpc',
        payload: {
          method: 'bulkAddListItems',
          list_id: duplicateId,
          category: defaultCategory,
          lines: bulkLines,
          items: bulkItemPayloads,
        },
        ...listQueueParent(duplicateId),
        status: 'queued',
        updated_at: queueBaseTs + 1,
      })

      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: crypto.randomUUID(),
        kind: 'rpc',
        payload: {
          method: 'bulkAddStates',
          list_id: duplicateId,
          members: bulkMemberPayloads,
          states: bulkStatePayloads,
        },
        ...listQueueParent(duplicateId),
        status: 'queued',
        updated_at: queueBaseTs + 2,
      })
    },
  )

  const optimisticList: ListWithRole = {
    id: duplicateId,
    name: trimmedName,
    owner_id: mutationUserId,
    visibility: 'private',
    archived: false,
    comment: listBase.comment,
    category_names: listBase.category_names,
    category_order: listBase.category_order,
    join_token: null,
    join_role_granted: 'editor',
    join_expires_at: null,
    join_revoked_at: null,
    join_use_count: 0,
    ...sync,
    updated_at: now,
    last_content_update: now,
    role: 'owner',
    userArchived: false,
    memberCount: clonedMembers.length,
    activeItemCount,
    archivedItemCount,
    sumScope:
      listUserRow.sum_scope === 'all' ||
      listUserRow.sum_scope === 'active' ||
      listUserRow.sum_scope === 'archived'
        ? listUserRow.sum_scope
        : 'none',
    label: labelValue,
    last_viewed: now,
    sort_order: nextSortDup,
  }

  return { duplicateId, optimisticList }
}

/** Build ItemWithState[] for optional in-memory hydration (e.g. tests). */
export function buildClonedItemsWithStates(
  clonedItems: DbItemRow[],
  clonedImsRows: DbItemMemberStateRow[],
): ItemWithState[] {
  const byItem = new Map<string, Record<string, DbItemMemberStateRow>>()
  for (const s of clonedImsRows) {
    const cur = byItem.get(s.item_id) ?? {}
    cur[s.member_id] = s
    byItem.set(s.item_id, cur)
  }
  return clonedItems.map((item) => ({
    ...item,
    memberStates: (byItem.get(item.id) ?? {}) as ItemWithState['memberStates'],
  }))
}

export function buildClonedMembersForUi(clonedMembers: DbMemberRow[]): MemberWithCreator[] {
  return clonedMembers.map((m) => ({ ...m, creator: m.creator ?? null }))
}
