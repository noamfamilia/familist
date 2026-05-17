import { APP_VERSION } from '@/lib/appVersion'
import {
  db,
  type DbItemMemberStateRow,
  type DbItemRow,
  type DbListRow,
  type DbListUserRow,
  type DbMemberRow,
} from '@/lib/db'
import { syncFieldsForLocalInsert, isoNow } from '@/lib/data/base_sync_fields'
import { normalizeServerSyncableFields } from '@/lib/data/serverDexieParity'
import { DUPLICATE_MAX_ITEMS } from '@/lib/data/duplicateListLocal'
import {
  enqueueSyncQueueRecord,
  listQueueParent,
  stableItemMemberStateDexieId,
} from '@/lib/data/syncQueue'
import { nextListCatalogSortOrderFromMembershipRows } from '@/lib/data/listCatalogSort'
import type { ListWithRole } from '@/lib/supabase/types'
import type { SheetImportItemRow } from '@/lib/sheetImport/parseSheetCsv'

export class ImportListError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message)
    this.name = 'ImportListError'
  }
}

export type ImportListLocalInput = {
  name: string
  label?: string
  categoryNamesJson?: string
  rows: SheetImportItemRow[]
  hasTargets: boolean
  mutationUserId: string
}

export type ImportListLocalResult = {
  importedId: string
  optimisticList: ListWithRole
}

