'use client'

import { useState, useEffect } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/providers/AuthProvider'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import type { ItemWithState } from '@/hooks/useList'
import type { MemberWithCreator, Item } from '@/lib/supabase/types'

interface ItemCardProps {
  item: ItemWithState
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onUpdateItem: (itemId: string, updates: Partial<Item>) => Promise<{ error?: { message: string } | null }>
  onDeleteItem: (itemId: string) => Promise<{ error?: Error | null }>
  onChangeQuantity: (itemId: string, memberId: string, delta: number) => Promise<any>
  onUpdateMemberState: (itemId: string, memberId: string, updates: { quantity?: number; done?: boolean }) => Promise<any>
  dragHandleProps?: Record<string, unknown>
  isDraggable?: boolean
}

export function ItemCard({ item, members, hideDone, hideNotRelevant, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, dragHandleProps, isDraggable = true }: ItemCardProps) {
  const { user } = useAuth()
  const { error: showError } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [comment, setComment] = useState(item.comment || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Sync comment state when item updates from realtime
  useEffect(() => {
    setComment(item.comment || '')
  }, [item.comment])
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [editingQuantityMember, setEditingQuantityMember] = useState<string | null>(null)
  const [editQuantityValue, setEditQuantityValue] = useState('')


  // Sync editText with item.text when not editing (handles server updates/reverts)
  useEffect(() => {
    if (!isEditing) {
      setEditText(item.text)
    }
  }, [item.text, isEditing])

  // Check if item should be hidden based on member filters
  const shouldHide = members.some(member => {
    const state = item.memberStates[member.id]
    const quantity = state?.quantity || 0
    const done = state?.done || false
    
    // Hide if done and hideDone is enabled for this member
    if (hideDone[member.id] && done) return true
    // Hide if not relevant (qty 0) and hideNotRelevant is enabled for this member
    if (hideNotRelevant[member.id] && quantity === 0) return true
    
    return false
  })

  if (shouldHide) return null

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

  const handleToggleDone = async (memberId: string) => {
    const currentState = item.memberStates[memberId]
    const newDone = !currentState?.done
    await onUpdateMemberState(item.id, memberId, { done: newDone })
  }

  const handleStartEditQuantity = (memberId: string, currentQuantity: number) => {
    setEditingQuantityMember(memberId)
    setEditQuantityValue(currentQuantity.toString())
  }

  const handleSaveQuantity = async (memberId: string) => {
    const newQuantity = parseInt(editQuantityValue, 10)
    if (!isNaN(newQuantity) && newQuantity >= 0) {
      const currentState = item.memberStates[memberId]
      const currentQuantity = currentState?.quantity || 0
      const delta = newQuantity - currentQuantity
      if (delta !== 0) {
        await onChangeQuantity(item.id, memberId, delta)
      }
    }
    setEditingQuantityMember(null)
    setEditQuantityValue('')
  }

  const handleArchive = async () => {
    if (item.archived) {
      await onUpdateItem(item.id, { archived: false, archived_at: null })
    } else {
      await onUpdateItem(item.id, { archived: true, archived_at: new Date().toISOString() })
    }
  }

  const handleSaveComment = async () => {
    await onUpdateItem(item.id, { comment: comment.trim() || null })
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

  return (
    <div className="min-w-full">
      {/* Main card content */}
      <div className={`bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors ${item.archived ? 'opacity-60' : ''}`}>
        {/* Card row */}
        <div className="flex items-center gap-0.5 px-3 py-1 whitespace-nowrap" data-tour="item-row">
        {/* Drag handle - only shown for draggable (active) items */}
        <div 
          className={`w-5 text-gray-400 select-none text-lg tracking-tighter touch-none flex-shrink-0 ${isDraggable ? 'cursor-grab' : ''}`}
          {...(isDraggable ? dragHandleProps : {})}
          data-tour="drag-handle"
        >
          {isDraggable ? '⋮⋮' : ''}
        </div>

        {/* Item name - click to toggle archive */}
        {isEditing ? (
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSaveText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveText()
              if (e.key === 'Escape') {
                setEditText(item.text)
                setIsEditing(false)
              }
            }}
            className="w-20 flex-shrink-0 px-2 py-0.5 border border-teal rounded text-lg"
            autoFocus
          />
        ) : (
          <span
            onClick={handleArchive}
            className={`w-20 flex-shrink-0 truncate text-lg cursor-pointer hover:text-teal ${item.archived ? 'line-through text-gray-500' : ''}`}
            title={`Click to ${item.archived ? 'restore' : 'archive'}: ${item.text}`}
            data-tour="item-archive"
          >
            {item.text}
          </span>
        )}

        {/* Per-member controls - aligned under header */}
        <div className="flex items-center ml-2 flex-shrink-0 gap-2.5" data-tour="item-state">
          {members.map(member => {
            const state = item.memberStates[member.id]
            const quantity = state?.quantity || 0
            const done = state?.done || false
            const isCreator = member.created_by === user?.id
            const canEdit = isCreator || member.is_public
            const isEditingThis = editingQuantityMember === member.id

            return (
              <div 
                key={member.id} 
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white w-[90px] h-[40px] ${!canEdit ? 'opacity-50' : ''}`}
              >
                {/* Quantity - editable text */}
                {isEditingThis ? (
                  <input
                    type="number"
                    value={editQuantityValue}
                    onChange={(e) => setEditQuantityValue(e.target.value)}
                    onBlur={() => handleSaveQuantity(member.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveQuantity(member.id)
                      if (e.key === 'Escape') {
                        setEditingQuantityMember(null)
                        setEditQuantityValue('')
                      }
                    }}
                    className="w-10 text-center text-xl font-semibold border border-teal rounded px-1"
                    autoFocus
                    min="0"
                  />
                ) : (
                  <span
                    onClick={() => canEdit && handleStartEditQuantity(member.id, quantity)}
                    className={`w-8 text-center text-lg font-semibold text-primary ${canEdit ? 'cursor-pointer hover:text-teal' : 'cursor-not-allowed'}`}
                  >
                    {quantity}
                  </span>
                )}

                {/* Done toggle */}
                <button
                  onClick={() => canEdit && handleToggleDone(member.id)}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-base font-bold transition-colors ${
                    done 
                      ? 'bg-coral text-white' 
                      : 'bg-gray-100 text-primary'
                  } ${canEdit ? 'hover:opacity-80' : 'cursor-not-allowed'}`}
                  disabled={!canEdit}
                >
                  ✓
                </button>
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

          {/* Kebab menu button */}
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded hover:bg-gray-200"
            title="More options"
            data-tour="item-menu"
          >
            <span className="text-lg">{showMenu ? '✕' : '⋮'}</span>
          </button>
        </div>
        </div>

        {/* Expanded menu with comment field and action buttons */}
        {showMenu && (
          <div className="px-3 py-2 bg-gray-50 space-y-2">
            {/* Comment field */}
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={handleSaveComment}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveComment()
                }}
                placeholder="Add a comment..."
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-teal"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2">
              {!item.archived && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsEditing(true)
                  }}
                  className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                  setShowMenu(false)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
              >
                Delete
              </button>
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
