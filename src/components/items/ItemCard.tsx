'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import { shouldShowConnectivityRelatedMutationToast } from '@/lib/mutationToastPolicy'
import { useAuth } from '@/providers/AuthProvider'
import type { CategoryNames, Item, ItemCategory, ItemWithState, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORIES, normalizeItemCategory } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import { measureCategoryLabelChipWidthPx } from '@/lib/itemTextWidthFit'
import { QtyProgressBarIconVertical } from '@/components/items/QtyProgressBarIconVertical'
import {
  ITEM_NAME_FONT_DEFAULT,
  itemCardRowHeightWithMembersPx,
  itemMemberCellHeightPx,
  itemQtyProgressBarTrackHeightPx,
} from '@/lib/itemNameFontStep'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})

interface ItemCardProps {
  item: ItemWithState
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onUpdateItem: (itemId: string, updates: Partial<Item>) => Promise<{ error?: { message: string } | null }>
  onDeleteItem: (itemId: string) => Promise<{ error?: Error | null }>
  onChangeQuantity: (itemId: string, memberId: string, delta: number) => Promise<{ error?: { message?: string } | null }>
  onUpdateMemberState: (itemId: string, memberId: string, updates: { quantity?: number; done?: boolean; assigned?: boolean }) => Promise<{ error?: { message?: string } | null }>
  dragHandleProps?: Record<string, unknown>
  isDraggable?: boolean
  itemTextWidth?: number
  expandSignal?: number
  collapseSignal?: number
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  /** Clear the "add item" draft after a click on this card bubbles up (runs after child click handlers). */
  onClearAddItemDraft?: () => void
  /** Tailwind text size classes for the item title (aligned with list header font control). */
  itemNameFontClassName?: string
  /** Font step for row/cell/progress sizing (same delta as item name canvas px). */
  itemNameFontStep?: number
  /** When true, quantity and comment editing UI is hidden/disabled (e.g. offline). */
  isOfflineActionsDisabled?: boolean
}

/** Stroke check; short leg shortened (option 1) to reduce bleed when stacked */
const QTY_DONE_CHECK_PATH =
  'M6.25 14.95L8.23309 16.4248C8.66178 16.7463 9.26772 16.6728 9.60705 16.2581L18 6'

const QTY_CHECK_SIZE = 22
/** Offset between stacked checks’ right edges (px; smaller = tighter overlap) */
const QTY_CHECK_STACK_STEP = 4

