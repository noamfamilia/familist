import { db } from '@/lib/db'
import { loadListDetailFromDexie } from '@/lib/data/queries'
import { normalizeItemCategory } from '@/lib/supabase/types'
import type { ItemWithState, List, MemberWithCreator } from '@/lib/supabase/types'

const RS = '\u001e'

function listComparableSnapshot(list: List): string {
  return [
    list.name,
    list.archived ? '1' : '0',
    list.comment ?? '',
    list.visibility,
    JSON.stringify(list.category_names ?? null),
    JSON.stringify(list.category_order ?? null),
    String(list.version ?? 1),
    list.updated_at,
  ].join(RS)
}

function memberStateFingerprint(memberStates: ItemWithState['memberStates'] | undefined): string {
  const o = memberStates ?? {}
  return Object.keys(o)
    .sort()
    .map((mid) => {
      const r = o[mid]
      if (!r) return `${mid}:~`
      return `${mid}:${r.version}|${r.quantity}|${r.done ? 1 : 0}|${r.assigned ? 1 : 0}|${r.updated_at}`
    })
    .join(';')
}

function itemComparableSnapshot(i: ItemWithState): string {
  return [
    i.id,
    String(i.version ?? 0),
    i.updated_at,
    String(i.sort_order ?? ''),
    i.archived ? '1' : '0',
    String(normalizeItemCategory(i.category)),
    i.text,
    i.comment ?? '',
    memberStateFingerprint(i.memberStates),
  ].join(RS)
}

function memberComparableSnapshot(m: MemberWithCreator): string {
  return [
    m.id,
    String(m.version ?? 0),
    m.updated_at,
    m.name,
    String(m.sort_order ?? ''),
    m.is_public ? '1' : '0',
    m.is_target ? '1' : '0',
  ].join(RS)
}

/**
 * True when server `get_list_data` payload disagrees with current Dexie mirror for this list.
 * Extra rows present only in Dexie (e.g. optimistic pending creates) are ignored; any server
 * row missing or differing from Dexie counts as a diff.
 */
export async function serverListDetailDiffersFromDexie(
  userId: string,
  listId: string,
  server: { list: List; items: ItemWithState[]; members: MemberWithCreator[] },
): Promise<boolean> {
  const dexieList = await db.lists.get(listId)
  const dexieDetail = await loadListDetailFromDexie(userId, listId)

  if (!dexieList) {
    return true
  }

  if (listComparableSnapshot(dexieList as List) !== listComparableSnapshot(server.list)) {
    return true
  }

  const dexItems = new Map(dexieDetail.items.map((i) => [i.id, i]))
  for (const s of server.items) {
    const d = dexItems.get(s.id)
    if (!d) return true
    if (itemComparableSnapshot(d) !== itemComparableSnapshot(s)) return true
  }

  const dexMembers = new Map(dexieDetail.members.map((m) => [m.id, m]))
  for (const s of server.members) {
    const d = dexMembers.get(s.id)
    if (!d) return true
    if (memberComparableSnapshot(d) !== memberComparableSnapshot(s)) return true
  }

  const srvItemIds = new Set(server.items.map((i) => i.id))
  for (const d of dexieDetail.items) {
    if (!srvItemIds.has(d.id)) return true
  }
  const srvMemberIds = new Set(server.members.map((m) => m.id))
  for (const d of dexieDetail.members) {
    if (!srvMemberIds.has(d.id)) return true
  }

  return false
}
