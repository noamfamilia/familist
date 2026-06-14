import { ITEM_NAME_FONT_DEFAULT, itemNameFontCanvasPx } from '@/lib/itemNameFontStep'

function canvasFontForItemName(px: number): string {
  return `400 ${px}px Inter, "Inter Fallback", system-ui, sans-serif`
}

export const ITEM_TEXT_WIDTH_MIN = 120
/** Lowest manual name-column width; names truncate below natural fit. */
export const ITEM_TEXT_WIDTH_MANUAL_MIN = 80
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

/** Card row `pl-2` + drag `w-5` + tight drag→archive gap (px). */
export const ITEM_ROW_DRAG_ARCHIVE_GAP_PX = 2

/** Card row inset from outer edge to archive icon (px). */
export const ITEM_ROW_LEADING_INSET_PX =
  8 + 20 + ITEM_ROW_DRAG_ARCHIVE_GAP_PX

/** Flex gap between archive icon and item name column (px); matches outer `gap-2`. */
export const ITEM_ROW_ARCHIVE_NAME_GAP_PX = 8

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

/** Shared layout classes — keep header, item, and sum rows aligned. */
export const itemRowHorizontalPaddingClassName = 'pl-2 pr-1 py-1'
export const itemRowFlexGapClassName = 'gap-2'
export const itemRowDragArchiveGroupClassName = 'flex shrink-0 items-center gap-0.5'
export const itemRowDragHandleClassName =
  'flex w-5 flex-shrink-0 items-center justify-center text-lg tracking-tighter text-gray-400 select-none touch-none dark:text-gray-500'
export const itemRowArchiveSlotClassName = 'text-xl flex-shrink-0 leading-none'
export const itemRowMemberLeadingClassName = 'ml-2.5 flex flex-shrink-0 items-center gap-2.5'

/** Width guide sits this many px left of the first member column (px). */
export const ITEM_WIDTH_BOUNDARY_GUIDE_BEFORE_MEMBER_PX = 0

