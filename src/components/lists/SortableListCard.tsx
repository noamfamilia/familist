'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ListCard } from './ListCard'
import type { CategoryNames, ListWithRole } from '@/lib/supabase/types'

interface SortableListCardProps {
  list: ListWithRole
  existingListNames: string[]
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string) => Promise<{ error: Error | null; warning?: string | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  onUpdateCategoryNames?: (listId: string, names: CategoryNames, order: number[]) => Promise<{ error: unknown }>
  onRefresh?: () => void
}

export function SortableListCard({ list, existingListNames, categoryNames, categoryOrder, onUpdate, onDelete, onArchive, onDuplicate, onLeave, onUpdateCategoryNames, onRefresh }: SortableListCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <ListCard
        list={list}
        existingListNames={existingListNames}
        categoryNames={categoryNames}
        categoryOrder={categoryOrder}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onArchive={onArchive}
        onDuplicate={onDuplicate}
        onLeave={onLeave}
        onUpdateCategoryNames={onUpdateCategoryNames}
        onRefresh={onRefresh}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}
