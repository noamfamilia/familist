'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useToast } from '@/components/ui/Toast'
import { ShareCardIcon } from '@/components/ui/ShareIcons'
import type { CategoryNames, ListWithRole } from '@/lib/supabase/types'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})
const ShareModal = dynamic(() => import('./ShareModal').then(mod => mod.ShareModal), {
  ssr: false,
})
const CategoryNamesModal = dynamic(() => import('./CategoryNamesModal').then(mod => mod.CategoryNamesModal), {
  ssr: false,
})

interface ListCardProps {
  list: ListWithRole
  existingListNames: string[]
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  onUpdate: (listId: string, updates: { name?: string; archived?: boolean; comment?: string }) => Promise<{ error: Error | null }>
  onDelete: (listId: string) => Promise<{ error: Error | null }>
  onArchive: (listId: string, updates: { archived?: boolean }) => Promise<{ error: Error | null }>
  onDuplicate: (listId: string, newName: string) => Promise<{ error: Error | null; warning?: string | null }>
  onLeave: (listId: string) => Promise<{ error: Error | null }>
  onUpdateCategoryNames?: (listId: string, names: CategoryNames, order: number[]) => Promise<{ error: unknown }>
  onRefresh?: () => void
  dragHandleProps?: Record<string, unknown>
}

export function ListCard({ list, existingListNames, categoryNames, categoryOrder, onUpdate, onDelete, onArchive, onDuplicate, onLeave, onUpdateCategoryNames, onRefresh, dragHandleProps }: ListCardProps) {
  const { error: showError } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(list.name)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showCategoryNamesModal, setShowCategoryNamesModal] = useState(false)
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

  const handleCancelRename = () => {
    setNewName(list.name)
    setIsRenaming(false)
  }

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

  const handleArchiveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    // Toggle archive state
    await onArchive(list.id, { archived: !list.userArchived })
  }

  const handleRename = async () => {
    if (newName.trim() && newName !== list.name) {
      const { error } = await onUpdate(list.id, { name: newName.trim() })
      if (error) {
        showError('Failed to rename list')
        setNewName(list.name)
      }
    }
    setIsRenaming(false)
  }

  const handleArchive = async () => {
    await onArchive(list.id, { archived: !list.userArchived })
  }

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    setDeleting(true)
    const { error } = await onDelete(list.id)
    if (error) {
      showError('Failed to delete list')
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const handleDuplicate = async () => {
    // Prevent double clicks
    if (duplicating) return
    setDuplicating(true)

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

    const { error, warning } = await onDuplicate(list.id, dupName)
    if (error) {
      showError('Failed to duplicate list')
    } else if (warning) {
      showError(warning)
    }
    setDuplicating(false)
  }

  const handleLeaveClick = () => {
    setShowLeaveConfirm(true)
  }

  const handleLeaveConfirm = async () => {
    setLeaving(true)
    const { error } = await onLeave(list.id)
    if (error) {
      showError('Failed to leave list')
    }
    setLeaving(false)
    setShowLeaveConfirm(false)
  }

  const ownerBadge = !isOwner && list.ownerNickname ? (
    <span className="ml-1 inline-flex items-center gap-1 align-middle text-xs text-gray-400">
      <span aria-hidden="true">·</span>
      <bdi dir="auto">{list.ownerNickname}</bdi>
    </span>
  ) : null

  return (
    <>
    {/* Main card content */}
    <div className="bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
      {/* Card row */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
      {/* Drag handle - only for active lists */}
      {!list.userArchived && dragHandleProps && (
        <div 
          className="text-gray-400 cursor-grab select-none text-lg tracking-tighter touch-none"
          {...dragHandleProps}
          data-tour="list-drag-handle"
        >
          ⋮⋮
        </div>
      )}

      {/* Archive/Restore icon */}
      <button
        onClick={handleArchiveClick}
        className="text-xl flex-shrink-0 hover:opacity-70 text-coral"
        data-tour="list-archive"
      >
        {list.userArchived ? '▲' : '▼'}
      </button>

      {/* List name — tour highlights just the text */}
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={handleCancelRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') {
              handleCancelRename()
            }
          }}
          className="flex-1 min-w-0 px-2 py-1 border border-teal rounded text-lg font-medium"
          aria-label="List name"
        />
      ) : list.userArchived ? (
        <span
          className="flex-1 min-w-0 font-medium truncate text-lg text-gray-400 line-through"
          data-tour="list-card"
        >
          {list.name}
          {ownerBadge}
        </span>
      ) : (
        <Link
          href={`/list/${list.id}`}
          className="flex-1 min-w-0 font-medium truncate text-lg text-primary hover:text-teal"
          data-tour="list-card"
        >
          {list.name}
          {ownerBadge}
        </Link>
      )}

      {/* Visibility icon - only for owned lists, clickable to open share modal (except archived) */}
      {isOwner && (
        list.userArchived ? (
          <span
            className={`flex-shrink-0 opacity-40 ${list.visibility === 'link' ? 'text-cyan' : 'text-red-500'}`}
          >
            <ShareCardIcon emphasized={list.visibility === 'link'} />
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowShareModal(true)
            }}
            className={`flex-shrink-0 opacity-60 hover:opacity-100 ${
              list.visibility === 'link' ? 'text-cyan' : 'text-red-500'
            }`}
            data-tour="list-share"
          >
            <ShareCardIcon emphasized={list.visibility === 'link'} />
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
                  if (isRenaming) {
                    void handleRename()
                    return
                  }
                  setNewName(list.name)
                  setIsRenaming(true)
                }}
                onMouseDown={(e) => {
                  if (isRenaming) e.preventDefault()
                }}
                className={`px-3 py-1.5 text-sm text-white rounded-lg ${
                  isRenaming ? 'bg-red-500 hover:bg-red-600' : 'bg-teal hover:opacity-80'
                }`}
              >
                {isRenaming ? 'Done' : 'Rename'}
              </button>
            )}
            {/* Categories - owner only, active lists */}
            {isOwner && !list.userArchived && onUpdateCategoryNames && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowCategoryNamesModal(true)
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-cyan"
              >
                Categories
              </button>
            )}
            {/* Duplicate - only for active lists */}
            {!list.userArchived && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleDuplicate()
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
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleLeaveClick()
                }}
                className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500"
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

    {isOwner && onUpdateCategoryNames && categoryNames && (
      <CategoryNamesModal
        isOpen={showCategoryNamesModal}
        onClose={() => setShowCategoryNamesModal(false)}
        categoryNames={categoryNames}
        categoryOrder={categoryOrder || [1, 2, 3, 4, 5, 6]}
        onSave={(names, order) => onUpdateCategoryNames(list.id, names, order)}
      />
    )}
  </>
  )
}
