'use client'

import { useState, useEffect, useRef } from 'react'
import { useSwipeable } from 'react-swipeable'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/providers/AuthProvider'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import type { ItemWithState } from '@/hooks/useList'
import type { MemberWithCreator, Item } from '@/lib/supabase/types'

interface ItemCardProps {
  item: ItemWithState
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  onUpdateItem: (itemId: string, updates: Partial<Item>) => Promise<{ error?: { message: string } | null }>
  onDeleteItem: (itemId: string) => Promise<{ error?: Error | null }>
  onChangeQuantity: (itemId: string, memberId: string, delta: number) => Promise<any>
  onUpdateMemberState: (itemId: string, memberId: string, updates: { quantity?: number; done?: boolean }) => Promise<any>
  dragHandleProps?: Record<string, unknown>
}

export function ItemCard({ item, members, hideDone, onUpdateItem, onDeleteItem, onChangeQuantity, onUpdateMemberState, dragHandleProps }: ItemCardProps) {
  const { user } = useAuth()
  const { error: showError } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(item.text)
  const [comment, setComment] = useState(item.comment || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [editingQuantityMember, setEditingQuantityMember] = useState<string | null>(null)
  const [editQuantityValue, setEditQuantityValue] = useState('')
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const getSwipeThreshold = () => typeof window !== 'undefined' ? window.innerWidth * 0.7 : 200

  const swipeHandlers = useSwipeable({
    onSwiping: (e) => {
      // Only allow swipe right (positive deltaX) - require 40px before starting
      if (e.deltaX > 40) {
        setIsSwiping(true)
        setSwipeOffset(e.deltaX - 30)
      }
    },
    onSwipedRight: () => {
      if (swipeOffset > getSwipeThreshold()) {
        // Active items → Archive, Archived items → Delete
        if (item.archived) {
          setShowDeleteConfirm(true)
        } else {
          handleArchive()
        }
      }
      setSwipeOffset(0)
      setIsSwiping(false)
    },
    onSwiped: () => {
      setSwipeOffset(0)
      setIsSwiping(false)
    },
    trackMouse: false,
    trackTouch: true,
    preventScrollOnSwipe: true,
  })


  // Sync editText with item.text when not editing (handles server updates/reverts)
  useEffect(() => {
    if (!isEditing) {
      setEditText(item.text)
    }
  }, [item.text, isEditing])

  // Check if any member has this item done or with 0 quantity (for hideDone filtering)
  const shouldHide = members.some(member => {
    const state = item.memberStates[member.id]
    const quantity = state?.quantity || 0
    return hideDone[member.id] && (state?.done || quantity === 0)
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
    await onUpdateItem(item.id, { archived: !item.archived })
  }

  const handleSaveComment = async () => {
    await onUpdateItem(item.id, { comment: comment.trim() || null })
    setShowComment(false)
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
      {/* Swipe container */}
      <div className="relative overflow-hidden rounded-lg">
        {/* Background action revealed on swipe right */}
        <div className="absolute inset-0 flex pointer-events-none">
          {/* Active → Archive (amber), Archived → Delete (red) */}
          <div 
            className={`flex items-center justify-start pl-4 text-white font-semibold transition-opacity ${swipeOffset > 20 ? 'opacity-100' : 'opacity-0'} ${item.archived ? 'bg-red-500' : 'bg-amber-500'}`} 
            style={{ width: '120px' }}
          >
            {item.archived ? '🗑️ Delete' : '📥 Archive'}
          </div>
          <div className="flex-1" />
        </div>

        {/* Main card content - wrapper for swipe transform */}
        <div 
          {...swipeHandlers}
          style={{ transform: `translateX(${swipeOffset}px)`, transition: isSwiping ? 'none' : 'transform 0.2s ease-out' }}
          className={`bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors ${item.archived ? 'opacity-60' : ''}`}
        >
        {/* Card row */}
        <div className="flex items-center gap-0.5 px-3 py-1 whitespace-nowrap" data-tour="item-row">
        {/* Drag handle */}
        <div 
          className={`text-gray-400 select-none text-lg tracking-tighter touch-none flex-shrink-0 ${item.archived ? 'opacity-50 cursor-not-allowed' : 'cursor-grab'}`}
          {...(item.archived ? {} : dragHandleProps)}
        >
          ⋮⋮
        </div>

        {/* Item name */}
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
            onClick={() => !item.archived && setIsEditing(true)}
            className={`w-20 flex-shrink-0 truncate text-lg ${item.archived ? 'text-gray-500 cursor-default' : 'cursor-pointer hover:text-teal'}`}
            title={item.text}
          >
            {item.text}
          </span>
        )}

        {/* Per-member controls - aligned under header */}
        <div className="flex items-center ml-2 flex-shrink-0 gap-3">
          {members.map(member => {
            const state = item.memberStates[member.id]
            const quantity = state?.quantity || 0
            const done = state?.done || false
            const isCreator = member.created_by === user?.id
            const isEditingThis = editingQuantityMember === member.id

            return (
              <div 
                key={member.id} 
                className={`flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 bg-white ${!isCreator ? 'opacity-50' : ''}`}
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
                    onClick={() => isCreator && handleStartEditQuantity(member.id, quantity)}
                    className={`w-8 text-center text-xl font-semibold ${quantity === 0 ? 'text-gray-300' : 'text-primary'} ${isCreator ? 'cursor-pointer hover:text-teal' : 'cursor-not-allowed'}`}
                  >
                    {quantity}
                  </span>
                )}

                {/* Done toggle - larger with background */}
                <button
                  onClick={() => isCreator && handleToggleDone(member.id)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-xl font-bold transition-colors ${
                    done 
                      ? 'bg-coral text-white' 
                      : 'bg-gray-100 text-gray-400'
                  } ${isCreator ? 'hover:opacity-80' : 'cursor-not-allowed'}`}
                  disabled={!isCreator}
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
            data-tour="item-kebab"
          >
            <span className="text-lg">{showMenu ? '✕' : '⋮'}</span>
          </button>
        </div>
        </div>

        {/* Expanded menu with comment field and action buttons */}
        {showMenu && (
          <div className="px-3 py-2 bg-gray-100 border-t border-gray-200 space-y-2">
            {/* Comment field */}
            <div className="flex gap-2">
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleArchive()
                  setShowMenu(false)
                }}
                className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
              >
                <span>{item.archived ? '↩' : '📥'}</span>
                <span>{item.archived ? 'Restore' : 'Archive'}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                  setShowMenu(false)
                }}
                className="px-3 py-1.5 text-sm bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 text-red-600 flex items-center gap-1.5"
              >
                <span>🗑️</span>
                <span>Delete</span>
              </button>
            </div>
          </div>
        )}
        </div>
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
