'use client'

import { useState, useRef, useEffect } from 'react'
import { useSwipeable } from 'react-swipeable'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShareModal } from './ShareModal'
import type { ListWithRole } from '@/lib/supabase/types'

interface ListCardProps {
  list: ListWithRole
  existingListNames: string[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string) => Promise<{ error: Error | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  onRefresh?: () => void
  dragHandleProps?: Record<string, unknown>
}

export function ListCard({ list, existingListNames, onUpdate, onDelete, onArchive, onDuplicate, onLeave, onRefresh, dragHandleProps }: ListCardProps) {
  const router = useRouter()
  const { success, error: showError } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(list.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)

  const isOwner = list.role === 'owner'
  const SWIPE_THRESHOLD = 80

  const swipeHandlers = useSwipeable({
    onSwiping: (e) => {
      // Only allow swipe right (positive deltaX)
      if (e.deltaX > 10) {
        setIsSwiping(true)
        setSwipeOffset(Math.min(120, e.deltaX))
      }
    },
    onSwipedRight: () => {
      if (swipeOffset > SWIPE_THRESHOLD) {
        // Active lists → Archive, Archived lists → Delete/Leave
        if (list.userArchived) {
          if (isOwner) {
            setShowDeleteConfirm(true)
          } else {
            setShowLeaveConfirm(true)
          }
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

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const handleCardClick = () => {
    if (!isRenaming) {
      router.push(`/list/${list.id}`)
    }
  }

  const handleRename = async () => {
    if (newName.trim() && newName !== list.name) {
      const { error } = await onUpdate(list.id, { name: newName.trim() })
      if (error) {
        showError('Failed to rename list')
      } else {
        success('List renamed')
      }
    }
    setIsRenaming(false)
    setMenuOpen(false)
  }

  const handleArchive = async () => {
    const { error } = await onArchive(list.id, { archived: !list.userArchived })
    if (!error) {
      success(list.userArchived ? 'List restored' : 'List archived')
    }
    setMenuOpen(false)
  }

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    const { error } = await onDelete(list.id)
    if (error) {
      showError('Failed to delete list')
      setDeleting(false)
      setShowDeleteConfirm(false)
    } else {
      success('List deleted')
      setShowDeleteConfirm(false)
    }
  }

  const handleDuplicate = async () => {
    // Prevent double clicks
    if (duplicating) return
    setDuplicating(true)
    setMenuOpen(false)

    // Find a unique name by checking against existing list names
    const existingNamesLower = existingListNames.map(n => n.toLowerCase())
    let dupName = `${list.name} (copy)`
    let attempt = 1
    const maxAttempts = 20

    // Find first available name
    while (existingNamesLower.includes(dupName.toLowerCase()) && attempt < maxAttempts) {
      attempt++
      dupName = `${list.name} (copy ${attempt})`
    }

    if (existingNamesLower.includes(dupName.toLowerCase())) {
      showError('Failed to duplicate list - too many copies exist')
      setDuplicating(false)
      return
    }

    const { error } = await onDuplicate(list.id, dupName)
    if (error) {
      showError('Failed to duplicate list')
    } else {
      success('List duplicated')
    }
    setDuplicating(false)
  }

  const handleLeaveClick = () => {
    setMenuOpen(false)
    setShowLeaveConfirm(true)
  }

  const handleLeaveConfirm = async () => {
    setLeaving(true)
    const { error } = await onLeave(list.id)
    if (error) {
      showError('Failed to leave list')
      setLeaving(false)
      setShowLeaveConfirm(false)
    } else {
      success('Left list')
      setShowLeaveConfirm(false)
    }
  }

  return (
    <>
    <div className="relative overflow-hidden rounded-lg">
      {/* Background action revealed on swipe right */}
      <div className="absolute inset-0 flex">
        {/* Active → Archive (amber), Archived → Delete/Leave (red) */}
        <div 
          className={`flex items-center justify-start pl-4 text-white font-semibold transition-opacity ${swipeOffset > 20 ? 'opacity-100' : 'opacity-0'} ${list.userArchived ? 'bg-red-500' : 'bg-amber-500'}`} 
          style={{ width: '120px' }}
        >
          {list.userArchived ? `🗑️ ${isOwner ? 'Delete' : 'Leave'}` : '📥 Archive'}
        </div>
        <div className="flex-1" />
      </div>

      {/* Main card content */}
      <div 
        {...swipeHandlers}
        style={{ transform: `translateX(${swipeOffset}px)`, transition: isSwiping ? 'none' : 'transform 0.2s ease-out' }}
        className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
      >
      {/* Drag handle */}
      <div 
        className="text-gray-400 cursor-grab select-none text-sm tracking-tighter hidden sm:block touch-none"
        {...dragHandleProps}
      >
        ⋮⋮
      </div>

      {/* Visibility icon - clickable for owners */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (isOwner) {
            setShowShareModal(true)
          }
        }}
        className={`text-sm flex-shrink-0 ${isOwner ? 'hover:opacity-100 cursor-pointer' : 'cursor-default'} opacity-60`}
        title={isOwner ? 'Share settings' : (list.visibility === 'private' ? 'Private' : 'Shared by link')}
      >
        {list.visibility === 'private' ? '🔒' : '🔗'}
      </button>

      {/* List name */}
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') {
              setNewName(list.name)
              setIsRenaming(false)
            }
          }}
          className="flex-1 min-w-0 px-2 py-1 border border-primary rounded text-base font-medium"
          aria-label="List name"
        />
      ) : (
        <span
          onClick={handleCardClick}
          className="flex-1 min-w-0 font-medium text-gray-800 hover:text-primary cursor-pointer truncate"
        >
          {list.name}
        </span>
      )}