export async function importListLocalFirst(input: ImportListLocalInput): Promise<ImportListLocalResult> {
  const { name, label, categoryNamesJson, rows, hasTargets, mutationUserId } = input
  const trimmedName = name.trim()
  if (!trimmedName) {
    throw new ImportListError('List name is required', 'List name is required')
  }
  if (rows.length === 0) {
    throw new ImportListError('No items to import', 'No items found to import.')
  }
  if (rows.length > DUPLICATE_MAX_ITEMS) {
    throw new ImportListError(
      `Too many items (${rows.length})`,
      `This import has too many items (max ${DUPLICATE_MAX_ITEMS}). Split the sheet or remove rows.`,
    )
  }

  const importedId = crypto.randomUUID()
  const now = isoNow()
  const sync = syncFieldsForLocalInsert({ client_created_at: now })
  const labelValue = label?.trim() ?? ''

  const clonedItems: DbItemRow[] = []
  const bulkItemPayloads: Record<string, unknown>[] = []
  const bulkLines: string[] = []
  const defaultCategory = rows[0]?.category ?? 1

  for (let i = 0; i < rows.length; i++) {
    const src = rows[i]!
    const itemId = crypto.randomUUID()
    const base: DbItemRow = {
      id: itemId,
      list_id: importedId,
      text: src.text,
      comment: src.comment ?? null,
      archived: false,
      archived_at: null,
      sort_order: src.sort_order ?? null,
      category: src.category,
      ...syncFieldsForLocalInsert({ client_created_at: now }),
      updated_at: now,
    }
    const normalized = normalizeServerSyncableFields(base as unknown as Record<string, unknown>)
    const row = { ...base, ...normalized } as DbItemRow
    clonedItems.push(row)
    bulkLines.push(row.text)
    bulkItemPayloads.push({ ...row })
  }

  const clonedMembers: DbMemberRow[] = []
  const bulkMemberPayloads: Record<string, unknown>[] = []
  const bulkStatePayloads: Record<string, unknown>[] = []
  const clonedImsRows: DbItemMemberStateRow[] = []

  let targetMemberId: string | null = null
  if (hasTargets) {
    targetMemberId = crypto.randomUUID()
    const targetMember: DbMemberRow = {
      id: targetMemberId,
      list_id: importedId,
      name: 'Qty',
      created_by: mutationUserId,
      sort_order: 0,
      is_public: false,
      is_target: true,
      ...syncFieldsForLocalInsert({ client_created_at: now }),
      updated_at: now,
    }
    const normalizedMember = normalizeServerSyncableFields(
      targetMember as unknown as Record<string, unknown>,
    )
    const memberRow = { ...targetMember, ...normalizedMember } as DbMemberRow
    clonedMembers.push(memberRow)
    bulkMemberPayloads.push({
      id: memberRow.id,
      list_id: memberRow.list_id,
      name: memberRow.name,
      created_by: memberRow.created_by,
      sort_order: memberRow.sort_order,
      is_public: memberRow.is_public,
      is_target: memberRow.is_target,
      client_created_at: memberRow.client_created_at,
      server_created_at: memberRow.server_created_at,
      deleted_at: memberRow.deleted_at,
      version: memberRow.version,
      last_synced_at: memberRow.last_synced_at,
      updated_at: memberRow.updated_at,
    })

    for (let i = 0; i < clonedItems.length; i++) {
      const item = clonedItems[i]!
      const rawQty = rows[i]?.target
      const quantity = typeof rawQty === 'number' && rawQty >= 1 ? rawQty : 1
      const imsId = await stableItemMemberStateDexieId(item.id, targetMemberId)
      const imsRow: DbItemMemberStateRow = {
        id: imsId,
        list_id: importedId,
        item_id: item.id,
        member_id: targetMemberId,
        quantity,
        done: false,
        assigned: true,
        ...syncFieldsForLocalInsert({ client_created_at: now }),
        updated_at: now,
      }
      clonedImsRows.push(imsRow)
      bulkStatePayloads.push({
        item_id: item.id,
        member_id: targetMemberId,
        quantity: imsRow.quantity,
        done: imsRow.done,
        assigned: imsRow.assigned,
        client_created_at: imsRow.client_created_at,
        server_created_at: imsRow.server_created_at,
        deleted_at: imsRow.deleted_at,
        version: imsRow.version,
        last_synced_at: imsRow.last_synced_at,
        updated_at: imsRow.updated_at,
      })
    }
  }

  const existingMemberships = await db.list_users.where('user_id').equals(mutationUserId).toArray()
  const nextSort = nextListCatalogSortOrderFromMembershipRows(existingMemberships, importedId)

  const listBase: DbListRow = {
    id: importedId,
    name: trimmedName,
    owner_id: mutationUserId,
    visibility: 'private',
    archived: false,
    join_token: null,
    join_expires_at: null,
    join_revoked_at: null,
    join_use_count: 0,
    category_names: categoryNamesJson ?? null,
    category_order: null,
    comment: null,
    ...sync,
    updated_at: now,
    last_content_update: now,
    cached_at: Date.now(),
    app_version: APP_VERSION,
  }

  const listUserRow: DbListUserRow = {
    id: crypto.randomUUID(),
    list_id: importedId,
    user_id: mutationUserId,
    role: 'owner',
    archived: false,
    archived_at: null,
    sort_order: nextSort,
    ...syncFieldsForLocalInsert(),
    member_filter: 'all',
    item_text_width: 'auto',
    label: labelValue,
    last_viewed_members: null,
    last_viewed: now,
    show_targets: hasTargets,
    item_name_font_step: 3,
    sum_scope: 'none',
    sync_error: false,
  }

  const queueBaseTs = Date.now()

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
        entity_id: importedId,
        kind: 'create',
        payload: {
          id: importedId,
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
        ...listQueueParent(importedId),
        status: 'queued',
        updated_at: queueBaseTs,
      })

      await enqueueSyncQueueRecord({
        entity: 'list',
        entity_id: crypto.randomUUID(),
        kind: 'rpc',
        payload: {
          method: 'bulkAddListItems',
          list_id: importedId,
          category: defaultCategory,
          lines: bulkLines,
          items: bulkItemPayloads,
        },
        ...listQueueParent(importedId),
        status: 'queued',
        updated_at: queueBaseTs + 1,
      })

      if (hasTargets && bulkStatePayloads.length > 0) {
        await enqueueSyncQueueRecord({
          entity: 'list',
          entity_id: crypto.randomUUID(),
          kind: 'rpc',
          payload: {
            method: 'bulkAddStates',
            list_id: importedId,
            members: bulkMemberPayloads,
            states: bulkStatePayloads,
          },
          ...listQueueParent(importedId),
          status: 'queued',
          updated_at: queueBaseTs + 2,
        })
      }
    },
  )

  const optimisticList: ListWithRole = {
    id: importedId,
    name: trimmedName,
    owner_id: mutationUserId,
    visibility: 'private',
    archived: false,
    comment: null,
    category_names: categoryNamesJson ?? null,
    category_order: null,
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
    userArchivedAt: null,
    memberCount: hasTargets ? 1 : 0,
    activeItemCount: clonedItems.length,
    archivedItemCount: 0,
    sumScope: 'none',
    label: labelValue,
    last_viewed: now,
    sort_order: nextSort,
  }

  return { importedId, optimisticList }
}
