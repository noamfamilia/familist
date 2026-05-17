import { db, type DbSyncQueueRow } from '@/lib/db'
import { formatQuotedListName } from '@/lib/serverActionLog'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'

async function listDisplayName(listId: string | null): Promise<string> {
  if (!listId || listId.startsWith('user:')) return listId ?? 'this list'
  const row = await db.lists.get(listId)
  return formatQuotedListName(row?.name, listId)
}

/** Shown as soon as the worker claims a row (before the main network call). */
export async function initialOutboundProgressMessage(row: DbSyncQueueRow): Promise<string> {
  const primary = listIdsTouchingOutboundRow(row)[0] ?? null
  const pl = row.payload as Record<string, unknown>
  const method = typeof pl.method === 'string' ? pl.method : ''

  if (row.kind === 'delete') {
    const lt = primary ? await listDisplayName(primary) : 'this list'
    if (row.entity === 'item') return `Sending “delete this item” to the server for list ${lt}…`
    if (row.entity === 'member') return `Sending “remove this member” to the server for list ${lt}…`
    if (row.entity === 'list') return `Sending “delete this list” to the server (${lt})…`
    if (row.entity === 'item_member_state') return `Sending “clear checkoff for this item” to the server on list ${lt}…`
    return `Sending a delete to the server…`
  }

  if (row.kind === 'create' && row.entity === 'item') {
    const lid = String(pl.list_id ?? primary ?? '')
    return `Sending new item to the server on list ${await listDisplayName(lid || null)}…`
  }
  if (row.kind === 'create' && row.entity === 'list') {
    return 'Sending new list to the server…'
  }
  if (row.kind === 'create' && row.entity === 'member') {
    const lid = String(pl.list_id ?? primary ?? '')
    return `Sending new member to the server on list ${await listDisplayName(lid || null)}…`
  }
  if (row.kind === 'create' && row.entity === 'feedback') {
    return 'Sending your feedback to the server…'
  }

  if (row.kind === 'patch' && row.entity === 'item') {
    const lid = primary ?? String(pl.list_id ?? '')
    return `Sending item edits to the server on list ${await listDisplayName(lid || null)}…`
  }
  if (row.kind === 'patch' && row.entity === 'list') {
    const id = String(pl.id ?? row.entity_id ?? primary ?? '')
    return `Sending list changes to the server for ${await listDisplayName(id || null)}…`
  }
  if (row.kind === 'patch' && row.entity === 'member') {
    return `Sending member changes to the server on list ${await listDisplayName(primary)}…`
  }
  if (row.kind === 'patch' && row.entity === 'item_member_state') {
    const lid = primary ?? String(pl.list_id ?? '')
    return `Sending checkmarks, quantities, or assignments to the server on list ${await listDisplayName(lid || null)}…`
  }
  if (row.kind === 'patch' && row.entity === 'profile') {
    if (pl.label_filter !== undefined) return 'Sending label filter preference to the server…'
    if (pl.theme !== undefined) return 'Sending theme preference to the server…'
    if (pl.nickname !== undefined) return 'Sending profile nickname to the server…'
    return 'Sending profile settings to the server…'
  }

  if (row.kind === 'rpc' && method) {
    const lid = primary ?? String(pl.list_id ?? '')
    const lt = lid ? await listDisplayName(lid) : 'your lists'
    const map: Record<string, string> = {
      reorderListItems: `Sending a “reorder items” request to the server for list ${lt}…`,
      bulkAddListItems: `Sending a “bulk add items” request to the server for list ${lt}…`,
      patchListUser: `Sending list preferences to the server for ${lt}…`,
      reorderListUsers: 'Sending a “reorder lists on home” request to the server…',
      bulkPatchListLabels: 'Sending a batch label update to the server…',
      joinListByToken: 'Sending “join list” to the server…',
      leaveList: `Sending “leave list” to the server for ${lt}…`,
      bulkAddStates: `Sending members and shopping progress to the server for list ${lt}…`,
      ownMember: 'Sending “claim member slot” to the server…',
      importList: 'Sending “import list” to the server…',
      generateShareToken: `Sending “create share link” to the server for ${lt}…`,
      revokeShareToken: `Sending “revoke share link” to the server for ${lt}…`,
      removeUsersFromList: `Sending “remove people from list” to the server for ${lt}…`,
      deleteArchivedItems: `Sending “delete archived items” to the server for list ${lt}…`,
      restoreArchivedItems: `Sending “restore archived items” to the server for list ${lt}…`,
      seedItemMemberStateForMember: `Sending “seed item progress for new member” to the server for list ${lt}…`,
    }
    return map[method] ?? `Sending server request (${method})…`
  }

  return 'Sending this change to the server…'
}

/** Post-mutation: `get_user_lists` RPC — request is in flight. */
export function outboundProgressCatalogWaiting(): string {
  return 'List catalog (get_user_lists): sent — waiting for server…'
}

/** Post-mutation: catalog RPC finished and Dexie was updated. */
export function outboundProgressCatalogReceived(): string {
  return 'List catalog (get_user_lists): received — saved locally.'
}

/** Post-mutation: `get_list_data` RPC — request is in flight. */
export async function outboundProgressListDetailWaiting(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `List data (get_list_data) for ${name}: sent — waiting for server…`
}

/** Post-mutation: list detail RPC finished and Dexie was updated. */
export async function outboundProgressListDetailReceived(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `List data (get_list_data) for ${name}: received — saved locally.`
}

/** Saving per-user list prefs row (`list_users` update) — in flight. */
export async function outboundProgressListUsersPatchWaiting(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `List preferences (list_users update for ${name}): sent — waiting for server…`
}

export async function outboundProgressListUsersPatchReceived(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `List preferences (list_users update for ${name}): received.`
}

/** `touch_list_viewed` RPC — in flight. */
export async function outboundProgressTouchListViewedWaiting(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `Last viewed (touch_list_viewed for ${name}): sent — waiting for server…`
}

export async function outboundProgressTouchListViewedReceived(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `Last viewed (touch_list_viewed for ${name}): received.`
}
