'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ItemCard } from './ItemCard'
import type { Item, ItemWithState, MemberWithCreator } from '@/lib/supabase/types'

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
}

export function SortableItemCard({ item, members, hideDone, hideNotRelevant, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, itemTextWidth, expandSignal, collapseSignal }: SortableItemCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
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
        isDraggable={true}
        itemTextWidth={itemTextWidth}
        expandSignal={expandSignal}
        collapseSignal={collapseSignal}
      />
    </div>
  )
}
