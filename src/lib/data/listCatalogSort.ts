import type { ListWithRole } from '@/lib/supabase/types'

/**
 * Home list cards (`list_users.sort_order`): **larger** values render nearer the **top**.
 * `null` / non-finite values sort **last** (bottom). Tie-break: newer `server_created_at` / `client_created_at` first.
 */
export function compareListsCatalogSortOrder(a: ListWithRole, b: ListWithRole): number {
  const aOrd = finiteListCatalogSortOrder(a.sort_order)
  const bOrd = finiteListCatalogSortOrder(b.sort_order)
  if (bOrd !== aOrd) return bOrd - aOrd
  const aT = a.server_created_at || a.client_created_at || ''
  const bT = b.server_created_at || b.client_created_at || ''
  return bT.localeCompare(aT)
}

function finiteListCatalogSortOrder(sortOrder: number | null | undefined): number {
  if (typeof sortOrder === 'number' && Number.isFinite(sortOrder)) return sortOrder
  return Number.NEGATIVE_INFINITY
}

/** Next `sort_order` when placing a list at the **top** of the home stack (max existing + 1). */
export function nextListCatalogSortOrderFromLists(lists: readonly ListWithRole[]): number {
  let max = -1
  for (const l of lists) {
    const so = l.sort_order
    if (typeof so === 'number' && Number.isFinite(so)) max = Math.max(max, so)
  }
  return max + 1
}

export function nextListCatalogSortOrderFromMembershipRows(
  rows: readonly { sort_order?: number | null; list_id: string }[],
  excludeListId?: string,
): number {
  let max = -1
  for (const r of rows) {
    if (excludeListId && r.list_id === excludeListId) continue
    const so = r.sort_order
    if (typeof so === 'number' && Number.isFinite(so)) max = Math.max(max, so)
  }
  return max + 1
}

/** `orderedLists[0]` is the top card; persists dense `sort_order` from `(count - 1)` down to `0`. */
export function listCatalogSortOrderForVisualIndex(visualIndex: number, listCount: number): number {
  return listCount - 1 - visualIndex
}
