'use client'

import { useMemo } from 'react'
import type { ItemWithState, ListUserSumScope, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import {
  compactRowCardWidthCss,
  ITEM_ROW_LEADING_INSET_PX,
  itemNameColumnRightEdgePx,
  measureCompactManualSumRowContentWidthPx,
  itemRowArchiveSlotClassName,
  itemRowDragArchiveGroupClassName,
  itemRowDragHandleClassName,
  itemRowFlexGapClassName,
  itemRowHorizontalPaddingClassName,
  itemRowMemberLeadingClassName,
} from '@/lib/itemTextWidthFit'
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
  itemNameFontClassName,
  itemNameFontStep = ITEM_NAME_FONT_DEFAULT,
  onCycleScope,
  onClearAddItemDraft,
}: ListSumRowCardProps) {
  const compactRow = members.length === 0
  const compactAutoLayout = compactRow && itemTextWidthMode === 'auto'
  const scoped = useMemo(() => itemsInScope(sumScope, items), [sumScope, items])
  const title = sumRowTitleLabel(sumScope, scoped.length)
  const compactRowContentWidthPx =
    compactAutoLayout ? itemTextWidth : measureCompactManualSumRowContentWidthPx(itemTextWidth)
  const compactFixedLayout = compactRow
  const compactWidthCss = compactFixedLayout
    ? compactRowCardWidthCss(compactRowContentWidthPx, compactRowPageMinWidthPx)
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
  const sumTitleMaxWidthPx = compactAutoLayout
    ? undefined
    : itemNameColumnRightEdgePx(itemTextWidth) - ITEM_ROW_LEADING_INSET_PX

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
                ? `box-border flex min-w-full flex-nowrap items-center whitespace-nowrap ${itemRowFlexGapClassName} ${itemRowHorizontalPaddingClassName}`
                : `box-border flex w-max flex-nowrap items-center whitespace-nowrap ${itemRowFlexGapClassName} ${itemRowHorizontalPaddingClassName}`
              : `box-border flex min-h-0 items-center whitespace-nowrap ${itemRowFlexGapClassName} ${itemRowHorizontalPaddingClassName}`
          }
          style={{
            height: itemRowHeightPx,
            ...(compactWidthCss ? { width: compactWidthCss } : undefined),
          }}
        >
          <div className={itemRowDragArchiveGroupClassName}>
            <div className={`${itemRowDragHandleClassName} select-none text-transparent`} aria-hidden>
              ⋮⋮
            </div>

            <div className="relative shrink-0">
              <span
                className={`${itemRowArchiveSlotClassName} invisible select-none`}
                aria-hidden
              >
                ▼
              </span>
              <button
                type="button"
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center ${itemNameFontClassName} text-teal dark:text-teal-300 cursor-pointer hover:opacity-80 ${compactAutoLayout ? 'whitespace-nowrap' : 'truncate'}`}
                style={sumTitleMaxWidthPx != null ? { maxWidth: sumTitleMaxWidthPx } : undefined}
                onClick={e => {
                  e.stopPropagation()
                  onCycleScope()
                }}
                title="Click to switch between all, active, and archived"
              >
                {title}
              </button>
            </div>
          </div>

          {members.length > 0 ? (
            <div
              className="shrink-0"
              style={{ width: itemTextWidth }}
              aria-hidden
            />
          ) : null}

          {members.length > 0 ? (
            <div className={itemRowMemberLeadingClassName}>
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