      {/* Metadata - hidden on mobile */}
      <span className="text-sm text-gray-500 hidden sm:inline flex-shrink-0">
        {!isOwner && list.ownerNickname && (
          <span className="text-primary">{list.ownerNickname}</span>
        )}
        {!isOwner && list.ownerNickname && ' · '}
        {list.memberCount || 0} members · {list.activeItemCount || 0} items
      </span>

      {/* Menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="text-gray-400 hover:text-gray-600 px-2 py-1 text-xl leading-none"
        >
          ⋮
        </button>

        {menuOpen && (
          <ul className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[160px] py-1.5 z-50">
            {isOwner && (
              <li
                onClick={() => {
                  setIsRenaming(true)
                  setMenuOpen(false)
                }}
                className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-primary"
              >
                Rename
              </li>
            )}
            <li
              onClick={handleDuplicate}
              className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-cyan-600"
            >
              Duplicate
            </li>
            <li
              onClick={handleArchive}
              className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-gray-500"
            >
              {list.userArchived ? 'Restore' : 'Archive'}
            </li>
            {isOwner && (
              <li
                onClick={handleDeleteClick}
                className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-red-500"
              >
                Delete
              </li>
            )}
            {!isOwner && (
              <li
                onClick={handleLeaveClick}
                className="px-4 py-2.5 cursor-pointer hover:bg-gray-50 text-red-500"
              >
                Leave
              </li>
            )}
          </ul>
        )}
      </div>
      </div>
    </div>

    <ConfirmModal
      isOpen={showDeleteConfirm}
      onClose={() => setShowDeleteConfirm(false)}
      onConfirm={handleDeleteConfirm}
      title="Delete List"
      message="Are you sure you want to delete this list? This action cannot be undone."
      confirmText="Delete"
      cancelText="Cancel"
      variant="danger"
      loading={deleting}
    />

    <ConfirmModal
      isOpen={showLeaveConfirm}
      onClose={() => setShowLeaveConfirm(false)}
      onConfirm={handleLeaveConfirm}
      title="Leave List"
      message="Are you sure you want to leave this list? Your members and their data will be removed."
      confirmText="Leave"
      cancelText="Cancel"
      variant="danger"
      loading={leaving}
    />

    {isOwner && (
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        list={list}
        onUpdate={() => onRefresh?.()}
      />
    )}
  </>
  )
}