/** Card outer edge → left edge of the first member column (px). */
export function itemRowFirstMemberLeftEdgePx(itemTextWidth: number): number {
  return itemNameColumnRightEdgePx(itemTextWidth) + ITEM_ROW_FLEX_GAP_PX + ITEM_ROW_MEMBER_LEADING_GAP_PX
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

/** Row `pr-2` (px). */
export const ITEM_ROW_TRAILING_PADDING_PX = 8

/** Flex gap between row siblings (px); matches `gap-2`. */
export const ITEM_ROW_FLEX_GAP_PX = 8

/** Trailing cluster `pl-2` before category / comment / kebab (px). */
export const ITEM_ROW_TRAILING_CLUSTER_LEADING_PX = 8

/** Trailing `gap-1` between comment, category, kebab (px). */
export const ITEM_ROW_TRAILING_INNER_GAP_PX = 4

/** Collapsed-row comment indicator (px). */
export const ITEM_ROW_COMMENT_ICON_WIDTH_PX = 16

/** Collapsed-row kebab control (px). */
export const ITEM_ROW_KEBAB_WIDTH_PX = 28

export type CompactRowItemMeasureInput = {
  name: string
  categoryTitle: string
  hasComment: boolean
}

function measureSingleLineTextPx(text: string, font: string): number {
  if (typeof window === 'undefined') return 0
  const trimmed = text.trim()
  if (!trimmed) return 0

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0

  ctx.font = font
  return ctx.measureText(trimmed).width
}

/** Natural item-name width for one row (auto mode, no shared column). */
export function measureItemNameNaturalWidthPx(
  text: string,
  fontStep: number = ITEM_NAME_FONT_DEFAULT,
): number {
  const w = measureSingleLineTextPx(text, canvasFontForItemName(itemNameFontCanvasPx(fontStep)))
  if (w <= 0) return ITEM_TEXT_WIDTH_MIN
  return Math.max(ITEM_TEXT_WIDTH_MIN, Math.ceil(w + 2))
}

/** Trailing icons/labels after the name on compact (no-member) rows. */
export function measureCompactRowTrailingWidthPx(input: {
  categoryTitle: string
  hasComment: boolean
}): number {
  let w = ITEM_ROW_TRAILING_CLUSTER_LEADING_PX
  let parts = 0

  if (input.hasComment) {
    w += ITEM_ROW_COMMENT_ICON_WIDTH_PX
    parts += 1
  }

  const categoryTitle = input.categoryTitle.trim()
  if (categoryTitle) {
    if (parts > 0) w += ITEM_ROW_TRAILING_INNER_GAP_PX
    w += measureCategoryLabelChipWidthPx(categoryTitle)
    parts += 1
  }

  if (parts > 0) w += ITEM_ROW_TRAILING_INNER_GAP_PX
  w += ITEM_ROW_KEBAB_WIDTH_PX
  return w
}

/** Full compact row width in manual mode (fixed name column, collapsed trailing). */
export function measureCompactManualRowContentWidthPx(
  nameColumnWidthPx: number,
  input: { categoryTitle: string; hasComment: boolean },
): number {
  const trailing = measureCompactRowTrailingWidthPx(input)
  return (
    itemNameColumnLeftEdgePx() +
    nameColumnWidthPx +
    ITEM_ROW_FLEX_GAP_PX +
    trailing +
    ITEM_ROW_TRAILING_PADDING_PX
  )
}

/** Minimum card width so one compact row fits without truncating its name (px). */
export function measureCompactRowRowContentWidthPx(
  input: CompactRowItemMeasureInput,
  fontStep: number = ITEM_NAME_FONT_DEFAULT,
): number {
  const nameWidth = measureItemNameNaturalWidthPx(input.name, fontStep)
  const trailingWidth = measureCompactRowTrailingWidthPx({
    categoryTitle: input.categoryTitle,
    hasComment: input.hasComment,
  })
  return (
    itemNameColumnLeftEdgePx() +
    nameWidth +
    ITEM_ROW_FLEX_GAP_PX +
    trailingWidth +
    ITEM_ROW_TRAILING_PADDING_PX
  )
}

/** Sum row without members: drag spacer + title only. */
export function measureCompactSumRowContentWidthPx(title: string, fontStep: number = ITEM_NAME_FONT_DEFAULT): number {
  const nameWidth = measureItemNameNaturalWidthPx(title, fontStep)
  return ITEM_ROW_LEADING_INSET_PX + nameWidth + ITEM_ROW_TRAILING_PADDING_PX
}

/** Sum row in manual compact layout (fixed name column). */
export function measureCompactManualSumRowContentWidthPx(nameColumnWidthPx: number): number {
  return itemNameColumnRightEdgePx(nameColumnWidthPx) + ITEM_ROW_TRAILING_PADDING_PX
}

function maxRowContentWidth(
  rows: CompactRowItemMeasureInput[],
  fontStep: number,
): number {
  if (rows.length === 0) return ITEM_TEXT_WIDTH_MIN
  let maxPx = ITEM_TEXT_WIDTH_MIN
  for (const row of rows) {
    maxPx = Math.max(maxPx, measureCompactRowRowContentWidthPx(row, fontStep))
  }
  return Math.max(ITEM_TEXT_WIDTH_MIN, maxPx)
}

/** Name width (px) on the tightest compact row — manual width must not go below this. */
export function measureCompactRowTightestNameWidthPx(
  rows: CompactRowItemMeasureInput[],
  fontStep: number = ITEM_NAME_FONT_DEFAULT,
): number {
  if (rows.length === 0) return ITEM_TEXT_WIDTH_MIN

  let tightestNameWidth = ITEM_TEXT_WIDTH_MIN
  let maxRowNeed = -1
  for (const row of rows) {
    const rowNeed = measureCompactRowRowContentWidthPx(row, fontStep)
    if (rowNeed > maxRowNeed) {
      maxRowNeed = rowNeed
      tightestNameWidth = measureItemNameNaturalWidthPx(row.name, fontStep)
    }
  }
  return tightestNameWidth
}

/** Shared card width for auto mode on no-member lists (px). */
export function measureCompactRowAutoViewWidthPx(
  rows: CompactRowItemMeasureInput[],
  fontStep: number = ITEM_NAME_FONT_DEFAULT,
): number {
  return maxRowContentWidth(rows, fontStep)
}

/** CSS width for a compact row card: at least list page content width, grows when content requires. */
export function compactRowCardWidthCss(contentWidthPx: number, pageContentMinWidthPx = 0): string {
  const content = Math.max(ITEM_TEXT_WIDTH_MIN, contentWidthPx)
  if (pageContentMinWidthPx > 0) {
    return `max(${Math.floor(pageContentMinWidthPx)}px, ${content}px)`
  }
  return `max(100%, ${content}px)`
}

/**
 * Inner content width of the list detail shell (inside horizontal padding).
 * Mobile: viewport minus shell padding. PC (`sm+`): measured list panel width.
 */
export function measureListPageContentWidthPx(shellEl: HTMLElement): number {
  if (typeof window === 'undefined') return ITEM_TEXT_WIDTH_MIN

  const style = getComputedStyle(shellEl)
  const pl = parseFloat(style.paddingLeft) || 0
  const pr = parseFloat(style.paddingRight) || 0
  const isSm = window.matchMedia('(min-width: 640px)').matches

  if (isSm) {
    return Math.max(ITEM_TEXT_WIDTH_MIN, Math.floor(shellEl.clientWidth - pl - pr))
  }

  return Math.max(ITEM_TEXT_WIDTH_MIN, Math.floor(window.innerWidth - pl - pr))
}
