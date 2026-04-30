import { ITEM_NAME_FONT_DEFAULT, itemNameFontCanvasPx } from '@/lib/itemNameFontStep'

function canvasFontForItemName(px: number): string {
  return `400 ${px}px Inter, "Inter Fallback", system-ui, sans-serif`
}

export const ITEM_TEXT_WIDTH_MIN = 80
/** Keeps the name column from growing unbounded on very long single-line strings. */
export const ITEM_TEXT_WIDTH_MAX = 560

/**
 * Extra pixels added to the longest canvas-measured item name width in **auto** mode.
 * Previously 4; increased so slight font / subpixel differences do not clip the last glyphs.
 */
/** Slightly generous so long labels (e.g. “Sum archived - N”) do not clip vs canvas measureText. */
export const ITEM_NAME_AUTO_FIT_EXTRA_PX = 18

/** `text-[10px]` category chip next to the item ⋮ menu — horizontal padding on measured text. */
export const CATEGORY_LABEL_CHIP_EXTRA_PX = 8

const CATEGORY_LABEL_FONT_PX = 10
const CATEGORY_LABEL_CHIP_WIDTH_MIN = 24
const CATEGORY_LABEL_CHIP_WIDTH_MAX = 200

/**
 * Width (px) for the item name column so the longest label fits (canvas measureText).
 * {@link fontStep} should match the item name font step (0–6); defaults to {@link ITEM_NAME_FONT_DEFAULT}.
 * Safe to call only in the browser; returns {@link ITEM_TEXT_WIDTH_MIN} on SSR or if measurement fails.
 */
export function measureFitItemTextWidthPx(texts: string[], fontStep: number = ITEM_NAME_FONT_DEFAULT): number {
  if (typeof window === 'undefined') return ITEM_TEXT_WIDTH_MIN

  const nonEmpty = texts.map(t => t.trim()).filter(Boolean)
  if (nonEmpty.length === 0) return ITEM_TEXT_WIDTH_MIN

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return ITEM_TEXT_WIDTH_MIN

  ctx.font = canvasFontForItemName(itemNameFontCanvasPx(fontStep))
  let maxPx = 0
  for (const text of nonEmpty) {
    const w = ctx.measureText(text).width
    if (w > maxPx) maxPx = w
  }

  const padded = Math.ceil(maxPx + ITEM_NAME_AUTO_FIT_EXTRA_PX)
  return Math.min(ITEM_TEXT_WIDTH_MAX, Math.max(ITEM_TEXT_WIDTH_MIN, padded))
}

/**
 * Width for the small category label chip (`text-[10px]`) next to the kebab, when laid out per-item
 * (no member columns). Clamped so a single long name cannot dominate the row.
 */
export function measureCategoryLabelChipWidthPx(text: string): number {
  if (typeof window === 'undefined') return CATEGORY_LABEL_CHIP_WIDTH_MIN

  const trimmed = text.trim()
  if (!trimmed) return CATEGORY_LABEL_CHIP_WIDTH_MIN

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return CATEGORY_LABEL_CHIP_WIDTH_MIN

  ctx.font = `400 ${CATEGORY_LABEL_FONT_PX}px Inter, "Inter Fallback", system-ui, sans-serif`
  const w = Math.ceil(ctx.measureText(trimmed).width + CATEGORY_LABEL_CHIP_EXTRA_PX)
  return Math.min(CATEGORY_LABEL_CHIP_WIDTH_MAX, Math.max(CATEGORY_LABEL_CHIP_WIDTH_MIN, w))
}
