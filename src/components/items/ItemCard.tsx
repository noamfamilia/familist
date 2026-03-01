'use client'

import { useState, useEffect, useRef } from 'react'
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
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState(item.comment || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMenu])

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

  const handleQuantityChange = async (memberId: string, delta: number) => {
    await onChangeQuantity(item.id, memberId, delta)
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
    <div className="space-y-1">
      <div className={`inline-flex items-center gap-0.5 px-3 py-1 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors min-w-full ${item.archived ? 'opacity-60' : ''}`}>
        {/* Drag handle */}
        <div 
          className={`text-gray-400 select-none text-sm tracking-tighter touch-none flex-shrink-0 ${item.archived ? 'opacity-50 cursor-not-allowed' : 'cursor-grab'}`}
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
            className="w-36 flex-shrink-0 px-2 py-0.5 border border-primary rounded text-sm"
            autoFocus
          />
        ) : (
          <span
            onClick={() => !item.archived && setIsEditing(true)}
            className={`w-36 flex-shrink-0 truncate text-sm ${item.archived ? 'text-gray-500 cursor-default' : 'cursor-pointer hover:text-primary'}`}
            title={item.text}
          >
            {item.text}
          </span>
        )}

        {/* Per-member controls - aligned under header */}
        <div className="flex items-center ml-2 flex-shrink-0">
          {members.map(member => {
            const state = item.memberStates[member.id]
            const quantity = state?.quantity || 0
            const done = state?.done || false
            const isCreator = member.created_by === user?.id

            return (
              <div key={member.id} className={`w-16 flex-shrink-0 flex items-center justify-start ${!isCreator ? 'opacity-50' : ''}`}>
                {/* Quantity control */}
                <button
                  onClick={() => isCreator && handleQuantityChange(member.id, -1)}
                  className={`text-gray-400 text-sm ${isCreator ? 'hover:text-gray-600 cursor-pointer' : 'cursor-not-allowed'}`}
                  disabled={!isCreator || quantity <= 0}
                >
                  −
                </button>
                <span className={`w-3 text-center text-sm ${quantity === 0 ? 'text-gray-300' : ''}`}>
                  {quantity}
                </span>
                <button
                  onClick={() => isCreator && handleQuantityChange(member.id, 1)}
                  className={`text-gray-400 text-sm ${isCreator ? 'hover:text-gray-600 cursor-pointer' : 'cursor-not-allowed'}`}
                  disabled={!isCreator}
                >
                  +
                </button>

                {/* Done toggle */}
                <button
                  onClick={() => isCreator && handleToggleDone(member.id)}
                  className={`${done ? 'text-green-500' : 'text-gray-300'} ${!isCreator ? 'cursor-not-allowed' : ''}`}
                  disabled={!isCreator}
                >
                  ✓
                </button>
              </div>
            )
          })}
        </div>

        {/* Trailing section - fixed width to match header */}
        <div className="w-28 flex-shrink-0 flex justify-end items-center gap-1 ml-2 relative" ref={menuRef}>
          {/* Comment indicator */}
          {hasComment && (
            <span className="text-primary text-sm opacity-80" title="Has comment">💬</span>
          )}

          {/* Kebab menu button */}
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-gray-400 hover:text-gray-600 px-1 py-0.5 rounded hover:bg-gray-200"
            title="More options"
          >
            <span className="text-sm">⋮</span>
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[140px] py-1">
              <button
                onClick={() => {
                  setShowComment(!showComment)
                  setShowMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <span>💬</span>
                <span>{hasComment ? 'Edit comment' : 'Add comment'}</span>
              </button>
              <button
                onClick={() => {
                  handleArchive()
                  setShowMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <span>{item.archived ? '↩' : '📥'}</span>
                <span>{item.archived ? 'Restore' : 'Archive'}</span>
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(true)
                  setShowMenu(false)
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 text-red-600 flex items-center gap-2"
              >
                <span>🗑️</span>
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Comment section */}
      {showComment && (
        <div className="ml-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full min-h-[60px] p-2 border border-gray-200 rounded text-sm resize-y focus:outline-none focus:border-primary"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => {
                setComment(item.comment || '')
                setShowComment(false)
              }}
              className="px-3 py-1 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveComment}
              className="px-3 py-1 text-sm text-white bg-primary rounded hover:bg-primary-dark"
            >
              Save
            </button>
          </div>
        </div>
      )}

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
