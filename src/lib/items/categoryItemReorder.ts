import type { ItemWithState } from '@/lib/supabase/types'
import { normalizeItemCategory } from '@/lib/supabase/types'

/**
 * Active items get sorted by category; archived items stay at their exact positions in the full list.
 */
export function reorderByCategory(currentFull: ItemWithState[], sortedActive: ItemWithState[]): ItemWithState[] {
  const result = [...currentFull]
  let activeIdx = 0
  for (let i = 0; i < result.length; i++) {
    if (!result[i].archived) {
      result[i] = sortedActive[activeIdx++]
    }
  }
  return result
}

export function makeCategoryComparators(order: number[]) {
  const positionOf = (cat: number) => {
    const idx = order.indexOf(cat)
    return idx === -1 ? order.length : idx
  }

  const byCategory = (a: ItemWithState, b: ItemWithState) => {
    const ac = positionOf(normalizeItemCategory(a.category))
    const bc = positionOf(normalizeItemCategory(b.category))
    if (ac !== bc) return ac - bc
    return (a.sort_order || 0) - (b.sort_order || 0)
  }

  return { byCategory }
}

/** Full list order after applying category order to active rows only. */
export function computeItemsReorderedByCategory(items: ItemWithState[], categoryOrder: number[]): ItemWithState[] {
  const { byCategory } = makeCategoryComparators(categoryOrder)
  const currentFull = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const sortedActive = currentFull.filter(i => !i.archived).sort(byCategory)
  return reorderByCategory(currentFull, sortedActive)
}

/** True when active items already follow category order (sort would be a no-op). */
export function areItemsSortedByCategory(items: ItemWithState[], categoryOrder: number[]): boolean {
  if (items.length <= 1) return true
  const currentIds = [...items]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((item) => item.id)
  const reorderedIds = computeItemsReorderedByCategory(items, categoryOrder).map((item) => item.id)
  return currentIds.every((id, index) => id === reorderedIds[index])
}
