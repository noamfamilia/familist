'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
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
import type { ItemCategory, CategoryNames } from '@/lib/supabase/types'

function saveErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return 'Failed to save categories'
}

export type CategoryNamesModalHandle = {
  saveAndClose: () => Promise<void>
}

interface CategoryNamesModalProps {
  isOpen: boolean
  onClose: () => void
  anchorPos: { top: number; left: number } | null
  anchorRef?: React.RefObject<HTMLElement | null>
  categoryNames: CategoryNames
  categoryOrder: number[]
  onSave: (
    names: CategoryNames,
    order: number[],
    options?: { reorderItems?: boolean },
  ) => Promise<{ error: unknown }>
  sortDisabled?: boolean
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
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
      <div className="flex-1 min-w-0 relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Add category name..."
          className="w-full bg-transparent text-sm text-inherit focus:outline-none placeholder:text-gray-400 placeholder:opacity-55 dark:placeholder:text-neutral-400 dark:placeholder:opacity-70 h-5 p-0 pr-5"
          maxLength={30}
        />
        {focused && value && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); inputRef.current?.focus() }}
            className="absolute right-0 top-1/2 -translate-y-1/2 text-current opacity-45 hover:opacity-80"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export const CategoryNamesModal = forwardRef<CategoryNamesModalHandle, CategoryNamesModalProps>(
  function CategoryNamesModal(
    {
      isOpen,
      onClose,
      anchorPos,
      anchorRef,
      categoryNames,
      categoryOrder,
      onSave,
      sortDisabled = false,
    },
    ref,
  ) {
    const { error: showError } = useToast()
    const [names, setNames] = useState<CategoryNames>({ ...categoryNames })
    const [order, setOrder] = useState<number[]>([...categoryOrder])
    const popoverRef = useRef<HTMLDivElement>(null)
    const wasOpenRef = useRef(false)
    const savingRef = useRef(false)

    const anchorPosStableRef = useRef(anchorPos)
    if (anchorPos) anchorPosStableRef.current = anchorPos
    const menuAnim = useMenuOpenAnimation(isOpen && !!anchorPosStableRef.current)

    useEffect(() => {
      if (isOpen && !wasOpenRef.current) {
        setNames({ ...categoryNames })
        setOrder([...categoryOrder])
      }
      wasOpenRef.current = isOpen
    }, [isOpen, categoryNames, categoryOrder])

    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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

    const handleDone = useCallback(async () => {
      if (savingRef.current) return
      savingRef.current = true
      try {
        const trimmed: CategoryNames = {}
        for (const [k, v] of Object.entries(names)) {
          trimmed[k] = v.trim()
        }
        const saveRes = await onSave(trimmed, order)
        if (saveRes.error) {
          const msg = saveErrorMessage(saveRes.error)
          if (shouldShowConnectivityRelatedMutationToast(msg)) {
            showError(msg || 'Failed to save categories', { serverError: saveRes.error })
          }
          return
        }
        onClose()
      } finally {
        savingRef.current = false
      }
    }, [names, onClose, onSave, order, showError])

    useImperativeHandle(ref, () => ({ saveAndClose: handleDone }), [handleDone])

    const handleSortClick = async () => {
      if (savingRef.current) return
      savingRef.current = true
      try {
        const trimmed: CategoryNames = {}
        for (const [k, v] of Object.entries(names)) {
          trimmed[k] = v.trim()
        }
        const saveRes = await onSave(trimmed, order, { reorderItems: true })
        if (saveRes.error) {
          const msg = saveErrorMessage(saveRes.error)
          if (shouldShowConnectivityRelatedMutationToast(msg)) {
            showError(msg || 'Failed to save categories', { serverError: saveRes.error })
          }
          return
        }
        onClose()
      } finally {
        savingRef.current = false
      }
    }

    useEffect(() => {
      if (!isOpen) return
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') void handleDone()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [handleDone, isOpen])

    useEffect(() => {
      if (!isOpen) return
      const onMouseDown = (e: MouseEvent) => {
        const target = e.target as Node
        if (popoverRef.current?.contains(target)) return
        if (anchorRef?.current?.contains(target)) return
        void handleDone()
      }
      document.addEventListener('mousedown', onMouseDown, true)
      return () => document.removeEventListener('mousedown', onMouseDown, true)
    }, [anchorRef, handleDone, isOpen])

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
        className={`fixed z-[10000] w-[240px] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40 ${menuAnim.menuClassName}`}
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-center text-sm font-semibold text-teal">Categories</p>
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
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => void handleSortClick()}
            disabled={sortDisabled}
            className="rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-white touch-manipulation hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sort list by Category
          </button>
        </div>
      </div>,
      document.body,
    )
  },
)

CategoryNamesModal.displayName = 'CategoryNamesModal'
