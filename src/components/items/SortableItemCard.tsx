'use client'

import { useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ItemCard } from './ItemCard'
import { isDragDebugEnabled } from '@/lib/dragDebug'
import { dragDebugPointerRef, recordDragSnap } from '@/lib/dragSnapDebugLog'
import type { CategoryNames, Item, ItemWithState, MemberWithCreator } from '@/lib/supabase/types'

interface SortableItemCardProps {
  item: ItemWithState
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onUpdateItem: (itemId: string, updates: Partial<Item>) => Promise<{ error?: { message: string } | null }>
  onDeleteItem: (itemId: string) => Promise<{ error?: Error | null }>
  onChangeQuantity: (itemId: string, memberId: string, delta: number) => Promise<{ error?: { message?: string } | null }>
  onUpdateMemberState: (itemId: string, memberId: string, updates: { quantity?: number; done?: boolean }) => Promise<{ error?: { message?: string } | null }>
  itemTextWidth?: number
  expandSignal?: number
  collapseSignal?: number
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  onClearAddItemDraft?: () => void
  itemNameFontClassName?: string
  itemNameFontStep?: number
  isOfflineActionsDisabled?: boolean
  allowItemMutationQueue?: boolean
  dragDebugSurface?: 'page' | 'home_modal'
  dragDebugItemsCount?: number
}

export function SortableItemCard({ item, members, hideDone, hideNotRelevant, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, itemTextWidth, expandSignal, collapseSignal, categoryNames, categoryOrder, onClearAddItemDraft, itemNameFontClassName, itemNameFontStep, isOfflineActionsDisabled = false, allowItemMutationQueue = false, dragDebugSurface, dragDebugItemsCount }: SortableItemCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isOfflineActionsDisabled })

  const wasDraggingRef = useRef(false)
  useEffect(() => {
    if (!isDragDebugEnabled() || !dragDebugSurface || dragDebugItemsCount == null) return
    const ptr = dragDebugPointerRef.current
    if (wasDraggingRef.current && !isDragging && ptr && ptr.buttons !== 0) {
      recordDragSnap({
        reason: 'isDragging_false_while_pointer_down',
        itemId: item.id,
        surface: dragDebugSurface,
        itemsCount: dragDebugItemsCount,
        transform,
      })
    }
    wasDraggingRef.current = isDragging
  }, [isDragging, transform, item.id, dragDebugSurface, dragDebugItemsCount])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-sortable-id={item.id}
      className={members.length === 0 ? 'block min-w-full w-max' : undefined}
    >
      <ItemCard
        item={item}
        members={members}
        hideDone={hideDone}
        hideNotRelevant={hideNotRelevant}
        onUpdateItem={onUpdateItem}
        onDeleteItem={onDeleteItem}
        onChangeQuantity={onChangeQuantity}
        onUpdateMemberState={onUpdateMemberState}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDraggable={!isOfflineActionsDisabled}
        itemTextWidth={itemTextWidth}
        expandSignal={expandSignal}
        collapseSignal={collapseSignal}
        categoryNames={categoryNames}
        categoryOrder={categoryOrder}
        onClearAddItemDraft={onClearAddItemDraft}
        itemNameFontClassName={itemNameFontClassName}
        itemNameFontStep={itemNameFontStep}
        isOfflineActionsDisabled={isOfflineActionsDisabled}
        allowItemMutationQueue={allowItemMutationQueue}
      />
    </div>
  )
}
