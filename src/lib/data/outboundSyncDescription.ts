import { db, type DbSyncQueueRow } from '@/lib/db'
import { formatQuotedListName } from '@/lib/serverActionLog'
import { listIdsTouchingOutboundRow } from '@/lib/data/syncQueueListScope'

function primaryListId(row: DbSyncQueueRow): string | null {
  const ids = listIdsTouchingOutboundRow(row)
  return ids[0] ?? null
}

async function listTitle(listId: string | null): Promise<string> {
  if (!listId || listId.startsWith('user:')) return listId ?? '(unknown)'
  const row = await db.lists.get(listId)
  return formatQuotedListName(row?.name, listId)
}

/**
 * Short human description for an outbound sync_queue row (for `[server]` save lines).
 */
export async function describeOutboundSyncRow(row: DbSyncQueueRow): Promise<string> {
  const primary = primaryListId(row)
  const pl = row.payload as Record<string, unknown>
  const method = typeof pl.method === 'string' ? pl.method : ''

  if (row.kind === 'delete') {
    const lt = primary ? await listTitle(primary) : '(unknown list)'
    if (row.entity === 'item') return `Delete item on list ${lt}`
    if (row.entity === 'member') return `Delete member on list ${lt}`
    if (row.entity === 'list') return `Delete list ${lt}`
    if (row.entity === 'item_member_state') return `Clear item checkoff on list ${lt}`
    return `Delete ${row.entity} on list ${lt}`
  }

  if (row.kind === 'create' && row.entity === 'item') {
    const lid = String(pl.list_id ?? primary ?? '')
    return `Create item on list ${await listTitle(lid)}`
  }
  if (row.kind === 'create' && row.entity === 'list') {
    const name = typeof pl.name === 'string' ? pl.name : ''
    return `Create list ${formatQuotedListName(name, String(pl.id ?? row.entity_id))}`
  }
  if (row.kind === 'create' && row.entity === 'member') {
    const lid = String(pl.list_id ?? primary ?? '')
    return `Add member on list ${await listTitle(lid)}`
  }
  if (row.kind === 'create' && row.entity === 'feedback') {
    return 'Send feedback'
  }

  if (row.kind === 'patch' && row.entity === 'item') {
    const lid = primary ?? String(pl.list_id ?? '')
    return `Update item on list ${await listTitle(lid)}`
  }
  if (row.kind === 'patch' && row.entity === 'list') {
    const id = String(pl.id ?? row.entity_id ?? primary ?? '')
    return `Update list ${await listTitle(id)}`
  }
  if (row.kind === 'patch' && row.entity === 'member') {
    const lid = primary ?? ''
    return `Update member on list ${await listTitle(lid)}`
  }
  if (row.kind === 'patch' && row.entity === 'item_member_state') {
    const lid = primary ?? String(pl.list_id ?? '')
    return `Save item state on list ${await listTitle(lid)}`
  }

  if (row.kind === 'rpc' && method) {
    const lid = primary ?? String(pl.list_id ?? '')
    const lt = lid ? await listTitle(lid) : 'lists'
    const map: Record<string, string> = {
      reorderListItems: `Reorder items on list ${lt}`,
      bulkAddListItems: `Bulk add items on list ${lt}`,
      patchListUser: `Update list preferences for ${lt}`,
      reorderListUsers: 'Reorder lists (home)',
      bulkPatchListLabels: 'Batch update list labels',
      joinListByToken: 'Join list by invite token',
      leaveList: `Leave list ${lt}`,
      bulkAddStates: `Copy members and progress for list ${lt}`,
      ownMember: 'Claim member slot',
      importList: `Import list ${formatQuotedListName(String(pl.p_name ?? ''), String(pl.imported_id ?? ''))}`,
      generateShareToken: `Generate share link for ${lt}`,
      revokeShareToken: `Revoke share link for ${lt}`,
      removeUsersFromList: `Remove users from list ${lt}`,
      deleteArchivedItems: `Delete archived items on list ${lt}`,
      restoreArchivedItems: `Restore archived items on list ${lt}`,
      seedItemMemberStateForMember: `Seed item progress for new member on list ${lt}`,
    }
    return map[method] ?? `RPC ${method}`
  }

  const ids = listIdsTouchingOutboundRow(row)
  if (ids.length > 0) return `${row.kind} ${row.entity} (${await listTitle(ids[0])})`
  return `${row.kind} ${row.entity}`
}
