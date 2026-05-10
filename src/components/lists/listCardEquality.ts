import type { ListWithRole } from '@/lib/supabase/types'

export function sameStringList(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false
  }
  return true
}

/** Fields that affect ListCard / SortableListCard rendered catalog data (not callbacks / drag refs). */
export function listCardModelEqual(a: ListWithRole, b: ListWithRole): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    (a.label || '') === (b.label || '') &&
    a.role === b.role &&
    a.userArchived === b.userArchived &&
    (a.sort_order ?? null) === (b.sort_order ?? null) &&
    a.archived === b.archived &&
    (a.comment ?? '') === (b.comment ?? '') &&
    a.visibility === b.visibility &&
    (a.ownerNickname ?? null) === (b.ownerNickname ?? null) &&
    (a.pending_items ?? 0) === (b.pending_items ?? 0) &&
    a.sync_error === b.sync_error &&
    (a.memberCount ?? 0) === (b.memberCount ?? 0) &&
    (a.activeItemCount ?? 0) === (b.activeItemCount ?? 0) &&
    (a.archivedItemCount ?? 0) === (b.archivedItemCount ?? 0) &&
    (a.sumScope ?? 'none') === (b.sumScope ?? 'none') &&
    String(a.updated_at ?? '') === String(b.updated_at ?? '') &&
    String(a.server_created_at ?? '') === String(b.server_created_at ?? '') &&
    String(a.client_created_at ?? '') === String(b.client_created_at ?? '') &&
    (a.category_names ?? null) === (b.category_names ?? null) &&
    (a.category_order ?? null) === (b.category_order ?? null)
  )
}