function QtyTargetDoneChecks({ doneRatio, checkSizePx = QTY_CHECK_SIZE }: { doneRatio: number; checkSizePx?: number }) {
  const d = Math.min(1, Math.max(0, doneRatio))
  if (d <= 0) return null

  const sz = checkSizePx
  const stackStep = Math.max(2, Math.round(QTY_CHECK_STACK_STEP * (sz / QTY_CHECK_SIZE)))
  const baseSvg = 'text-coral pointer-events-none'
  const gridSlot =
    'col-start-1 row-start-1 z-20 justify-self-end self-center pr-0.5'

  if (d < 1 / 3) {
    return (
      <svg
        width={sz}
        height={sz}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label="Started on target quantity"
        className={`${gridSlot} ${baseSvg} block shrink-0 opacity-40`}
      >
        <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    )
  }

  if (d < 2 / 3) {
    return (
      <svg
        width={sz}
        height={sz}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label="At least one third of target quantity completed"
        className={`${gridSlot} ${baseSvg} block shrink-0 opacity-40`}
      >
        <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  if (d < 1) {
    const w = sz + stackStep
    return (
      <div
        role="img"
        aria-label="At least two thirds of target quantity completed"
        className={`${gridSlot} relative shrink-0`}
        style={{ width: w, height: sz }}
      >
        <svg
          width={sz}
          height={sz}
          viewBox="0 0 24 24"
          fill="none"
          className={`${baseSvg} absolute top-0 block shrink-0 opacity-40`}
          style={{ right: 0 }}
          aria-hidden
        >
          <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <svg
          width={sz}
          height={sz}
          viewBox="0 0 24 24"
          fill="none"
          className={`${baseSvg} absolute top-0 block shrink-0 opacity-60`}
          style={{ right: stackStep }}
          aria-hidden
        >
          <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    )
  }

  const w3 = sz + 2 * stackStep
  return (
    <div
      role="img"
      aria-label="Target quantity fully completed"
      className={`${gridSlot} relative shrink-0`}
      style={{ width: w3, height: sz }}
    >
      <svg
        width={sz}
        height={sz}
        viewBox="0 0 24 24"
        fill="none"
        className={`${baseSvg} absolute top-0 block shrink-0 opacity-40`}
        style={{ right: 0 }}
        aria-hidden
      >
        <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <svg
        width={sz}
        height={sz}
        viewBox="0 0 24 24"
        fill="none"
        className={`${baseSvg} absolute top-0 block shrink-0 opacity-60`}
        style={{ right: stackStep }}
        aria-hidden
      >
        <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <svg
        width={sz}
        height={sz}
        viewBox="0 0 24 24"
        fill="none"
        className={`${baseSvg} absolute top-0 block shrink-0 opacity-80`}
        style={{ right: 2 * stackStep }}
        aria-hidden
      >
        <path d={QTY_DONE_CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export function ItemCard({ item, members, hideDone, hideNotRelevant, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, dragHandleProps, isDraggable = true, itemTextWidth = 80, expandSignal = 0, collapseSignal = 0, categoryNames, categoryOrder, onClearAddItemDraft, itemNameFontClassName = 'text-lg leading-snug', itemNameFontStep = ITEM_NAME_FONT_DEFAULT, isOfflineActionsDisabled = false }: ItemCardProps) {
  const { user } = useAuth()
  const { error: showError } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [comment, setComment] = useState(item.comment || '')
  const [editingComment, setEditingComment] = useState(false)
  const [draftComment, setDraftComment] = useState('')
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const renamePopoverRef = useRef<HTMLDivElement>(null)
  const commentPopoverRef = useRef<HTMLDivElement>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Sync comment state when item updates from realtime
  useEffect(() => {
    setComment(item.comment || '')
  }, [item.comment])

  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [editingQuantityMember, setEditingQuantityMember] = useState<string | null>(null)
  const [editQuantityValue, setEditQuantityValue] = useState('')
  const quantityEditorRef = useRef<HTMLDivElement>(null)
  const [editorPos, setEditorPos] = useState<{ top: number; left: number } | null>(null)
  const EDITOR_WIDTH = 200
  const EDGE_GUARD = 12


  // Sync editText with item.text when not editing (handles server updates/reverts)
  useEffect(() => {
    if (!isEditing) {
      setEditText(item.text)
    }
  }, [item.text, isEditing])

  useEffect(() => {
    if (expandSignal > 0) setShowMenu(true)
  }, [expandSignal])

  useEffect(() => {
    if (collapseSignal > 0) setShowMenu(false)
  }, [collapseSignal])

  useEffect(() => {
    if (!editingQuantityMember) return
    const handleClickOutside = (e: MouseEvent) => {
      if (quantityEditorRef.current && !quantityEditorRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        setEditingQuantityMember(null)
        setEditQuantityValue('')
        setEditorPos(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [editingQuantityMember])

  // Outside-click: cancel rename
  useEffect(() => {
    if (!isEditing) return
    const handleMouseDown = (e: MouseEvent) => {
      if (renamePopoverRef.current && !renamePopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        handleCancelEditText()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  useEffect(() => {
    if (!isOfflineActionsDisabled || !editingComment) return
    setDraftComment(comment)
    setEditingComment(false)
  }, [isOfflineActionsDisabled, editingComment, comment])

  // Outside-click: cancel comment
  useEffect(() => {
    if (!editingComment) return
    const handleMouseDown = (e: MouseEvent) => {
      if (commentPopoverRef.current && !commentPopoverRef.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        document.addEventListener('click', (ce) => { ce.preventDefault(); ce.stopPropagation() }, { capture: true, once: true })
        handleCancelComment()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  // Focus and select name input on edit
  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditing])

  // Focus and auto-grow comment textarea on open
  useEffect(() => {
    if (editingComment && commentRef.current) {
      commentRef.current.focus()
      autoGrow(commentRef.current)
    }
  }, [editingComment, autoGrow])

  const category = normalizeItemCategory(item.category)
  const categoryTitle = categoryNames?.[String(category)]?.trim() ?? ''
  const [categoryLabelChipWidthPx, setCategoryLabelChipWidthPx] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (members.length > 0) {
      setCategoryLabelChipWidthPx(null)
      return
    }
    if (!categoryTitle) {
      setCategoryLabelChipWidthPx(null)
      return
    }
    setCategoryLabelChipWidthPx(measureCategoryLabelChipWidthPx(categoryTitle))
  }, [members.length, categoryTitle, category])

  const shouldHide = members.some(member => {
    if (member.is_target) return false
    const state = item.memberStates[member.id]
    const done = state?.done || false
    const assigned = state?.assigned || false
    
    if (hideDone[member.id] && done) return true
    if (hideNotRelevant[member.id] && !assigned) return true
    
    return false
  })

  const compactRow = members.length === 0

  const itemRowHeightPx = useMemo(() => itemCardRowHeightWithMembersPx(itemNameFontStep), [itemNameFontStep])
  const memberCellPx = useMemo(() => itemMemberCellHeightPx(itemNameFontStep), [itemNameFontStep])
  const qtyProgressTrackPx = useMemo(() => itemQtyProgressBarTrackHeightPx(itemNameFontStep), [itemNameFontStep])
  const qtyDoneCheckPx = useMemo(
    () => Math.min(QTY_CHECK_SIZE, Math.max(12, Math.floor(memberCellPx - 6))),
    [memberCellPx],
  )

  if (shouldHide) return null

  const handleCancelEditText = () => {
    setEditText(item.text)
    setIsEditing(false)
    nameInputRef.current?.blur()
  }

  const handleClearText = () => {
    setEditText('')
    nameInputRef.current?.focus()
  }

  const handleSaveText = () => {
    if (editText.trim() && editText !== item.text) {
      const trimmed = editText.trim()
      setIsEditing(false)
      void onUpdateItem(item.id, { text: trimmed }).then(({ error }) => {
        if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
          showError(error.message || 'Failed to rename item')
        }
      })
      return
    }
    setIsEditing(false)
  }

  const handleAssign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: true })
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to assign')
    }
  }

  const handleMarkDone = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { done: true })
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to mark done')
    }
  }

  const handleUnassign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: false, done: false })
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to unassign')
    }
  }

  const handleOpenQuantityEditor = (memberId: string, containerEl: HTMLElement) => {
    if (isOfflineActionsDisabled) return
    const m = members.find(x => x.id === memberId)
    if (!m) return
    const canEditMember = m.created_by === user?.id || m.is_public
    if (!canEditMember || item.archived) return

    const state = item.memberStates[memberId]
    const rect = containerEl.getBoundingClientRect()
    const vw = window.innerWidth
    const top = rect.bottom + 4
    const centerLeft = rect.left + rect.width / 2 - EDITOR_WIDTH / 2
    let left: number
    if (centerLeft >= EDGE_GUARD && centerLeft + EDITOR_WIDTH + EDGE_GUARD <= vw) {
      left = centerLeft
    } else if (centerLeft < EDGE_GUARD) {
      left = EDGE_GUARD
    } else {
      left = vw - EDITOR_WIDTH - EDGE_GUARD
    }
    setEditorPos({ top, left })
    setEditingQuantityMember(memberId)
    setEditQuantityValue(String(state?.quantity || 1))
  }

  const handleSaveQuantity = (memberId: string) => {
    const minQty = 1
    const trimmed = editQuantityValue.trim()
    if (trimmed === '') {
      showError('Enter a whole number quantity')
      return
    }
    const newQuantity = Number(trimmed)
    if (!Number.isFinite(newQuantity) || !Number.isInteger(newQuantity)) {
      showError('Enter a whole number quantity')
      return
    }
    if (newQuantity < minQty) {
      showError(`Quantity must be at least ${minQty}`)
      return
    }

    setEditingQuantityMember(null)
    setEditQuantityValue('')
    setEditorPos(null)

    void onUpdateMemberState(item.id, memberId, { quantity: newQuantity, assigned: true }).then(({ error }) => {
      if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
        showError(error.message || 'Failed to update quantity')
      }
    })
  }

  const handleCancelQuantityEdit = () => {
    setEditingQuantityMember(null)
    setEditQuantityValue('')
    setEditorPos(null)
  }

  const handleClearQuantity = () => {
    setEditQuantityValue('')
  }

  const handleArchive = async () => {
    const { error } = item.archived
      ? await onUpdateItem(item.id, { archived: false, archived_at: null })
      : await onUpdateItem(item.id, { archived: true, archived_at: new Date().toISOString() })

    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || `Failed to ${item.archived ? 'restore' : 'archive'} item`)
    }
  }

  const handleStartEditComment = () => {
    if (isOfflineActionsDisabled) return
    setDraftComment(comment)
    setEditingComment(true)
  }

  const handleSaveComment = async () => {
    const trimmed = draftComment.trim()
    setComment(trimmed)
    setEditingComment(false)
    const { error } = await onUpdateItem(item.id, { comment: trimmed || null })
    if (error) {
      if (shouldShowConnectivityRelatedMutationToast(error.message)) {
        showError(error.message || 'Failed to save comment')
      }
      setComment(item.comment || '')
    }
  }

  const handleCancelComment = () => {
    setDraftComment(comment)
    setEditingComment(false)
  }

  const handleClearComment = () => {
    setDraftComment('')
    if (commentRef.current) {
      commentRef.current.style.height = 'auto'
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    const { error } = await onDeleteItem(item.id)
    if (error) {
      const msg = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: string }).message) : ''
      if (shouldShowConnectivityRelatedMutationToast(msg)) {
        showError('Failed to delete item')
      }
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const hasComment = item.comment && item.comment.trim().length > 0
  const shellClass = ITEM_CATEGORY_STYLES[category].shell
  const itemNameColorClass = item.archived ? '' : ITEM_CATEGORY_STYLES[category].itemName

  const handlePickCategory = async (next: ItemCategory) => {
    if (next === category) return
    const { error } = await onUpdateItem(item.id, { category: next })
    if (error && shouldShowConnectivityRelatedMutationToast(error.message)) {
      showError(error.message || 'Failed to update category')
    }
  }

  return (
    <div
      className={compactRow ? 'block min-w-full w-max' : 'min-w-full'}
      onClick={onClearAddItemDraft}
    >
      {/* Main card content — min-w-full w-max matches list column: at least shell width, grows with wide rows */}
      <div
        className={`block min-w-full w-max rounded-lg transition-colors ${shellClass} ${item.archived ? 'opacity-60' : ''}`}
      >
        {/* Card row */}
        <div
          className={
            compactRow
              ? 'box-border flex min-w-full w-max flex-nowrap items-center gap-0.5 px-2 py-1 whitespace-nowrap'
              : 'box-border flex min-h-0 items-center gap-0.5 px-2 py-1 whitespace-nowrap'
          }
          style={{ height: itemRowHeightPx }}
          data-tour="item-row"
        >
        {/* Drag handle - only shown for draggable (active) items */}
        <div 
          className={`w-5 text-gray-400 dark:text-gray-500 select-none text-lg tracking-tighter touch-none flex-shrink-0 ${isDraggable ? 'cursor-grab' : ''}`}
          {...(isDraggable ? dragHandleProps : {})}
          data-tour="drag-handle"
        >
          {isDraggable ? '⋮⋮' : ''}
        </div>

        {/* Item name - click to toggle archive (collapsed) or rename (expanded) */}
        <div
          className="relative flex-shrink-0 text-left"
          style={{ width: itemTextWidth }}
          dir="ltr"
          data-tour="item-name"
        >
          {showMenu ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                setEditText(item.text)
                setIsEditing(true)
              }}
              className={`flex items-center gap-1 ${itemNameFontClassName} ${itemNameColorClass} cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
              data-tour="item-archive"
            >
              <span className="truncate">{item.text}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-40">
                <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
              </svg>
            </span>
          ) : (
            <span
              onClick={handleArchive}
              className={`block truncate ${itemNameFontClassName} ${itemNameColorClass} cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
              title={`Click to ${item.archived ? 'restore' : 'archive'}: ${item.text}`}
              data-tour="item-archive"
            >
              {item.text}
            </span>
          )}
          {isEditing && (
            <div
              ref={renamePopoverRef}
              className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2 w-[200px]"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={nameInputRef}
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveText()
                  if (e.key === 'Escape') handleCancelEditText()
                }}
                className="w-full text-left text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
                dir="ltr"
                aria-label="Item name"
                autoFocus
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleCancelEditText()}
                  className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void handleSaveText()}
                  className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Per-member controls - aligned under header */}
        {members.length > 0 ? (
        <div 
          className="flex items-center ml-2.5 flex-shrink-0 gap-2.5"
          data-tour="item-state"
        >
          {members.map(member => {
            if (member.is_target) {
              const targetQty = item.memberStates[member.id]?.quantity || 1
              const nonTargetMembers = members.filter(m => !m.is_target)
              let totalQty = 0
              let totalDoneQty = 0
              for (const m of nonTargetMembers) {
                const s = item.memberStates[m.id]
                if (s?.assigned) {
                  totalQty += s.quantity || 0
                  if (s.done) totalDoneQty += s.quantity || 0
                }
              }
              const isCreator = member.created_by === user?.id
              const canEdit = isCreator || member.is_public
              const isEditingThis = editingQuantityMember === member.id
              const doneRatio = targetQty <= 0 ? 0 : Math.min(1, totalDoneQty / targetQty)
              const qtyFillRatio = targetQty <= 0 ? 1 : Math.min(totalQty / targetQty, 1)

              return (
                <div key={member.id} className="relative">
                  <div
                    data-state-container
                    className={`relative grid w-[90px] grid-cols-1 grid-rows-1 overflow-hidden rounded-lg border border-gray-200 bg-white px-0 transition-colors dark:border-neutral-600 dark:bg-neutral-900 ${item.archived ? 'cursor-default opacity-50' : !canEdit || isOfflineActionsDisabled ? 'cursor-default' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800'}`}
                    style={{ height: memberCellPx }}
                    onClick={(e) => {
                      if (!canEdit || item.archived || isOfflineActionsDisabled) return
                      e.stopPropagation()
                      const container = e.currentTarget as HTMLElement
                      handleOpenQuantityEditor(member.id, container)
                    }}
                  >
                    <span
                      className={`pointer-events-none col-start-1 row-start-1 z-0 flex h-full w-full items-center justify-center truncate ${itemNameFontClassName} ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
                    >
                      {targetQty}
                    </span>
                    <div className="pointer-events-none col-start-1 row-start-1 z-10 flex h-full w-[33px] items-center justify-center justify-self-start">
                      <QtyProgressBarIconVertical ratio={qtyFillRatio} className="w-full shrink-0" trackHeightPx={qtyProgressTrackPx} />
                    </div>
                    <QtyTargetDoneChecks doneRatio={doneRatio} checkSizePx={qtyDoneCheckPx} />
                  </div>

                  {isEditingThis && editorPos && (
                    <div ref={quantityEditorRef} className="fixed bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-600 rounded-lg shadow-lg dark:shadow-black/40 p-2 z-50 w-[200px]" style={{ top: editorPos.top, left: editorPos.left }}>
                      <input
                        type="number"
                        value={editQuantityValue}
                        onChange={(e) => setEditQuantityValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveQuantity(member.id)
                          if (e.key === 'Escape') handleCancelQuantityEdit()
                        }}
                        className="w-full text-center text-lg border border-cyan rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-cyan/20"
                        autoFocus
                        min="1"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleCancelQuantityEdit()}
                          className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void handleSaveQuantity(member.id)}
                          className="flex-1 px-1 py-1 text-xs text-white rounded bg-cyan hover:opacity-80"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            }

            const state = item.memberStates[member.id]
            const quantity = state?.quantity || 1
            const done = state?.done || false
            const assigned = state?.assigned || false
            const isCreator = member.created_by === user?.id
            const canEdit = isCreator || member.is_public
            const isEditingThis = editingQuantityMember === member.id

            return (
              <div key={member.id} className="relative">
                <div
                  data-state-container
                  className={`box-border flex items-center justify-center px-2 py-1 rounded-lg border border-gray-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 w-[90px] transition-colors ${!canEdit || item.archived ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-800'}`}
                  style={{ height: memberCellPx }}
                  onClick={() => {
                    if (!canEdit || isEditingThis || item.archived) return
                    if (!assigned) {
                      void handleAssign(member.id)
                    } else if (!done) {
                      void handleMarkDone(member.id)
                    } else {
                      void handleUnassign(member.id)
                    }
                  }}
                >
                  {!assigned ? (
                    <svg width="18" height="18" viewBox="-0.5 0 25 25" fill="none" className="text-gray-400 dark:text-gray-500">
                      <path d="M3 21.32L21 3.32001" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 3.32001L21 21.32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : done ? (
                    <>
                      <span className="text-xs text-gray-400 dark:text-gray-500 absolute left-1.5 top-1/2 -translate-y-1/2">{quantity}</span>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-coral opacity-80">
                        <path d="M5 14L8.23309 16.4248C8.66178 16.7463 9.26772 16.6728 9.60705 16.2581L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </>
                  ) : (
                    <>
                      <span
                        className={`flex-1 text-center truncate ${itemNameFontClassName} ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
                      >
                        {quantity}
                      </span>
                      {!isOfflineActionsDisabled ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            const container = (e.currentTarget as HTMLElement).closest('[data-state-container]') as HTMLElement
                            if (canEdit && !item.archived && container) handleOpenQuantityEditor(member.id, container)
                          }}
                          className="flex-shrink-0 p-0.5 text-gray-400 dark:text-gray-500 hover:text-teal"
                          aria-label="Edit quantity"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                          </svg>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>

                {isEditingThis && editorPos && (
                  <div ref={quantityEditorRef} className="fixed bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-600 rounded-lg shadow-lg dark:shadow-black/40 p-2 z-50 w-[200px]" style={{ top: editorPos.top, left: editorPos.left }}>
                    <input
                      type="number"
                      value={editQuantityValue}
                      onChange={(e) => setEditQuantityValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveQuantity(member.id)
                        if (e.key === 'Escape') handleCancelQuantityEdit()
                      }}
                      className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
                      autoFocus
                      min="1"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCancelQuantityEdit()}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void handleSaveQuantity(member.id)}
                        className="flex-1 px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        ) : null}

        {/* Trailing section — ml-auto pins icons to the right when the row is full width */}
        <div
          className={
            compactRow
              ? 'ml-auto flex flex-shrink-0 items-center justify-end gap-1 pl-2'
              : 'ml-auto flex flex-shrink-0 items-center justify-end gap-1 pl-4'
          }
        >
          {/* Comment indicator - hidden when expanded */}
          {hasComment && !showMenu && (
            <span className="text-teal text-sm opacity-80" title="Has comment">💬</span>
          )}

          {/* Delete icon - only when expanded */}
          {showMenu && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(true)
                setShowMenu(false)
              }}
              className="text-red-500 hover:opacity-70 px-2 py-1 text-lg leading-none flex-shrink-0"
              title="Delete item"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.755,20.283,4,8H20L18.245,20.283A2,2,0,0,1,16.265,22H7.735A2,2,0,0,1,5.755,20.283ZM21,4H16V3a1,1,0,0,0-1-1H9A1,1,0,0,0,8,3V4H3A1,1,0,0,0,3,6H21a1,1,0,0,0,0-2Z"/>
              </svg>
            </button>
          )}

          {/* Category name label (non-empty names only); per-item width when no member columns */}
          {categoryTitle ? (
            members.length > 0 ? (
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[60px]">
                {categoryTitle}
              </span>
            ) : (
              <span
                className="inline-block whitespace-nowrap text-[10px] text-gray-400 dark:text-gray-500 truncate align-middle"
                style={
                  categoryLabelChipWidthPx != null
                    ? { width: `${categoryLabelChipWidthPx}px`, maxWidth: 200 }
                    : { maxWidth: 60 }
                }
                title={categoryTitle}
              >
                {categoryTitle}
              </span>
            )
          ) : null}

          {/* Kebab menu button */}
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 text-lg leading-none flex-shrink-0"
            title="More options"
            data-tour="item-menu"
          >
            {showMenu ? '✕' : '⋮'}
          </button>
        </div>
        </div>

        {/* Expanded menu with comment field and action buttons */}
        {showMenu && (
          <div className={`px-3 py-2 bg-transparent space-y-2 rounded-b-lg${compactRow ? ' min-w-full' : ''}`}>
            {/* Comment display / editor */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              {comment ? (
                <p
                  className={`text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words ${isOfflineActionsDisabled ? 'cursor-default' : 'cursor-pointer hover:text-teal'}`}
                  onClick={() => handleStartEditComment()}
                >
                  {comment}
                  {!isOfflineActionsDisabled ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline-block ml-1 opacity-40 align-text-bottom" aria-hidden>
                      <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                    </svg>
                  ) : null}
                </p>
              ) : (
                <p
                  className={`text-sm text-gray-400 dark:text-gray-500 ${isOfflineActionsDisabled ? 'cursor-default' : 'cursor-pointer hover:text-teal'}`}
                  onClick={() => handleStartEditComment()}
                >
                  Add a comment...
                </p>
              )}
              {editingComment && (
                <div
                  ref={commentPopoverRef}
                  className="absolute left-0 right-0 top-0 z-50 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-600 shadow-lg dark:shadow-black/40 p-2"
                >
                  <textarea
                    ref={commentRef}
                    rows={1}
                    value={draftComment}
                    onChange={(e) => { setDraftComment(e.target.value); autoGrow(e.target) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') handleCancelComment()
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-teal rounded-lg focus:outline-none focus:ring-2 focus:ring-teal/20 resize-none overflow-hidden mb-2"
                    placeholder="Add a comment..."
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleCancelComment()}
                      className="w-[80px] px-1 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleClearComment()}
                      className="w-[80px] px-1 py-1 text-xs text-white rounded bg-cyan hover:opacity-80"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSaveComment()}
                      className="w-[80px] px-1 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* Category 1–6 labeled rectangles — grid keeps all buttons equal width */}
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Item category">
              {(categoryOrder || ITEM_CATEGORIES).map(c => {
                const catId = c as ItemCategory
                const label = categoryNames?.[String(catId)] || ''
                return (
                  <button
                    key={catId}
                    type="button"
                    aria-label={`Category ${catId}`}
                    aria-pressed={catId === category}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void handlePickCategory(catId)
                    }}
                    className={`h-7 px-2 rounded-md touch-manipulation transition-shadow flex items-center justify-center text-xs leading-none overflow-hidden ${ITEM_CATEGORY_STYLES[catId].swatch} ${
                      catId === category
                        ? 'ring-2 ring-teal ring-offset-1 ring-offset-white shadow-sm font-semibold text-primary dark:ring-transparent dark:ring-offset-0 dark:outline-2 dark:outline-current'
                        : 'text-gray-500 hover:opacity-90 dark:hover:opacity-90'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Item"
        message={
          members.length === 0
            ? `Delete "${item.text}"?`
            : `Delete "${item.text}"? This will also remove all member quantities and states for this item.`
        }
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}
