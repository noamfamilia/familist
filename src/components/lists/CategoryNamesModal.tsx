'use client'

import { useState, useRef, useEffect } from 'react'
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
  value,
  onChange,
}: {
  catId: number
  value: string
  onChange: (value: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: catId })

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
    >
      <div
        className="text-gray-400 dark:text-gray-500 cursor-grab select-none text-lg tracking-tighter touch-none mr-2 flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </div>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Add category name..."
        className="flex-1 min-w-0 bg-transparent text-sm text-black focus:outline-none placeholder:text-gray-400 h-5 p-0"
        maxLength={30}
      />
    </div>
  )
}

export function CategoryNamesModal({ isOpen, onClose, categoryNames, categoryOrder, onSave }: CategoryNamesModalProps) {
  const [names, setNames] = useState<CategoryNames>({ ...categoryNames })
  const [order, setOrder] = useState<number[]>([...categoryOrder])

  const initialNamesRef = useRef(categoryNames)
  const initialOrderRef = useRef(categoryOrder)

  // Snapshot initial values when modal opens
  useEffect(() => {
    if (isOpen) {
      setNames({ ...categoryNames })
      setOrder([...categoryOrder])
      initialNamesRef.current = categoryNames
      initialOrderRef.current = categoryOrder
    }
  }, [isOpen, categoryNames, categoryOrder])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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
      }
    }
  }

  const handleDone = () => {
    const trimmed: CategoryNames = {}
    for (const [k, v] of Object.entries(names)) {
      trimmed[k] = v.trim()
    }
    onSave(trimmed, order)
    onClose()
  }

  const handleCancel = () => {
    setNames({ ...initialNamesRef.current })
    setOrder([...initialOrderRef.current])
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleDone} size="xs" hideClose>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Set Categories</h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {order.map(c => (
                <SortableCategoryRow
                  key={c}
                  catId={c}
                  value={names[String(c)] ?? ''}
                  onChange={v => setNames(prev => ({ ...prev, [String(c)]: v }))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </Modal>
  )
}
