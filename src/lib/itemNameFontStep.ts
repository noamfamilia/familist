/** Discrete steps for item name font size (~3 clicks from default to min or max). */

export const ITEM_NAME_FONT_MIN = 0
export const ITEM_NAME_FONT_MAX = 6
export const ITEM_NAME_FONT_DEFAULT = 3

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
