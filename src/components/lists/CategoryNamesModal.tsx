'use client'

import { useState } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
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
  onChange,
}: {
  catId: number
  name: string
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
      className={`flex items-center rounded-lg px-3 py-2.5 ${ITEM_CATEGORY_STYLES[catId as ItemCategory].modal}`}
    >
      <div
        className="text-gray-400 cursor-grab select-none text-lg tracking-tighter touch-none mr-2 flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </div>
      <input
        type="text"
        value={name}
        onChange={e => onChange(e.target.value)}
        placeholder="<empty>"
        className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-gray-400/70"
        maxLength={30}
      />
    </div>
  )
}

export function CategoryNamesModal({ isOpen, onClose, categoryNames, categoryOrder, onSave }: CategoryNamesModalProps) {
  const [names, setNames] = useState<CategoryNames>({ ...categoryNames })
  const [order, setOrder] = useState<number[]>([...categoryOrder])
  const [saving, setSaving] = useState(false)

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

  const handleSave = async () => {
    setSaving(true)
    await onSave(names, order)
    setSaving(false)
    onClose()
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
                onChange={value => setNames(prev => ({ ...prev, [String(c)]: value }))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex justify-end mt-5">
        <Button type="button" onClick={handleSave} loading={saving}>
          Save
        </Button>
      </div>
    </Modal>
  )
}
