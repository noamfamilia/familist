import type { ItemCategory } from '@/lib/supabase/types'

/** Item row in dark mode: same for every category (list card). Light: per-category tint below. */
const DARK_ROW_SHELL = 'dark:bg-neutral-900 dark:hover:bg-neutral-700'

/** Light-only row backgrounds (legacy, pre–home dark toggle). */
const LIGHT_SHELL: Record<ItemCategory, string> = {
  1: 'bg-gray-50 hover:bg-gray-100',
  2: 'bg-teal/10 hover:bg-teal/[0.18]',
  3: 'bg-coral/10 hover:bg-coral/[0.18]',
  4: 'bg-orange/10 hover:bg-orange/20',
  5: 'bg-violet-100/90 hover:bg-violet-100',
  6: 'bg-sky-100/60 hover:bg-sky-100/80',
}

/** Light-only category chips (item menu / add-item picker) — legacy translucent fills. */
const LIGHT_SWATCH: Record<ItemCategory, string> = {
  1: 'border border-gray-300 bg-gray-50',
  2: 'border border-teal/40 bg-teal/10',
  3: 'border border-coral/40 bg-coral/10',
  4: 'border border-orange/45 bg-orange/10',
  5: 'border border-violet-300/55 bg-violet-100/90',
  6: 'border border-sky-300/55 bg-sky-100/60',
}

/** Light-only Set Categories modal rows. */
const LIGHT_MODAL: Record<ItemCategory, string> = {
  1: 'bg-gray-100 border border-gray-300',
  2: 'bg-teal/20 border border-teal/40',
  3: 'bg-coral/20 border border-coral/40',
  4: 'bg-orange/20 border border-orange/45',
  5: 'bg-violet-200/80 border border-violet-300/55',
  6: 'bg-sky-200 border border-sky-300/55',
}

/** Per-category `dark:text-*` for chips, modal, and item title (light title uses `text-primary` via `itemName`). */
export const ITEM_CATEGORY_NAME_DARK: Record<ItemCategory, string> = {
  1: 'dark:text-neutral-100',
  2: 'dark:text-teal-300',
  3: 'dark:text-orange-300',
  4: 'dark:text-amber-300',
  5: 'dark:text-violet-300',
  6: 'dark:text-sky-300',
}

/** Dark: neutral chip + category-colored text; outline follows `currentColor`. */
const DARK_SWATCH_SUFFIX = (catId: ItemCategory) =>
  `dark:border-neutral-600 dark:bg-neutral-900 ${ITEM_CATEGORY_NAME_DARK[catId]} dark:outline dark:outline-1 dark:outline-offset-0 dark:outline-current`

/** Dark: Set Categories row surface + category text + outline. */
const DARK_MODAL_SUFFIX = (catId: ItemCategory) =>
  `dark:bg-neutral-900 dark:border-neutral-600 ${ITEM_CATEGORY_NAME_DARK[catId]} dark:outline dark:outline-1 dark:outline-offset-0 dark:outline-current`

function joinClasses(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

function categoryShell(catId: ItemCategory): string {
  return joinClasses(LIGHT_SHELL[catId], DARK_ROW_SHELL)
}

function categorySwatch(catId: ItemCategory): string {
  return joinClasses(LIGHT_SWATCH[catId], DARK_SWATCH_SUFFIX(catId))
}

function categoryModalRow(catId: ItemCategory): string {
  return joinClasses(LIGHT_MODAL[catId], DARK_MODAL_SUFFIX(catId))
}

function categoryItemName(catId: ItemCategory): string {
  return joinClasses('text-primary', ITEM_CATEGORY_NAME_DARK[catId])
}

/** Category 1–6: light = legacy fills; dark = neutral + text + outline on chips/modal, unified row shell. */
export const ITEM_CATEGORY_STYLES: Record<
  ItemCategory,
  { shell: string; swatch: string; modal: string; itemName: string }
> = {
  1: {
    shell: categoryShell(1),
    swatch: categorySwatch(1),
    modal: categoryModalRow(1),
    itemName: categoryItemName(1),
  },
  2: {
    shell: categoryShell(2),
    swatch: categorySwatch(2),
    modal: categoryModalRow(2),
    itemName: categoryItemName(2),
  },
  3: {
    shell: categoryShell(3),
    swatch: categorySwatch(3),
    modal: categoryModalRow(3),
    itemName: categoryItemName(3),
  },
  4: {
    shell: categoryShell(4),
    swatch: categorySwatch(4),
    modal: categoryModalRow(4),
    itemName: categoryItemName(4),
  },
  5: {
    shell: categoryShell(5),
    swatch: categorySwatch(5),
    modal: categoryModalRow(5),
    itemName: categoryItemName(5),
  },
  6: {
    shell: categoryShell(6),
    swatch: categorySwatch(6),
    modal: categoryModalRow(6),
    itemName: categoryItemName(6),
  },
}
