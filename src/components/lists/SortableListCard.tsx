'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ListCard } from './ListCard'
import type { ListWithRole } from '@/lib/supabase/types'

interface SortableListCardProps {
  list: ListWithRole
  existingListNames: string[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string, label?: string) => Promise<{ error: Error | null; warning?: string | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  onRefresh?: () => void
  labels?: string[]
  onUpdateLabel?: (listId: string, label: string) => Promise<{ error: Error | null }>
  onSelectLabel?: (label: string) => void
  currentFilter?: string
  onClearCreateInput?: () => void
}

export function SortableListCard({ list, existingListNames, onUpdate, onDelete, onArchive, onDuplicate, onLeave, onRefresh, labels, onUpdateLabel, onSelectLabel, currentFilter, onClearCreateInput }: SortableListCardProps) {
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
        onUpdate={onUpdate}
        onDelete={onDelete}
        onArchive={onArchive}
        onDuplicate={onDuplicate}
        onLeave={onLeave}
        onRefresh={onRefresh}
        dragHandleProps={{ ...attributes, ...listeners }}
        labels={labels}
        onUpdateLabel={onUpdateLabel}
        onSelectLabel={onSelectLabel}
        currentFilter={currentFilter}
        onClearCreateInput={onClearCreateInput}
      />
    </div>
  )
}
