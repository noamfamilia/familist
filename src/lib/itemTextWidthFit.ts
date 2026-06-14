import { ITEM_NAME_FONT_DEFAULT, itemNameFontCanvasPx } from '@/lib/itemNameFontStep'

function canvasFontForItemName(px: number): string {
  return `400 ${px}px Inter, "Inter Fallback", system-ui, sans-serif`
}

export const ITEM_TEXT_WIDTH_MIN = 120
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

/** Card row `pl-2` + drag `w-5` + flex `gap-0.5` from card outer edge to archive / former name start (px). */
export const ITEM_ROW_LEADING_INSET_PX = 30

/** Flex `gap-0.5` between archive icon and item name column (px). */
export const ITEM_ROW_ARCHIVE_NAME_GAP_PX = 2

/** Width of the ▼/▲ archive control (`text-xl`) on item rows. */
export function measureItemRowArchiveSlotWidthPx(): number {
  if (typeof window === 'undefined') return 12

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return 12

  return Math.ceil(ctx.measureText('▼').width)
}

/** Card outer edge → left edge of item name column (px). */
export function itemNameColumnLeftEdgePx(): number {
  return ITEM_ROW_LEADING_INSET_PX + measureItemRowArchiveSlotWidthPx() + ITEM_ROW_ARCHIVE_NAME_GAP_PX
}

/** Card outer edge → right edge of item name column (px). */
export function itemNameColumnRightEdgePx(itemTextWidth: number): number {
  return itemNameColumnLeftEdgePx() + itemTextWidth
}

/** Matches `ml-2.5` before member / item-state columns on item rows (px). */
export const ITEM_ROW_MEMBER_LEADING_GAP_PX = 10

/** Width guide sits this many px left of the first member column (px). */
export const ITEM_WIDTH_BOUNDARY_GUIDE_BEFORE_MEMBER_PX = 0

/** Card outer edge → left edge of the first member column (px). */
export function itemRowFirstMemberLeftEdgePx(itemTextWidth: number): number {
  return itemNameColumnRightEdgePx(itemTextWidth) + ITEM_ROW_MEMBER_LEADING_GAP_PX
}

/** Left position (px) for the teal width-boundary guide. */
export function itemNameWidthBoundaryGuideLeftPx(itemTextWidth: number): number {
  return itemRowFirstMemberLeftEdgePx(itemTextWidth) - ITEM_WIDTH_BOUNDARY_GUIDE_BEFORE_MEMBER_PX
}

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
 * Width for the small category label chip (`text-[10px]`) at the trailing edge of the item row,
 * when laid out per-item (no member columns). Clamped so a single long name cannot dominate the row.
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
