import { APP_VERSION } from '@/lib/appVersion'
import { db } from '@/lib/db'
import { appendMutationDiagnostic } from '@/lib/offlineNavDiagnostics'
import type { Database, ItemWithState, List, ListWithRole, MemberWithCreator, Profile } from '@/lib/supabase/types'

export const PARITY_SCOPE = {
  get_user_lists: ['lists', 'list_users', 'listSummaries'],
  get_list_data_list: ['lists'],
  get_list_data_items: ['items'],
  get_list_data_member_states: ['item_member_state'],
  get_list_data_members: ['members'],
  list_users_prefs: ['list_users'],
  get_list_joined_users: ['joinedUsers'],
  lists_join_token: ['listShareTokens'],
  profiles_row: ['profiles'],
} as const

const PARITY_SCOPED_TABLES = [
  'lists',
  'items',
  'item_member_state',
  'members',
  'list_users',
  'listSummaries',
  'joinedUsers',
  'listShareTokens',
  'profiles',
] as const

function normalizeListUserSumScope(raw: unknown): 'none' | 'all' | 'active' | 'archived' {
  if (raw === 'none' || raw === 'all' || raw === 'active' || raw === 'archived') return raw
  return 'none'
}

type ListUserPrefsServerRow = {
  member_filter?: string | null
  item_text_width?: string | number | null
  item_name_font_step?: number | null
  last_viewed_members?: string | null
  sum_scope?: unknown
}

export async function upsertListsSummaryFromServer(userId: string, rows: ListWithRole[]) {
  const now = Date.now()
  await db.transaction('rw', db.lists, db.list_users, db.listSummaries, async () => {
    const incomingIds = new Set(rows.map((row) => row.id))
    for (const row of rows) {
      const {
        role,
        userArchived,
        sort_order,
        sumScope,
        label,
        memberCount,
        activeItemCount,
        archivedItemCount,
        ownerNickname,
        ...listFields
      } = row
      await db.lists.put({
        ...listFields,
        userId,
        cachedAt: now,
        deleted_at: null,
        app_version: APP_VERSION,
      })
      const existingListUser = await db.list_users.get([row.id, userId])
      await db.list_users.put({
        list_id: row.id,
        user_id: userId,
        role,
        archived: userArchived,
        sort_order,
        created_at: existingListUser?.created_at ?? new Date().toISOString(),
        member_filter: existingListUser?.member_filter ?? 'all',
        item_text_width: existingListUser?.item_text_width ?? 'auto',
        item_name_font_step: existingListUser?.item_name_font_step ?? 3,
        show_targets: existingListUser?.show_targets ?? false,
        last_viewed_members: existingListUser?.last_viewed_members ?? null,
        sum_scope: sumScope ?? 'none',
        label: label ?? '',
      })
      await db.listSummaries.put({
        userId,
        listId: row.id,
        memberCount: memberCount ?? 0,
        activeItemCount: activeItemCount ?? 0,
        archivedItemCount: archivedItemCount ?? 0,
        ownerNickname: ownerNickname ?? null,
        cachedAt: now,
      })
    }
    const existing = await db.lists.where('userId').equals(userId).toArray()
    for (const row of existing) {
      if (!incomingIds.has(row.id)) {
        await db.lists.update([userId, row.id], {
          deleted_at: now,
          cachedAt: now,
        })
        await db.list_users.delete([row.id, userId])
        await db.listSummaries.delete([userId, row.id])
      }
    }
  })
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
  const now = Date.now()
  await db.transaction('rw', db.lists, db.items, db.members, db.item_member_state, async () => {
    if (payload.list) {
      await db.lists.put({
        ...payload.list,
        userId,
        cachedAt: now,
        deleted_at: null,
        app_version: APP_VERSION,
      })
    }
    for (const item of payload.items) {
      await db.items.put({
        ...item,
        userId,
        listId,
        deleted_at: null,
      })
      for (const memberState of Object.values(item.memberStates ?? {})) {
        await db.item_member_state.put({
          ...memberState,
          listId,
          deleted_at: null,
        })
      }
    }
    for (const member of payload.members) {
      await db.members.put({
        ...member,
        userId,
        listId,
        deleted_at: null,
      })
    }
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
  const existing = await db.list_users.get([listId, userId])
  await db.list_users.put({
    list_id: listId,
    user_id: userId,
    role: existing?.role ?? 'viewer',
    archived: existing?.archived ?? false,
    sort_order: existing?.sort_order ?? null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    member_filter: row.member_filter ?? existing?.member_filter ?? 'all',
    item_text_width: itemTextWidth,
    label: existing?.label ?? '',
    last_viewed_members: row.last_viewed_members ?? null,
    show_targets: existing?.show_targets ?? false,
    item_name_font_step: row.item_name_font_step ?? existing?.item_name_font_step ?? 3,
    sum_scope: normalizeListUserSumScope(row.sum_scope),
  })
}

export async function readListPrefsFromDexie(userId: string, listId: string) {
  return db.list_users.get([listId, userId])
}

type JoinedUserServerRow = Database['public']['Functions']['get_list_joined_users']['Returns'][number]
export async function upsertJoinedUsersFromServer(listId: string, rows: JoinedUserServerRow[]) {
  const now = Date.now()
  await db.transaction('rw', db.joinedUsers, async () => {
    const nextIds = new Set(rows.map((r) => r.user_id))
    const existing = await db.joinedUsers.where('listId').equals(listId).toArray()
    for (const row of rows) {
      await db.joinedUsers.put({
        listId,
        userId: row.user_id,
        nickname: row.nickname ?? null,
        memberCount: row.member_count ?? 0,
        cachedAt: now,
      })
    }
    for (const row of existing) {
      if (!nextIds.has(row.userId)) {
        await db.joinedUsers.delete([listId, row.userId])
      }
    }
  })
}

export async function upsertListShareTokenFromServer(listId: string, token: string | null) {
  await db.listShareTokens.put({
    listId,
    joinToken: token,
    cachedAt: Date.now(),
  })
}

export async function upsertProfileFromServer(row: Profile) {
  await db.profiles.put({
    ...row,
    cachedAt: Date.now(),
  })
}

let parityDiagnosticsReported = false
export function reportServerDexieParityDiagnostics() {
  if (parityDiagnosticsReported) return
  parityDiagnosticsReported = true

  const mappedServerKeys = Object.keys(PARITY_SCOPE).length
  const mappedTables = new Set(Object.values(PARITY_SCOPE).flat())
  const missingDexieMirror = Object.entries(PARITY_SCOPE)
    .filter(([, tables]) => tables.length === 0)
    .map(([serverKey]) => serverKey)
  const orphanDexieTable = PARITY_SCOPED_TABLES.filter((tableName) => !mappedTables.has(tableName))

  appendMutationDiagnostic(
    `[parity] mappedServerObjects=${mappedServerKeys} mappedDexieTables=${mappedTables.size} missingDexieMirror=${missingDexieMirror.length} orphanDexieTable=${orphanDexieTable.length}`,
  )
  if (missingDexieMirror.length > 0) {
    appendMutationDiagnostic(`[parity] missingDexieMirror keys=${missingDexieMirror.join(',')}`)
  }
  if (orphanDexieTable.length > 0) {
    appendMutationDiagnostic(`[parity] orphanDexieTable names=${orphanDexieTable.join(',')}`)
  }
}
