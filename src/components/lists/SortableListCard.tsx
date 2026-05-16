'use client'

import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ListCard } from './ListCard'
import { listCardModelEqual, sameStringList } from './listCardEquality'
import type { ListWithRole } from '@/lib/supabase/types'

interface SortableListCardProps {
  list: ListWithRole
  existingListNames: string[]
  onUpdate: (
    listId: string,
    updates: { name?: string; archived?: boolean; comment?: string | null },
  ) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string, label?: string) => Promise<{ error: Error | null; warning?: string | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  labels?: string[]
  onUpdateLabel?: (listId: string, label: string) => Promise<{ error: Error | null }>
  onSelectLabel?: (label: string) => void
  currentFilter?: string
  onClearCreateInput?: () => void
  onClearCreateInputIfTyped?: () => void
  isOfflineActionsDisabled?: boolean
  mutationUserId?: string | null
}

function sortableListCardPropsEqual(prev: SortableListCardProps, next: SortableListCardProps): boolean {
  return (
    listCardModelEqual(prev.list, next.list) &&
    sameStringList(prev.existingListNames, next.existingListNames) &&
    sameStringList(prev.labels, next.labels) &&
    (prev.currentFilter ?? 'Any') === (next.currentFilter ?? 'Any') &&
    prev.isOfflineActionsDisabled === next.isOfflineActionsDisabled &&
    (prev.mutationUserId ?? null) === (next.mutationUserId ?? null)
  )
}

function SortableListCardInner({
  list,
  existingListNames,
  onUpdate,
  onDelete,
  onArchive,
  onDuplicate,
  onLeave,
  labels,
  onUpdateLabel,
  onSelectLabel,
  currentFilter,
  onClearCreateInput,
  onClearCreateInputIfTyped,
  isOfflineActionsDisabled = false,
  mutationUserId = null,
}: SortableListCardProps) {
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
        dragHandleProps={{ ...attributes, ...listeners }}
        labels={labels}
        onUpdateLabel={onUpdateLabel}
        onSelectLabel={onSelectLabel}
        currentFilter={currentFilter}
        onClearCreateInput={onClearCreateInput}
        onClearCreateInputIfTyped={onClearCreateInputIfTyped}
        isOfflineActionsDisabled={isOfflineActionsDisabled}
        mutationUserId={mutationUserId}
      />
    </div>
  )
}

export const SortableListCard = memo(SortableListCardInner, sortableListCardPropsEqual)
