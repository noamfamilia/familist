'use client'

import { useMemo } from 'react'
import type { ItemWithState, ListUserSumScope, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
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

function titleForMode(mode: SumRowMode): string {
  if (mode === 'all') return 'Sum all'
  if (mode === 'active') return 'Sum active'
  return 'Sum archived'
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

const ITEM_DELETE_ICON_PATH =
  'M5.755,20.283,4,8H20L18.245,20.283A2,2,0,0,1,16.265,22H7.735A2,2,0,0,1,5.755,20.283ZM21,4H16V3a1,1,0,0,0-1-1H9A1,1,0,0,0,8,3V4H3A1,1,0,0,0,3,6H21a1,1,0,0,0,0-2Z'

interface ListSumRowCardProps {
  sumScope: SumRowMode
  items: ItemWithState[]
  members: MemberWithCreator[]
  itemTextWidth: number
  itemNameFontClassName: string
  itemNameFontStep?: number
  onCycleScope: () => void
  onRemove: () => void
  onClearAddItemDraft?: () => void
}

export function ListSumRowCard({
  sumScope,
  items,
  members,
  itemTextWidth,
  itemNameFontClassName,
  itemNameFontStep = ITEM_NAME_FONT_DEFAULT,
  onCycleScope,
  onRemove,
  onClearAddItemDraft,
}: ListSumRowCardProps) {
  const compactRow = members.length === 0
  const title = titleForMode(sumScope)
  const scoped = useMemo(() => itemsInScope(sumScope, items), [sumScope, items])

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

  const qtyTextClass = `${itemNameFontClassName} ${DEFAULT_ITEM.itemName}`

  return (
    <div
      className={compactRow ? 'block min-w-full w-max' : 'min-w-full'}
      onClick={onClearAddItemDraft}
    >
      <div className={`block min-w-full w-max rounded-lg transition-colors ${DEFAULT_ITEM.shell}`}>
        <div
          className={
            compactRow
              ? 'box-border flex min-w-full w-max flex-nowrap items-center gap-0.5 px-2 py-1 whitespace-nowrap'
              : 'box-border flex min-h-0 items-center gap-0.5 px-2 py-1 whitespace-nowrap'
          }
          style={{ height: itemRowHeightPx }}
        >
          <div
            className="w-5 flex-shrink-0 select-none text-lg tracking-tighter text-transparent"
            aria-hidden
          >
            ⋮⋮
          </div>

          <div
            className="relative flex-shrink-0 text-left"
            style={{ width: itemTextWidth }}
            dir="ltr"
          >
            <button
              type="button"
              className={`block w-full truncate text-left ${itemNameFontClassName} ${DEFAULT_ITEM.itemName} cursor-pointer hover:text-teal`}
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
                    className="relative box-border flex w-[90px] flex-shrink-0 cursor-default items-center justify-center rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-neutral-600 dark:bg-neutral-900"
                    style={{ height: memberCellPx }}
                  >
                    <span className={`max-w-full truncate text-center ${qtyTextClass}`}>{value}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          <div
            className={
              compactRow
                ? 'ml-auto flex flex-shrink-0 items-center justify-end gap-1 pl-2'
                : 'ml-auto flex flex-shrink-0 items-center justify-end gap-1 pl-4'
            }
          >
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                onRemove()
              }}
              className="px-2 py-1 text-lg leading-none text-red-500 hover:opacity-70 flex-shrink-0"
              title="Remove sum row"
              aria-label="Remove sum row"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d={ITEM_DELETE_ICON_PATH} />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
