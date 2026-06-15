import { isTombstoned } from '@/lib/data/base_sync_fields'
import { db } from '@/lib/db'
import type { Item } from '@/lib/supabase/types'

type ListItemLike = Pick<Item, 'text' | 'archived' | 'archived_at' | 'sort_order' | 'deleted_at'>

/** Active items by sort_order, then archived by archived_at desc — matches list UI order. */
export function formatListItemNamesForClipboard(items: ListItemLike[]): string {
  const live = items.filter(i => !isTombstoned(i.deleted_at ?? null))
  const active = [...live]
    .filter(i => !i.archived)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const archived = [...live]
    .filter(i => i.archived)
    .sort((a, b) => {
      const aTime = a.archived_at ? new Date(a.archived_at).getTime() : 0
      const bTime = b.archived_at ? new Date(b.archived_at).getTime() : 0
      return bTime - aTime
    })
  return [...active, ...archived]
    .map(i => i.text.trim())
    .filter(t => t.length > 0)
    .join('\n')
}

export async function listItemClipboardTextFromDexie(listId: string): Promise<string> {
  const rows = await db.items
    .where('list_id')
    .equals(listId)
    .filter(it => !isTombstoned(it.deleted_at ?? null))
    .toArray()
  return formatListItemNamesForClipboard(rows)
}
