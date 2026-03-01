'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ItemCard } from './ItemCard'
import type { ItemWithState } from '@/hooks/useList'
import type { MemberWithCreator, Item } from '@/lib/supabase/types'

interface SortableItemCardProps {
  item: ItemWithState
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  onUpdateItem: (itemId: string, updates: Partial<Item>) => Promise<any>
  onDeleteItem: (itemId: string) => Promise<{ error?: Error | null }>
  onChangeQuantity: (itemId: string, memberId: string, delta: number) => Promise<any>
  onUpdateMemberState: (itemId: string, memberId: string, updates: { quantity?: number; done?: boolean }) => Promise<any>
}

export function SortableItemCard({ item, members, hideDone, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState }: SortableItemCardProps) {
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
        onUpdateItem={onUpdateItem}
        onDeleteItem={onDeleteItem}
        onChangeQuantity={onChangeQuantity}
        onUpdateMemberState={onUpdateMemberState}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDraggable={true}
      />
    </div>
  )
}
