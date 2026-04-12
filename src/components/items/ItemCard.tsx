'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/providers/AuthProvider'
import type { CategoryNames, Item, ItemCategory, ItemWithState, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORIES, normalizeItemCategory } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'

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
}

export function ItemCard({ item, members, hideDone, hideNotRelevant, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, dragHandleProps, isDraggable = true, itemTextWidth = 80, expandSignal = 0, collapseSignal = 0, categoryNames, categoryOrder }: ItemCardProps) {
  const { user } = useAuth()
  const { error: showError } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [comment, setComment] = useState(item.comment || '')
  const [editingComment, setEditingComment] = useState(false)
  const [draftComment, setDraftComment] = useState('')
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
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
        setEditingQuantityMember(null)
        setEditQuantityValue('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editingQuantityMember])

  // Check if item should be hidden based on member filters
  const shouldHide = members.some(member => {
    const state = item.memberStates[member.id]
    const done = state?.done || false
    const assigned = state?.assigned || false
    
    if (hideDone[member.id] && done) return true
    if (hideNotRelevant[member.id] && !assigned) return true
    
    return false
  })

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

  const handleSaveText = async () => {
    if (editText.trim() && editText !== item.text) {
      const { error } = await onUpdateItem(item.id, { text: editText.trim() })
      if (error) {
        showError(error.message || 'Failed to rename item')
        setEditText(item.text) // Revert to original
      }
    }
    setIsEditing(false)
  }

  const handleAssign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: true })
    if (error) showError(error.message || 'Failed to assign')
  }

  const handleMarkDone = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { done: true })
    if (error) showError(error.message || 'Failed to mark done')
  }

  const handleUnassign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: false, done: false })
    if (error) showError(error.message || 'Failed to unassign')
  }

  const handleOpenQuantityEditor = (memberId: string) => {
    const state = item.memberStates[memberId]
    setEditingQuantityMember(memberId)
    setEditQuantityValue(String(state?.quantity || 1))
  }

  const handleSaveQuantity = async (memberId: string) => {
    const newQuantity = parseInt(editQuantityValue, 10)
    if (!isNaN(newQuantity) && newQuantity >= 1) {
      const { error } = await onUpdateMemberState(item.id, memberId, { quantity: newQuantity, assigned: true })
      if (error) showError(error.message || 'Failed to update quantity')
    }
    setEditingQuantityMember(null)
    setEditQuantityValue('')
  }

  const handleCancelQuantityEdit = () => {
    setEditingQuantityMember(null)
    setEditQuantityValue('')
  }

  const handleClearQuantity = () => {
    setEditQuantityValue('')
  }

  const handleArchive = async () => {
    const { error } = item.archived
      ? await onUpdateItem(item.id, { archived: false, archived_at: null })
      : await onUpdateItem(item.id, { archived: true, archived_at: new Date().toISOString() })

    if (error) {
      showError(error.message || `Failed to ${item.archived ? 'restore' : 'archive'} item`)
    }
  }

  const handleStartEditComment = () => {
    setDraftComment(comment)
    setEditingComment(true)
  }

  const handleSaveComment = async () => {
    const trimmed = draftComment.trim()
    setComment(trimmed)
    setEditingComment(false)
    commentRef.current?.blur()
    const { error } = await onUpdateItem(item.id, { comment: trimmed || null })
    if (error) {
      showError(error.message || 'Failed to save comment')
      setComment(item.comment || '')
    }
  }

  const handleCancelComment = () => {
    setDraftComment(comment)
    setEditingComment(false)
    commentRef.current?.blur()
    requestAnimationFrame(() => {
      if (commentRef.current) {
        commentRef.current.style.height = 'auto'
        commentRef.current.style.height = commentRef.current.scrollHeight + 'px'
      }
    })
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
      showError('Failed to delete item')
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const hasComment = item.comment && item.comment.trim().length > 0
  const category = normalizeItemCategory(item.category)
  const shellClass = ITEM_CATEGORY_STYLES[category].shell

  const handlePickCategory = async (next: ItemCategory) => {
    if (next === category) return
    const { error } = await onUpdateItem(item.id, { category: next })
    if (error) {
      showError(error.message || 'Failed to update category')
    }
  }

  return (
    <div className="min-w-full">
      {/* Main card content */}
      <div className={`rounded-lg transition-colors ${shellClass} ${item.archived ? 'opacity-60' : ''}`}>
        {/* Card row */}
        <div className="flex items-center gap-0.5 px-3 py-1 whitespace-nowrap" data-tour="item-row">
        {/* Drag handle - only shown for draggable (active) items */}
        <div 
          className={`w-5 text-gray-400 dark:text-gray-500 select-none text-lg tracking-tighter touch-none flex-shrink-0 ${isDraggable ? 'cursor-grab' : ''}`}
          {...(isDraggable ? dragHandleProps : {})}
          data-tour="drag-handle"
        >
          {isDraggable ? '⋮⋮' : ''}
        </div>

        {/* Item name - click to toggle archive */}
        <div
          className="flex-shrink-0"
          style={{ width: itemTextWidth }}
          data-tour="item-name"
        >
          {isEditing ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSaveText()
                if (e.key === 'Escape') handleCancelEditText()
              }}
              className="w-full px-2 py-0.5 border border-teal rounded text-lg"
              autoFocus
            />
          ) : (
            <span
              onClick={handleArchive}
              className={`block truncate text-lg cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
              title={`Click to ${item.archived ? 'restore' : 'archive'}: ${item.text}`}
              data-tour="item-archive"
            >
              {item.text}
            </span>
          )}
        </div>

        {/* Per-member controls - aligned under header */}
        <div 
          className="flex items-center ml-2 flex-shrink-0 gap-2.5"
          {...(members.length > 0 ? { 'data-tour': 'item-state' } : {})}
        >
          {members.map(member => {
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
                  className={`flex items-center justify-center px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-[90px] h-[40px] transition-colors ${!canEdit ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                  onClick={() => {
                    if (!canEdit || isEditingThis) return
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
                    /* Unassigned: grey X */
                    <svg width="18" height="18" viewBox="-0.5 0 25 25" fill="none" className="text-gray-400 dark:text-gray-500">
                      <path d="M3 21.32L21 3.32001" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 3.32001L21 21.32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : done ? (
                    /* Done: checkmark centered, small qty on left */
                    <>
                      <span className="text-xs text-gray-400 dark:text-gray-500 absolute left-1.5 top-1/2 -translate-y-1/2">{quantity}</span>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-coral">
                        <path d="M5 14L8.23309 16.4248C8.66178 16.7463 9.26772 16.6728 9.60705 16.2581L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </>
                  ) : (
                    /* Assigned: quantity left, edit icon right */
                    <>
                      <span className="text-lg font-semibold text-primary dark:text-gray-100 flex-1 text-center">{quantity}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canEdit) handleOpenQuantityEditor(member.id)
                        }}
                        className="flex-shrink-0 p-0.5 text-gray-400 dark:text-gray-500 hover:text-teal"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>

                {/* Floating quantity editor */}
                {isEditingThis && (
                  <div ref={quantityEditorRef} className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg dark:shadow-slate-900/50 p-2 z-50 min-w-[140px]">
                    <input
                      type="number"
                      value={editQuantityValue}
                      onChange={(e) => setEditQuantityValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSaveQuantity(member.id)
                        if (e.key === 'Escape') handleCancelQuantityEdit()
                      }}
                      className="w-full text-center text-lg font-semibold border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
                      autoFocus
                      min="1"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCancelQuantityEdit()}
                        className="flex-1 px-2 py-1 text-xs text-white rounded bg-gray-400 hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleClearQuantity()}
                        className="flex-1 px-2 py-1 text-xs text-white rounded bg-teal hover:opacity-80"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void handleSaveQuantity(member.id)}
                        className="flex-1 px-2 py-1 text-xs text-white rounded bg-red-500 hover:bg-red-600"
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

        {/* Trailing section - pushed to right with ml-auto */}
        <div className="flex-shrink-0 flex justify-end items-center gap-1 ml-auto pl-4">
          {/* Comment indicator */}
          {hasComment && (
            <span className="text-teal text-sm opacity-80" title="Has comment">💬</span>
          )}

          {/* Category name label (non-empty names only) */}
          {categoryNames?.[String(category)] ? (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[60px]">
              {categoryNames[String(category)]}
            </span>
          ) : null}

          {/* Kebab menu button */}
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 px-1 py-0.5 rounded hover:bg-gray-200"
            title="More options"
            data-tour="item-menu"
          >
            <span className="text-lg">{showMenu ? '✕' : '⋮'}</span>
          </button>
        </div>
        </div>

        {/* Expanded menu with comment field and action buttons */}
        {showMenu && (
          <div className="px-3 py-2 space-y-2 border-t border-black/10 dark:border-white/10">
            {/* Comment field */}
            <div className="flex gap-2 items-start">
              <textarea
                ref={commentRef}
                rows={1}
                value={editingComment ? draftComment : comment}
                onChange={(e) => { setDraftComment(e.target.value); autoGrow(e.target) }}
                onFocus={() => { if (!editingComment) handleStartEditComment() }}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:border-teal bg-white/80 dark:bg-slate-800/80 resize-none overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              />
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
                      catId === category ? 'ring-2 ring-teal ring-offset-1 ring-offset-white dark:ring-offset-slate-800 shadow-sm font-semibold text-primary dark:text-gray-100' : 'hover:opacity-90 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    <span className="truncate">{label || <span className="text-gray-400/70">&lt;empty&gt;</span>}</span>
                  </button>
                )
              })}
            </div>
            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {editingComment || isEditing ? (
                <div className="flex items-center justify-end gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); isEditing ? handleCancelEditText() : handleCancelComment() }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg bg-gray-400 hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); isEditing ? handleClearText() : handleClearComment() }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg bg-teal hover:opacity-80"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); isEditing ? void handleSaveText() : void handleSaveComment() }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg bg-red-500 hover:bg-red-600"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditText(item.text)
                      setIsEditing(true)
                    }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg bg-teal hover:opacity-80"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDeleteConfirm(true)
                      setShowMenu(false)
                    }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Item"
        message={`Delete "${item.text}"? This will also remove all member quantities and states for this item.`}
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}
