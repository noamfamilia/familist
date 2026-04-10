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
  onTap,
  onCommit,
  onCancel,
}: {
  catId: number
  name: string
  isEditing: boolean
  onTap: () => void
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: catId })
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(name)

  useEffect(() => {
    if (isEditing) {
      setDraft(name)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isEditing, name])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center rounded-lg px-3 py-2.5 ${ITEM_CATEGORY_STYLES[catId as ItemCategory].modal}`}
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
        <div className="flex-1 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommit(draft)
              else if (e.key === 'Escape') onCancel()
            }}
            onBlur={onCancel}
            placeholder="<empty>"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-gray-400/70"
            maxLength={30}
          />
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => onCommit(draft)}
            className="text-xs font-medium text-white bg-white/20 rounded px-2 py-0.5 hover:bg-white/30 flex-shrink-0"
          >
            Done
          </button>
        </div>
      ) : (
        <span className="flex-1 text-sm text-gray-200 truncate">
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

  const handleCommitName = (catId: number, value: string) => {
    const trimmed = value.trim()
    const updated = { ...namesRef.current, [String(catId)]: trimmed }
    setNames(updated)
    setEditingId(null)
    if (trimmed !== (categoryNames[String(catId)] ?? '')) {
      persistNow(updated, orderRef.current)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Category Names" size="sm">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {order.map(c => (
              <SortableCategoryRow
                key={c}
                catId={c}
                name={names[String(c)] ?? ''}
                isEditing={editingId === c}
                onTap={() => setEditingId(c)}
                onCommit={value => handleCommitName(c, value)}
                onCancel={() => setEditingId(null)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </Modal>
  )
}
