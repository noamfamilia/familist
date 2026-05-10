import { normalizeItemCategory, type ItemWithState } from '@/lib/supabase/types'

const LEGACY_CARD_COLOR_TO_CATEGORY: Record<string, number> = {
  default: 1,
  mint: 2,
  coral: 3,
  sand: 4,
  lilac: 5,
  slate: 6,
}

export function normalizeItemsCategory(items: ItemWithState[]): ItemWithState[] {
  return items.map((item) => {
    const legacy = item as ItemWithState & { card_color?: string }
    const fromLegacy =
      item.category == null && legacy.card_color != null
        ? LEGACY_CARD_COLOR_TO_CATEGORY[legacy.card_color.trim()] ?? 1
        : item.category
    return {
      ...item,
      category: normalizeItemCategory(fromLegacy),
    }
  })
}
