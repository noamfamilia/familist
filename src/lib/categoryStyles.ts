import type { ItemCategory } from '@/lib/supabase/types'

/** Category 1–6: shell for item row bg, swatch for small picker chips, modal for modal input rows. */
export const ITEM_CATEGORY_STYLES: Record<ItemCategory, { shell: string; swatch: string; modal: string }> = {
  1: {
    shell: 'bg-gray-50 hover:bg-gray-100',
    swatch: 'border border-gray-300 bg-gray-50',
    modal: 'bg-gray-100 border border-gray-300',
  },
  2: {
    shell: 'bg-teal/10 hover:bg-teal/[0.18]',
    swatch: 'border border-teal/40 bg-teal/10',
    modal: 'bg-teal/20 border border-teal/40',
  },
  3: {
    shell: 'bg-coral/10 hover:bg-coral/[0.18]',
    swatch: 'border border-coral/40 bg-coral/10',
    modal: 'bg-coral/20 border border-coral/40',
  },
  4: {
    shell: 'bg-orange/10 hover:bg-orange/20',
    swatch: 'border border-orange/45 bg-orange/10',
    modal: 'bg-orange/20 border border-orange/45',
  },
  5: {
    shell: 'bg-violet-100/90 hover:bg-violet-100',
    swatch: 'border border-violet-300/55 bg-violet-100/90',
    modal: 'bg-violet-200/80 border border-violet-300/55',
  },
  6: {
    shell: 'bg-slate-200/60 hover:bg-slate-200/80',
    swatch: 'border border-slate-400/55 bg-slate-200/60',
    modal: 'bg-slate-200 border border-slate-400/55',
  },
}
