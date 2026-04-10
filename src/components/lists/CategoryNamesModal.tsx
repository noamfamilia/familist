'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Modal } from '@/components/ui/Modal'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import type { ItemCategory, CategoryNames } from '@/lib/supabase/types'

interface CategoryNamesModalProps {
  isOpen: boolean
  onClose: () => void
  categoryNames: CategoryNames
  categoryOrder: number[]
  onSave: (names: CategoryNames, order: number[]) => Promise<{ error: unknown }>
}

function SortableCategoryRow({
  catId,
  name,
  isEditing,
  draftValue,
  onDraftChange,
  onTap,
}: {
  catId: number
  name: string
  isEditing: boolean
  draftValue: string
  onDraftChange: (value: string) => void
  onTap: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: catId })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isEditing])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center rounded-lg px-2 py-1 ${ITEM_CATEGORY_STYLES[catId as ItemCategory].modal}`}
      onClick={!isEditing ? onTap : undefined}
    >
      <div
        className="text-gray-400 cursor-grab select-none text-lg tracking-tighter touch-none mr-2 flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </div>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={draftValue}
          onChange={e => onDraftChange(e.target.value)}
          placeholder="<empty>"
          className="flex-1 bg-transparent text-sm text-black focus:outline-none placeholder:text-gray-400/70"
          maxLength={30}
        />
      ) : (
        <span className="flex-1 text-sm text-black truncate">
          {name || <span className="text-gray-400/70">&lt;empty&gt;</span>}
        </span>
      )}
    </div>
  )
}

export function CategoryNamesModal({ isOpen, onClose, categoryNames, categoryOrder, onSave }: CategoryNamesModalProps) {
  const [names, setNames] = useState<CategoryNames>({ ...categoryNames })
  const [order, setOrder] = useState<number[]>([...categoryOrder])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  // Re-sync from props when they change (e.g. realtime update from another session)
  useEffect(() => {
    if (editingId === null) {
      setNames({ ...categoryNames })
    }
  }, [categoryNames, editingId])

  useEffect(() => {
    setOrder([...categoryOrder])
  }, [categoryOrder])

  const namesRef = useRef(names)
  namesRef.current = names
  const orderRef = useRef(order)
  orderRef.current = order

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const persistNow = useCallback(
    (n: CategoryNames, o: number[]) => { onSave(n, o) },
    [onSave]
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = order.indexOf(Number(active.id))
      const newIndex = order.indexOf(Number(over.id))
      if (oldIndex !== -1 && newIndex !== -1) {
        const next = [...order]
        const [removed] = next.splice(oldIndex, 1)
        next.splice(newIndex, 0, removed)
        setOrder(next)
        persistNow(namesRef.current, next)
      }
    }
  }

  const startEditing = (catId: number) => {
    setEditingId(catId)
    setDraft(names[String(catId)] ?? '')
  }

  const commitEdit = () => {
    if (editingId === null) return
    const trimmed = draft.trim()
    const updated = { ...namesRef.current, [String(editingId)]: trimmed }
    setNames(updated)
    const changed = trimmed !== (categoryNames[String(editingId)] ?? '')
    setEditingId(null)
    setDraft('')
    if (changed) {
      persistNow(updated, orderRef.current)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingId === null) return
    if (e.key === 'Enter') commitEdit()
    else if (e.key === 'Escape') cancelEdit()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Set categories" size="xs">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onKeyDown={handleKeyDown}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {order.map(c => (
                <SortableCategoryRow
                  key={c}
                  catId={c}
                  name={names[String(c)] ?? ''}
                  isEditing={editingId === c}
                  draftValue={editingId === c ? draft : ''}
                  onDraftChange={setDraft}
                  onTap={() => startEditing(c)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {editingId !== null && (
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={cancelEdit}
              className="text-xs font-medium text-gray-500 bg-gray-200 rounded px-3 py-1 hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={commitEdit}
              className="text-xs font-medium text-white bg-teal rounded px-3 py-1 hover:opacity-80"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
