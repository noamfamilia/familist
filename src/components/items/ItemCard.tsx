'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/providers/AuthProvider'
import type { CategoryNames, Item, ItemCategory, ItemWithState, MemberWithCreator } from '@/lib/supabase/types'
import { ITEM_CATEGORIES, normalizeItemCategory } from '@/lib/supabase/types'
import { ITEM_CATEGORY_STYLES } from '@/lib/categoryStyles'
import { ProgressRings } from '@/components/items/ProgressRings'

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
  const { success: showSuccess, error: showError } = useToast()
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

  const shouldHide = members.some(member => {
    if (member.is_target) return false
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

  const getMemberName = (memberId: string) => members.find(m => m.id === memberId)?.name || 'member'

  const handleAssign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: true })
    if (error) showError(error.message || 'Failed to assign')
    else showSuccess(`${item.text} for ${getMemberName(memberId)} is assigned`)
  }

  const handleMarkDone = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { done: true })
    if (error) showError(error.message || 'Failed to mark done')
    else showSuccess(`${item.text} for ${getMemberName(memberId)} is completed`)
  }

  const handleUnassign = async (memberId: string) => {
    const { error } = await onUpdateMemberState(item.id, memberId, { assigned: false, done: false })
    if (error) showError(error.message || 'Failed to unassign')
    else showSuccess(`${item.text} for ${getMemberName(memberId)} is unassigned`)
  }

  const handleOpenQuantityEditor = (memberId: string, containerEl: HTMLElement) => {
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

  const handleSaveQuantity = async (memberId: string) => {
    const newQuantity = parseInt(editQuantityValue, 10)
    const minQty = 1
    if (!isNaN(newQuantity) && newQuantity >= minQty) {
      const { error } = await onUpdateMemberState(item.id, memberId, { quantity: newQuantity, assigned: true })
      if (error) showError(error.message || 'Failed to update quantity')
    }
    setEditingQuantityMember(null)
    setEditQuantityValue('')
    setEditorPos(null)
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
    const { error } = await onUpdateItem(item.id, { comment: trimmed || null })
    if (error) {
      showError(error.message || 'Failed to save comment')
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

        {/* Item name - click to toggle archive (collapsed) or rename (expanded) */}
        <div
          className="relative flex-shrink-0"
          style={{ width: itemTextWidth }}
          data-tour="item-name"
        >
          {showMenu ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                setEditText(item.text)
                setIsEditing(true)
              }}
              className={`flex items-center gap-1 text-lg cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
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
              className={`block truncate text-lg cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
              title={`Click to ${item.archived ? 'restore' : 'archive'}: ${item.text}`}
              data-tour="item-archive"
            >
              {item.text}
            </span>
          )}
          {isEditing && (
            <div
              ref={renamePopoverRef}
              className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg dark:shadow-slate-900/50 p-2 w-[200px]"
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
                className="w-full text-center text-lg border border-teal rounded-lg px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-teal/20"
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
        <div 
          className="flex items-center ml-2.5 flex-shrink-0 gap-2.5"
          {...(members.length > 0 ? { 'data-tour': 'item-state' } : {})}
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

              return (
                <div key={member.id} className="relative">
                  <div
                    data-state-container
                    className={`flex items-center justify-center w-[90px] h-[40px] ${canEdit && !item.archived ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={(e) => {
                      if (!canEdit || item.archived) return
                      e.stopPropagation()
                      const container = e.currentTarget as HTMLElement
                      handleOpenQuantityEditor(member.id, container)
                    }}
                  >
                    <ProgressRings targetQty={targetQty} totalQty={totalQty} totalDoneQty={totalDoneQty} size={36} />
                  </div>

                  {isEditingThis && editorPos && (
                    <div ref={quantityEditorRef} className="fixed bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg dark:shadow-slate-900/50 p-2 z-50 w-[200px]" style={{ top: editorPos.top, left: editorPos.left }}>
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
                  className={`flex items-center justify-center px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-[90px] h-[40px] transition-colors ${!canEdit || item.archived ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700'}`}
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
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-coral">
                        <path d="M5 14L8.23309 16.4248C8.66178 16.7463 9.26772 16.6728 9.60705 16.2581L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </>
                  ) : (
                    <>
                      <span className="text-lg text-primary dark:text-gray-100 flex-1 text-center">{quantity}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          const container = (e.currentTarget as HTMLElement).closest('[data-state-container]') as HTMLElement
                          if (canEdit && !item.archived && container) handleOpenQuantityEditor(member.id, container)
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

                {isEditingThis && editorPos && (
                  <div ref={quantityEditorRef} className="fixed bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg dark:shadow-slate-900/50 p-2 z-50 w-[200px]" style={{ top: editorPos.top, left: editorPos.left }}>
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

        {/* Trailing section - pushed to right with ml-auto */}
        <div className="flex-shrink-0 flex justify-end items-center gap-1 ml-auto pl-4">
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
              className="text-red-500 hover:opacity-70 p-0.5"
              title="Delete item"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.755,20.283,4,8H20L18.245,20.283A2,2,0,0,1,16.265,22H7.735A2,2,0,0,1,5.755,20.283ZM21,4H16V3a1,1,0,0,0-1-1H9A1,1,0,0,0,8,3V4H3A1,1,0,0,0,3,6H21a1,1,0,0,0,0-2Z"/>
              </svg>
            </button>
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
          <div className="px-3 py-2 space-y-2">
            {/* Comment display / editor */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              {comment ? (
                <p
                  className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words cursor-pointer hover:text-teal"
                  onClick={() => handleStartEditComment()}
                >
                  {comment}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline-block ml-1 opacity-40 align-text-bottom">
                    <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                  </svg>
                </p>
              ) : (
                <p
                  className="text-sm text-gray-400 dark:text-gray-500 cursor-pointer hover:text-teal"
                  onClick={() => handleStartEditComment()}
                >
                  Add a comment...
                </p>
              )}
              {editingComment && (
                <div
                  ref={commentPopoverRef}
                  className="absolute left-0 right-0 top-0 z-50 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg dark:shadow-slate-900/50 p-2"
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
                      catId === category ? 'ring-2 ring-teal ring-offset-1 ring-offset-white dark:ring-offset-slate-800 shadow-sm font-semibold text-primary dark:text-gray-100' : 'hover:opacity-90 text-gray-500 dark:text-gray-400'
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
        message={`Delete "${item.text}"? This will also remove all member quantities and states for this item.`}
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  )
}
