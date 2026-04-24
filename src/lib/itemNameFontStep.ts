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

/**
 * Min height (px) for the item title row (and list header control row) so card height scales with
 * {@link itemNameFontClassForStep}. Expanded item menu below the row is not affected.
 */
export function itemNameRowMinHeightPx(step: number): number {
  const px = itemNameFontCanvasPx(step)
  return Math.max(40, Math.ceil(px * 1.35 + 10))
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
