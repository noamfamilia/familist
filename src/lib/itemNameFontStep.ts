/** Discrete steps for item name font size (~3 clicks from default to min or max). */

export const ITEM_NAME_FONT_MIN = 0
export const ITEM_NAME_FONT_MAX = 6
export const ITEM_NAME_FONT_DEFAULT = 3

/** Font sizes (px) at default 16px root — matches Tailwind text-* used in {@link itemNameFontClassForStep}. */
export const ITEM_NAME_FONT_CANVAS_PX: readonly number[] = [12, 14, 16, 18, 20, 24, 30]

export function itemNameFontCanvasPx(step: number): number {
  const s = Math.min(ITEM_NAME_FONT_MAX, Math.max(ITEM_NAME_FONT_MIN, Math.round(step)))
  return ITEM_NAME_FONT_CANVAS_PX[s] ?? ITEM_NAME_FONT_CANVAS_PX[ITEM_NAME_FONT_DEFAULT]
}

const CLASS_NAMES = [
  'text-xs leading-tight',
  'text-sm leading-tight',
  'text-base leading-snug',
  'text-lg leading-snug',
  'text-xl leading-snug',
  'text-2xl leading-tight',
  'text-3xl leading-tight',
] as const

export function itemNameFontClassForStep(step: number): string {
  const s = Math.min(ITEM_NAME_FONT_MAX, Math.max(ITEM_NAME_FONT_MIN, Math.round(step)))
  return CLASS_NAMES[s] ?? CLASS_NAMES[ITEM_NAME_FONT_DEFAULT]
}

export function parseItemNameFontStep(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (Number.isNaN(n) || n < ITEM_NAME_FONT_MIN || n > ITEM_NAME_FONT_MAX) return ITEM_NAME_FONT_DEFAULT
  return n
}

/** Vertical padding (px) on item row with members: py-1 each side, inside total row height (border-box). */
export const ITEM_CARD_MEMBER_ROW_PAD_V_PX = 8

/** 4px gap above + below the qty progress bar inside the member cell. */
export const ITEM_QTY_PROGRESS_BAR_INSET_V_PX = 8

/**
 * Total collapsed item row height (px) when the list has member columns.
 * Anchored so {@link ITEM_NAME_FONT_DEFAULT} keeps 40px; slope 2px row height per 1px font size change.
 */
export function itemCardRowHeightWithMembersPx(step: number): number {
  const fontPx = itemNameFontCanvasPx(step)
  const anchorPx = itemNameFontCanvasPx(ITEM_NAME_FONT_DEFAULT)
  return 2 * fontPx + (40 - 2 * anchorPx)
}

/** Height of each member / target-qty cell (row minus vertical padding). */
export function itemMemberCellHeightPx(step: number): number {
  return itemCardRowHeightWithMembersPx(step) - ITEM_CARD_MEMBER_ROW_PAD_V_PX
}

/** Inner height for {@link QtyProgressBarIconVertical} (cell minus 4px top + 4px bottom). */
export function itemQtyProgressBarTrackHeightPx(step: number): number {
  return Math.max(1, itemMemberCellHeightPx(step) - ITEM_QTY_PROGRESS_BAR_INSET_V_PX)
}
