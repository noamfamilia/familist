import type { ItemCategory } from '@/lib/supabase/types'

/** Same row shell as list cards (`ListCard`). */
export const ITEM_LIST_ROW_SHELL =
  'bg-gray-50 hover:bg-gray-100 dark:bg-neutral-900 dark:hover:bg-neutral-700'

/** Category chip / modal row surface (neutral; category is conveyed by text color). */
const ITEM_CATEGORY_SURFACE =
  'border border-gray-300 bg-gray-50 dark:border-neutral-600 dark:bg-neutral-900'

const ITEM_CATEGORY_MODAL_ROW =
  'bg-gray-50 border border-gray-200 dark:bg-neutral-900 dark:border-neutral-600'

/** Item title color by category (row background is always `ITEM_LIST_ROW_SHELL`). */
export const ITEM_CATEGORY_NAME_CLASS: Record<ItemCategory, string> = {
  1: 'text-primary dark:text-neutral-100',
  2: 'text-teal dark:text-teal-300',
  3: 'text-coral dark:text-orange-300',
  4: 'text-orange dark:text-amber-300',
  5: 'text-violet-700 dark:text-violet-300',
  6: 'text-sky-700 dark:text-sky-300',
}

/** Category 1–6: shell = list card row; swatch/modal = neutral surface + `itemName` for labels. */
export const ITEM_CATEGORY_STYLES: Record<
  ItemCategory,
  { shell: string; swatch: string; modal: string; itemName: string }
> = {
  1: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[1]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[1],
  },
  2: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[2]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[2],
  },
  3: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[3]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[3],
  },
  4: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[4]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[4],
  },
  5: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[5]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[5],
  },
  6: {
    shell: ITEM_LIST_ROW_SHELL,
    swatch: `${ITEM_CATEGORY_SURFACE} ${ITEM_CATEGORY_NAME_CLASS[6]}`,
    modal: ITEM_CATEGORY_MODAL_ROW,
    itemName: ITEM_CATEGORY_NAME_CLASS[6],
  },
}
