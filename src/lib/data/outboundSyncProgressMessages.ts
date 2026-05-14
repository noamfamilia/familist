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
      duplicateList: `Sending “duplicate list” to the server (${lt})…`,
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

/** After the main mutation/RPC succeeded; before refreshing list catalog from server. */
export function outboundProgressAfterMutationOverview(): string {
  return 'Server approved your change. Sent another request to refresh your list overview, and waiting for the server to respond.'
}

/** After overview refresh; before fetching full list detail (when applicable). */
export async function outboundProgressAfterMutationListDetail(listId: string): Promise<string> {
  const name = await listDisplayName(listId)
  return `Server approved your change. Sent another request to load updated details for list ${name}, and waiting for the server to respond.`
}
