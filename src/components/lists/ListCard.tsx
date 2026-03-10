'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import type { ListWithRole } from '@/lib/supabase/types'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})
const ShareModal = dynamic(() => import('./ShareModal').then(mod => mod.ShareModal), {
  ssr: false,
})

interface ListCardProps {
  list: ListWithRole
  existingListNames: string[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean; comment?: string }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string) => Promise<{ error: Error | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  onRefresh?: () => void
  dragHandleProps?: Record<string, unknown>
}

export function ListCard({ list, existingListNames, onUpdate, onDelete, onArchive, onDuplicate, onLeave, onRefresh, dragHandleProps }: ListCardProps) {
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
  const [comment, setComment] = useState(list.comment || '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync comment state when list updates from realtime
  useEffect(() => {
    setComment(list.comment || '')
  }, [list.comment])

  const isOwner = list.role === 'owner'

  const handleSaveComment = async () => {
    const trimmed = comment.trim()
    if (trimmed !== (list.comment || '')) {
      const { error } = await onUpdate(list.id, { comment: trimmed || null })
      if (error) {
        showError('Failed to save comment')
        setComment(list.comment || '')
      }
    }
  }


  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  // Debug timing for navigation (Link handles actual navigation)
  const handleLinkClick = () => {
    const t1 = performance.now()
    const visState = document.visibilityState
    const swState = navigator.serviceWorker?.controller?.state || 'no-sw'
    
    console.log(`[NAV T1] ${new Date().toISOString()} List clicked: ${list.id}`)
    console.log(`[NAV T1] Tab visibility: ${visState}, SW state: ${swState}`)
    
    if (typeof window !== 'undefined') {
      (window as any).__navTiming = { listId: list.id, t1_click: t1 }
    }
    
    // T1b: When event loop is free (setTimeout 0)
    setTimeout(() => {
      const t1b = performance.now()
      console.log(`[NAV T1b] Event loop free (setTimeout 0) - ${(t1b - t1).toFixed(0)}ms since click`)
    }, 0)
    
    // T1c: Next animation frame
    requestAnimationFrame(() => {
      const t1c = performance.now()
      console.log(`[NAV T1c] requestAnimationFrame - ${(t1c - t1).toFixed(0)}ms since click`)
      
      // T1d: After paint (double rAF)
      requestAnimationFrame(() => {
        const t1d = performance.now()
        console.log(`[NAV T1d] After paint (double rAF) - ${(t1d - t1).toFixed(0)}ms since click`)
      })
    })
  }

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Toggle archive state
    const { error } = await onArchive(list.id, { archived: !list.userArchived })
    if (!error) {
      success(list.userArchived ? 'List restored' : 'List archived')
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
    {/* Main card content */}
    <div className="bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
      {/* Card row */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3" data-tour="list-card">
      {/* Drag handle - only for active lists */}
      {!list.userArchived && dragHandleProps && (
        <div 
          className="text-gray-400 cursor-grab select-none text-lg tracking-tighter touch-none"
          {...dragHandleProps}
        >
          ⋮⋮
        </div>
      )}

      {/* Archive/Restore icon */}
      <button
        onClick={handleArchiveClick}
        className="text-xl flex-shrink-0 hover:opacity-70 text-coral"
        title={list.userArchived ? 'Restore list' : 'Archive list'}
        data-tour="list-archive"
      >
        {list.userArchived ? '▲' : '▼'}
      </button>

      {/* List name - click to navigate */}
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
          className="flex-1 min-w-0 px-2 py-1 border border-teal rounded text-lg font-medium"
          aria-label="List name"
        />
      ) : list.userArchived ? (
        <span
          className="flex-1 min-w-0 font-medium truncate text-lg text-gray-400 line-through"
        >
          {list.name}
          {!isOwner && list.ownerNickname && (
            <span className="text-teal ml-1">({list.ownerNickname})</span>
          )}
        </span>
      ) : (
        <Link
          href={`/list/${list.id}`}
          onClick={handleLinkClick}
          className="flex-1 min-w-0 font-medium truncate text-lg text-primary hover:text-teal"
        >
          {list.name}
          {!isOwner && list.ownerNickname && (
            <span className="text-teal ml-1">({list.ownerNickname})</span>
          )}
        </Link>
      )}

      {/* Visibility icon - only for owned lists, clickable to open share modal (except archived) */}
      {isOwner && (
        list.userArchived ? (
          <span
            className="text-lg flex-shrink-0 opacity-40"
            title={list.visibility === 'private' ? 'Private' : 'Shared by link'}
          >
            {list.visibility === 'private' ? '🔒' : '🔗'}
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowShareModal(true)
            }}
            className="text-lg flex-shrink-0 opacity-60 hover:opacity-100"
            title={list.visibility === 'private' ? 'Private - Click to share' : 'Shared by link - Click to manage'}
            data-tour="list-share"
          >
            {list.visibility === 'private' ? '🔒' : '🔗'}
          </button>
        )
      )}

      {/* Kebab menu button */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="text-gray-400 hover:text-gray-600 px-2 py-1 text-lg leading-none"
        data-tour="list-menu"
      >
        {menuOpen ? '✕' : '⋮'}
      </button>
      </div>

      {/* Expanded menu with comment field and action buttons */}
      {menuOpen && (
        <div className="px-3 py-2 bg-gray-100 border-t border-gray-200 space-y-2">
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
          {/* Action buttons - styled like member menu */}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {/* Rename - only for active lists, owner only */}
            {isOwner && !list.userArchived && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsRenaming(true)
                  setMenuOpen(false)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
              >
                Rename
              </button>
            )}
            {/* Duplicate - only for active lists */}
            {!list.userArchived && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDuplicate()
                  setMenuOpen(false)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
              >
                Duplicate
              </button>
            )}
            {/* Delete/Leave - always show */}
            {isOwner ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteClick()
                  setMenuOpen(false)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleLeaveClick()
                  setMenuOpen(false)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
              >
                Leave
              </button>
            )}
          </div>
        </div>
      )}
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
