'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useToast } from '@/components/ui/Toast'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import { shouldShowConnectivityRelatedMutationToast } from '@/lib/mutationToastPolicy'
import { useMenuOpenAnimation } from '@/hooks/useMenuOpenAnimation'
import { areItemsSortedByCategory } from '@/lib/items/categoryItemReorder'
import type { ItemCategory, CategoryNames, ItemWithState } from '@/lib/supabase/types'

function saveErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return 'Failed to save categories'
}

interface CategoryNamesModalProps {
  isOpen: boolean
  onClose: () => void
  anchorPos: { top: number; left: number } | null
  popoverRef?: React.RefObject<HTMLDivElement | null>
  categoryNames: CategoryNames
  categoryOrder: number[]
  /** Active items for re-evaluating "Sort items" enablement after a category reorder. */
  items?: ItemWithState[]
  onRenameCategory: (catId: number, name: string) => Promise<{ error: unknown }>
  onReorderCategories: (order: number[]) => Promise<{ error: unknown }>
  onSortItems: () => Promise<{ error: unknown }>
  /** External force-disable (e.g. bulk delete/restore). Always honored. */
  sortDisabled?: boolean
}

function SortableCategoryCard({
  catId,
  label,
  onCardClick,
}: {
  catId: number
  label: string
  onCardClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: catId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`relative flex items-center overflow-hidden rounded-lg px-2 py-1 min-h-10 text-sm font-normal text-gray-900 dark:text-gray-100 hover:opacity-90 dark:hover:opacity-90 ${ITEM_CATEGORY_STYLES[catId as ItemCategory].modal}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onCardClick()
          }}
          className="min-w-0 flex-1 touch-manipulation text-left"
        >
          {label.trim() ? (
            <span className="block truncate">{label}</span>
          ) : (
            <span className="block truncate text-gray-400 dark:text-gray-500">Category name...</span>
          )}
        </button>
        <div
          className="ml-2 flex-shrink-0 cursor-grab select-none text-lg leading-none tracking-tighter opacity-50 hover:opacity-80 touch-none"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </div>
      </div>
    </div>
  )
}

export function CategoryNamesModal({
  isOpen,
  onClose,
  anchorPos,
  popoverRef,
  categoryNames,
  categoryOrder,
  items,
  onRenameCategory,
  onReorderCategories,
  onSortItems,
  sortDisabled = false,
}: CategoryNamesModalProps) {
  const { error: showError } = useToast()
  const [renamingCatId, setRenamingCatId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const actionRef = useRef(false)
  // Optimistic local copy of `categoryOrder` so the visual card order AND the "Sort items" disabled
  // state update the instant a drag completes, without waiting for the async parent persistence
  // to flush back through props. Stays in sync with the prop on external changes.
  const [localCategoryOrder, setLocalCategoryOrder] = useState<number[]>(categoryOrder)
  useEffect(() => {
    setLocalCategoryOrder((prev) => {
      if (prev.length === categoryOrder.length && prev.every((v, i) => v === categoryOrder[i])) {
        return prev
      }
      return categoryOrder
    })
  }, [categoryOrder])

  const anchorPosStableRef = useRef(anchorPos)
  if (anchorPos) anchorPosStableRef.current = anchorPos
  const menuAnim = useMenuOpenAnimation(isOpen && !!anchorPosStableRef.current)

  const itemsSortedByLocalOrder = useMemo(() => {
    if (!items || items.length === 0) return true
    return areItemsSortedByCategory(items, localCategoryOrder)
  }, [items, localCategoryOrder])
  // External override (e.g. bulk-delete in progress) still wins; otherwise we derive from the
  // current optimistic order so reordering cards re-evaluates immediately.
  const effectiveSortDisabled = sortDisabled || itemsSortedByLocalOrder

  useEffect(() => {
    if (!isOpen) {
      setRenamingCatId(null)
      setRenameText('')
    }
  }, [isOpen])

  useEffect(() => {
    if (renamingCatId == null) return
    const id = requestAnimationFrame(() => renameInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [renamingCatId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reportError = useCallback(
    (error: unknown, fallback: string) => {
      const msg = saveErrorMessage(error)
      if (shouldShowConnectivityRelatedMutationToast(msg)) {
        showError(msg || fallback, { serverError: error })
      }
    },
    [showError],
  )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = localCategoryOrder.indexOf(Number(active.id))
    const newIndex = localCategoryOrder.indexOf(Number(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = [...localCategoryOrder]
    const [removed] = next.splice(oldIndex, 1)
    next.splice(newIndex, 0, removed)
    if (actionRef.current) return
    actionRef.current = true
    const prevOrder = localCategoryOrder
    setLocalCategoryOrder(next)
    try {
      const res = await onReorderCategories(next)
      if (res.error) {
        // Revert optimistic order on failure so the visual / disabled state stays truthful.
        setLocalCategoryOrder(prevOrder)
        reportError(res.error, 'Failed to reorder categories')
      }
    } finally {
      actionRef.current = false
    }
  }

  const openRename = (catId: number) => {
    setRenamingCatId(catId)
    setRenameText(categoryNames[String(catId)] ?? '')
  }

  const cancelRename = () => {
    setRenamingCatId(null)
    setRenameText('')
  }

  const commitRename = async () => {
    if (renamingCatId == null || actionRef.current) return
    actionRef.current = true
    try {
      const res = await onRenameCategory(renamingCatId, renameText)
      if (res.error) {
        reportError(res.error, 'Failed to rename category')
        return
      }
      cancelRename()
    } finally {
      actionRef.current = false
    }
  }

  const handleSortClick = async () => {
    if (actionRef.current || effectiveSortDisabled) return
    actionRef.current = true
    try {
      const res = await onSortItems()
      if (res.error) reportError(res.error, 'Failed to sort items')
    } finally {
      actionRef.current = false
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingCatId != null) {
          e.preventDefault()
          e.stopPropagation()
          cancelRename()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, onClose, renamingCatId])

  if (!menuAnim.mounted || !anchorPosStableRef.current || typeof document === 'undefined') {
    return null
  }

  const pos = anchorPosStableRef.current

  return createPortal(
    <div
      ref={popoverRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Categories"
      className={`fixed z-[10000] w-[230px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${menuAnim.menuClassName}`}
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(e)}>
        <SortableContext items={localCategoryOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {localCategoryOrder.map((c) => (
              <div key={c} className="relative">
                <SortableCategoryCard
                  catId={c}
                  label={categoryNames[String(c)] ?? ''}
                  onCardClick={() => openRename(c)}
                />
                {renamingCatId === c && (
                  <div
                    className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 w-[216px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                      placeholder="Category name..."
                      maxLength={30}
                      className="w-full text-left text-sm border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
                      dir="ltr"
                      aria-label="Category name"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={cancelRename}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void commitRename()}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => void handleSortClick()}
          disabled={effectiveSortDisabled}
          className={`inline-flex min-h-10 touch-manipulation items-center justify-center rounded-lg px-4 text-sm font-medium ${
            effectiveSortDisabled
              ? 'text-white/75 bg-teal/35 cursor-not-allowed'
              : 'text-white bg-teal hover:opacity-80'
          }`}
        >
          Sort items
        </button>
      </div>
    </div>,
    document.body,
  )
}
