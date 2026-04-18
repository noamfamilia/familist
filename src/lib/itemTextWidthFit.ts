/** Matches ItemCard item name: `text-lg` (18px), normal weight, Inter / system UI. */
const CANVAS_FONT = '400 18px Inter, "Inter Fallback", system-ui, sans-serif'

export const ITEM_TEXT_WIDTH_MIN = 80
/** Keeps the name column from growing unbounded on very long single-line strings. */
export const ITEM_TEXT_WIDTH_MAX = 560

/**
 * Width (px) for the item name column so the longest label fits (canvas measureText).
 * Safe to call only in the browser; returns {@link ITEM_TEXT_WIDTH_MIN} on SSR or if measurement fails.
 */
export function measureFitItemTextWidthPx(texts: string[]): number {
  if (typeof window === 'undefined') return ITEM_TEXT_WIDTH_MIN

  const nonEmpty = texts.map(t => t.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return ITEM_TEXT_WIDTH_MIN

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return ITEM_TEXT_WIDTH_MIN

  ctx.font = CANVAS_FONT
  let maxPx = 0
  for (const text of nonEmpty) {
    const w = ctx.measureText(text).width
    if (w > maxPx) maxPx = w
  }

  const padded = Math.ceil(maxPx)
  return Math.min(ITEM_TEXT_WIDTH_MAX, Math.max(ITEM_TEXT_WIDTH_MIN, padded))
}
