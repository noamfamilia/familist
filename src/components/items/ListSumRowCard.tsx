'use client'

import { useMemo } from 'react'
import type { ItemWithState, ListUserSumScope, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import { compactRowCardWidthCss, measureItemNameNaturalWidthPx } from '@/lib/itemTextWidthFit'
import {
  ITEM_NAME_FONT_DEFAULT,
  itemCardRowHeightWithMembersPx,
  itemMemberCellHeightPx,
} from '@/lib/itemNameFontStep'

const DEFAULT_ITEM = ITEM_CATEGORY_STYLES[1]

type SumRowMode = Exclude<ListUserSumScope, 'none'>

function itemsInScope(kind: SumRowMode, items: ItemWithState[]): ItemWithState[] {
  if (kind === 'all') return items
  if (kind === 'active') return items.filter(i => !i.archived)
  return items.filter(i => i.archived)
}

function sumRowTitleLabel(mode: SumRowMode, n: number): string {
  if (mode === 'all') return `${n} items`
  if (mode === 'active') return `${n} active items`
  return `${n} archived item`
}

function sumRegularMember(memberId: string, scoped: ItemWithState[]): number {
  let t = 0
  for (const item of scoped) {
    const s = item.memberStates[memberId]
    if (s?.assigned) t += s.quantity ?? 1
  }
  return t
}

/** Sum of displayed target quantities (same number as in each item’s Qty goal cell). */
function sumTargetMemberDisplay(targetMemberId: string, scoped: ItemWithState[]): number {
  let t = 0
  for (const item of scoped) {
    const s = item.memberStates[targetMemberId]
    t += s?.quantity ?? 1
  }
  return t
}

interface ListSumRowCardProps {
  sumScope: SumRowMode
  items: ItemWithState[]
  members: MemberWithCreator[]
  itemTextWidth: number
  itemTextWidthMode?: 'auto' | 'manual'
  compactRowPageMinWidthPx?: number
  compactRowCardWidthOverridePx?: number
  itemNameFontClassName: string
  itemNameFontStep?: number
  onCycleScope: () => void
  onClearAddItemDraft?: () => void
}

export function ListSumRowCard({
  sumScope,
  items,
  members,
  itemTextWidth,
  itemTextWidthMode = 'auto',
  compactRowPageMinWidthPx = 0,
  compactRowCardWidthOverridePx,
  itemNameFontClassName,
  itemNameFontStep = ITEM_NAME_FONT_DEFAULT,
  onCycleScope,
  onClearAddItemDraft,
}: ListSumRowCardProps) {
  const compactRow = members.length === 0
  const compactAutoLayout = compactRow && itemTextWidthMode === 'auto'
  const scoped = useMemo(() => itemsInScope(sumScope, items), [sumScope, items])
  const title = sumRowTitleLabel(sumScope, scoped.length)
  const titleWidthPx = useMemo(
    () => measureItemNameNaturalWidthPx(title, itemNameFontStep),
    [title, itemNameFontStep],
  )
  const nameColumnWidthPx = compactAutoLayout ? titleWidthPx : itemTextWidth
  const compactLayoutWidthPx = compactRowCardWidthOverridePx ?? itemTextWidth
  const compactFixedLayout =
    compactRow && (compactAutoLayout || compactRowCardWidthOverridePx != null)
  const compactWidthCss = compactFixedLayout
    ? compactRowCardWidthCss(compactLayoutWidthPx, compactRowPageMinWidthPx)
    : undefined

  const itemRowHeightPx = itemCardRowHeightWithMembersPx(itemNameFontStep)
  const memberCellPx = itemMemberCellHeightPx(itemNameFontStep)

  const memberSums = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of members) {
      if (m.is_target) {
        map.set(m.id, sumTargetMemberDisplay(m.id, scoped))
      } else {
        map.set(m.id, sumRegularMember(m.id, scoped))
      }
    }
    return map
  }, [members, scoped])

  const qtyTextClass = `${itemNameFontClassName} text-teal dark:text-teal-300`

  return (
    <div
      className={compactFixedLayout ? 'block min-w-full' : compactRow ? 'block w-max' : 'min-w-full'}
      onClick={onClearAddItemDraft}
    >
      <div
        className={`block rounded-lg ${DEFAULT_ITEM.shell} ${
          compactFixedLayout ? 'min-w-full' : compactRow ? 'w-max' : 'min-w-full w-max'
        }`}
        style={compactWidthCss ? { width: compactWidthCss } : undefined}
      >
        <div
          className={
            compactRow
              ? compactFixedLayout
                ? 'box-border flex min-w-full flex-nowrap items-center gap-0.5 px-2 py-1 whitespace-nowrap'
                : 'box-border flex w-max flex-nowrap items-center gap-0.5 px-2 py-1 whitespace-nowrap'
              : 'box-border flex min-h-0 items-center gap-0.5 px-2 py-1 whitespace-nowrap'
          }
          style={{
            height: itemRowHeightPx,
            ...(compactWidthCss ? { width: compactWidthCss } : undefined),
          }}
        >
          <div
            className="w-5 flex-shrink-0 select-none text-lg tracking-tighter text-transparent"
            aria-hidden
          >
            ⋮⋮
          </div>

          {members.length > 0 ? (
            <span className="text-xl flex-shrink-0 leading-none invisible select-none" aria-hidden>
              ▼
            </span>
          ) : null}

          <div
            className="relative flex-shrink-0 text-left"
            style={{ width: nameColumnWidthPx }}
            dir="ltr"
          >
            <button
              type="button"
              className={`block w-full text-left ${itemNameFontClassName} text-teal dark:text-teal-300 cursor-pointer hover:opacity-80 ${compactAutoLayout ? 'whitespace-nowrap' : 'truncate'}`}
              onClick={e => {
                e.stopPropagation()
                onCycleScope()
              }}
              title="Click to switch between all, active, and archived"
            >
              {title}
            </button>
          </div>

          {members.length > 0 ? (
            <div className="ml-2.5 flex flex-shrink-0 items-center gap-2.5">
              {members.map(member => {
                const value = memberSums.get(member.id) ?? 0
                return (
                  <div
                    key={member.id}
                    className="relative box-border flex w-[90px] flex-shrink-0 cursor-default items-center justify-center rounded-lg border border-transparent bg-transparent px-2 py-1"
                    style={{ height: memberCellPx }}
                  >
                    <span className={`max-w-full truncate text-center ${qtyTextClass}`}>{value}</span>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
