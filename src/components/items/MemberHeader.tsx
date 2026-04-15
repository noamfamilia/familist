'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import type { CategoryNames, Member, MemberWithCreator } from '@/lib/supabase/types'
import { GearIcon } from '@/components/icons/GearIcon'

const CategoryNamesModal = dynamic(() => import('@/components/lists/CategoryNamesModal').then(mod => mod.CategoryNamesModal), {
  ssr: false,
})

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})

const Modal = dynamic(() => import('@/components/ui/Modal').then(mod => mod.Modal), {
  ssr: false,
})

interface MemberHeaderProps {
  members: MemberWithCreator[]
  allMembers: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onToggleHideDone: (memberId: string) => void
  onToggleHideNotRelevant: (memberId: string) => void
  onAddMember: (name: string, creatorNickname?: string) => Promise<{ error?: { message?: string } | null }>
  onUpdateMember: (memberId: string, updates: Partial<MemberWithCreator>) => Promise<{ error?: { message: string } | null }>
  onDeleteMember: (memberId: string) => Promise<{ error?: { message: string } | null }>
  onOwnMember?: (memberId: string, creatorNickname?: string) => Promise<{ error?: { message: string } | null; newMemberId?: string }>
  listId: string
  showAddMember?: boolean
  itemTextWidth?: number
  itemTextWidthMode?: 'auto' | 'manual'
  onWidthChange?: (delta: number) => void
  onWidthModeToggle?: () => void
  showActionsMenu?: boolean
  actionsMenuLoading?: boolean
  hasArchivedItems?: boolean
  onCategorySortClick?: () => void | Promise<void>
  onExpandAll?: () => void
  onCollapseAll?: () => void
  onDeleteAllArchived?: () => void
  onRestoreAllArchived?: () => void
  isOwner?: boolean
  categoryNames?: CategoryNames
  categoryOrder?: number[]
  onUpdateCategoryNames?: (names: CategoryNames) => Promise<{ error: unknown }>
  onUpdateCategoryOrder?: (order: number[]) => Promise<{ error: unknown }>
}

export function MemberHeader({
  members,
  allMembers,
  hideDone,
  hideNotRelevant,
  onToggleHideDone,
  onToggleHideNotRelevant,
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  onOwnMember,
  listId,
  showAddMember = true,
  itemTextWidth = 80,
  itemTextWidthMode = 'auto',
  onWidthChange,
  onWidthModeToggle,
  showActionsMenu = false,
  actionsMenuLoading = false,
  hasArchivedItems = false,
  onCategorySortClick,
  onExpandAll,
  onCollapseAll,
  onDeleteAllArchived,
  onRestoreAllArchived,
  isOwner = false,
  categoryNames,
  categoryOrder,
  onUpdateCategoryNames,
  onUpdateCategoryOrder,
}: MemberHeaderProps) {
  const { user, profile } = useAuth()
  const { success: showSuccess, error: showError } = useToast()

  const suggestedName = useMemo(() => {
    const base = profile?.nickname?.trim()
    if (!base) return ''
    const names = new Set(allMembers.map(m => m.name))
    if (!names.has(base)) return base
    let i = 2
    while (names.has(`${base}${i}`)) i++
    return `${base}${i}`
  }, [profile?.nickname, allMembers])

  const [isAdding, setIsAdding] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const actionsButtonRef = useRef<HTMLButtonElement>(null)

  const closeActions = () => {
    setActionsOpen(false)
    setActionsMenuPos(null)
  }

  const handleToggleActions = () => {
    if (actionsOpen) {
      closeActions()
    } else {
      if (actionsButtonRef.current) {
        const rect = actionsButtonRef.current.getBoundingClientRect()
        setActionsMenuPos({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        })
      }
      setActionsOpen(true)
    }
  }

  useEffect(() => {
    if (!actionsOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node) &&
          actionsButtonRef.current && !actionsButtonRef.current.contains(e.target as Node)) {
        closeActions()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActions()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [actionsOpen])

  const [newMemberName, setNewMemberName] = useState('')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [ownConfirm, setOwnConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [ownLoading, setOwnLoading] = useState(false)

  const handleAddMember = async () => {
    const fallbackName = suggestedName
    const nameToAdd = newMemberName.trim() || fallbackName
    if (!nameToAdd) {
      setNewMemberName('')
      setIsAdding(false)
      return
    }
    
    const nameExists = members.some(m => m.name.toLowerCase() === nameToAdd.toLowerCase())
    if (nameExists) {
      showError(`Member "${nameToAdd}" already exists`)
      return
    }
    
    setNewMemberName('')
    setIsAdding(false)
    const { error } = await onAddMember(nameToAdd, profile?.nickname || undefined)
    if (error) {
      setNewMemberName(nameToAdd)
      setIsAdding(true)
      showError(error.message || 'Failed to add member')
      return
    }
  }

  const handleCancelAddMember = () => {
    setNewMemberName('')
    setIsAdding(false)
  }

  const handleCancelEdit = () => {
    setEditingMemberId(null)
    setEditName('')
  }

  const handleStartEdit = (member: Member) => {
    setEditingMemberId(member.id)
    setEditName(member.name)
    setOpenMenuId(member.id)
    setMemberMenuPos(null)
  }

  const handleSaveEdit = async () => {
    if (editingMemberId && editName.trim()) {
      const trimmedName = editName.trim()
      
      const nameExists = members.some(m => 
        m.id !== editingMemberId && m.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (nameExists) {
        showError(`Member "${trimmedName}" already exists`)
        const originalMember = members.find(m => m.id === editingMemberId)
        setEditName(originalMember?.name || '')
        return
      }
      
      const { error } = await onUpdateMember(editingMemberId, { name: trimmedName })
      if (error) {
        showError(error.message || 'Failed to update member')
        return
      }
    }
    handleCancelEdit()
  }

  const handleDeleteClick = (member: Member) => {
    setDeleteConfirm({ open: true, memberId: member.id, memberName: member.name })
    closeMemberMenu()
  }

  const handleConfirmDelete = async () => {
    if (!deleteConfirm.memberId) return
    
    setDeleteLoading(true)
    const { error } = await onDeleteMember(deleteConfirm.memberId)
    setDeleteLoading(false)
    
    if (error) {
      showError(error.message || 'Failed to delete member')
    }
    setDeleteConfirm({ open: false, memberId: null, memberName: '' })
  }

  const handleTogglePublic = async (member: MemberWithCreator) => {
    const { error } = await onUpdateMember(member.id, { is_public: !member.is_public })
    if (error) {
      showError(error.message || 'Failed to update member')
    }
  }

  const handleOwnClick = (member: MemberWithCreator) => {
    setOwnConfirm({ open: true, memberId: member.id, memberName: member.name })
    closeMemberMenu()
  }

  const handleConfirmOwn = async () => {
    if (!ownConfirm.memberId || !onOwnMember) return
    setOwnLoading(true)
    const { error, newMemberId } = await onOwnMember(ownConfirm.memberId, profile?.nickname || undefined)
    setOwnLoading(false)
    if (error) {
      showError(error.message || 'Failed to take ownership')
    } else {
      showSuccess(`You now own "${ownConfirm.memberName}"`)
      closeMemberMenu()
    }
    setOwnConfirm({ open: false, memberId: null, memberName: '' })
  }

  const openMember = openMenuId ? members.find(m => m.id === openMenuId) : null
  const isOpenMemberOwner = openMember?.created_by === user?.id

  const memberMenuRef = useRef<HTMLDivElement>(null)
  const headerCardRef = useRef<HTMLDivElement>(null)
  const chipRefsMap = useRef<Map<string, HTMLDivElement>>(new Map())
  const [memberMenuPos, setMemberMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const renamePopoverRef = useRef<HTMLDivElement>(null)
  const addMemberPopoverRef = useRef<HTMLDivElement>(null)
  const addMemberContainerRef = useRef<HTMLDivElement>(null)

  const MENU_WIDTH = 224 // w-56

  const computeMenuPos = useCallback((chipEl: HTMLDivElement) => {
    const chipRect = chipEl.getBoundingClientRect()
    const cardRect = headerCardRef.current?.getBoundingClientRect()
    const top = chipRect.bottom + 4
    if (!cardRect) {
      setMemberMenuPos({ top, left: chipRect.left })
      return
    }
    const vw = window.innerWidth
    if (chipRect.left + MENU_WIDTH <= vw) {
      setMemberMenuPos({ top, left: chipRect.left })
    } else if (chipRect.right - MENU_WIDTH >= cardRect.left) {
      setMemberMenuPos({ top, right: vw - chipRect.right })
    } else {
      const cardCenter = cardRect.left + cardRect.width / 2
      setMemberMenuPos({ top, left: cardCenter - MENU_WIDTH / 2 })
    }
  }, [])

  const handleChipClick = useCallback((memberId: string) => {
    if (openMenuId === memberId) {
      setOpenMenuId(null)
      setMemberMenuPos(null)
      return
    }
    setEditingMemberId(null)
    setEditName('')
    setOpenMenuId(memberId)
    const chipEl = chipRefsMap.current.get(memberId)
    if (chipEl) computeMenuPos(chipEl)
  }, [openMenuId, computeMenuPos])

  const closeMemberMenu = useCallback(() => {
    setOpenMenuId(null)
    setMemberMenuPos(null)
  }, [])

  // Outside-click and escape to close member menu
  useEffect(() => {
    if (!openMenuId) return
    const handleClickOutside = (e: MouseEvent) => {
      const menuEl = memberMenuRef.current
      const chipEl = chipRefsMap.current.get(openMenuId)
      const renameEl = renamePopoverRef.current
      if (menuEl && menuEl.contains(e.target as Node)) return
      if (chipEl && chipEl.contains(e.target as Node)) return
      if (renameEl && renameEl.contains(e.target as Node)) return
      closeMemberMenu()
      setEditingMemberId(null)
      setEditName('')
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingMemberId) {
          handleCancelEdit()
        } else {
          closeMemberMenu()
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [openMenuId, closeMemberMenu, editingMemberId])

  // Outside-click to save rename popover
  useEffect(() => {
    if (!editingMemberId) return
    const handleMouseDown = (e: MouseEvent) => {
      if (renamePopoverRef.current && !renamePopoverRef.current.contains(e.target as Node)) {
        void handleSaveEdit()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  // Outside-click to close add member popover
  useEffect(() => {
    if (!isAdding) return
    const handleMouseDown = (e: MouseEvent) => {
      if (addMemberContainerRef.current && !addMemberContainerRef.current.contains(e.target as Node)) {
        handleCancelAddMember()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  })

  return (
    <div className="mb-3 min-w-full w-max">
      {/* Header card container */}
      <div ref={headerCardRef} className="bg-gray-50 dark:bg-slate-900 rounded-lg">
        {/* Header row - matching item card styling */}
        <div className="relative flex items-center gap-0.5 pl-3 pr-1 py-1 whitespace-nowrap">
          <div className="w-5 flex-shrink-0 h-[40px]" />
          <div
            className="flex-shrink-0 h-[40px] flex items-center justify-between"
            style={{ width: itemTextWidth }}
            data-tour="item-text-width"
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onWidthChange?.(-20)
              }}
              disabled={itemTextWidth <= 80}
              className={`h-[32px] flex items-center touch-manipulation disabled:opacity-30 text-sm ${
                itemTextWidthMode === 'manual' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
              }`}
              aria-label="Narrow item name column"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (itemTextWidthMode !== 'auto') onWidthModeToggle?.()
              }}
              className={`text-[11px] font-medium leading-none touch-manipulation select-none ${
                itemTextWidthMode === 'auto' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
              }`}
            >
              Auto
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onWidthChange?.(20)
              }}
              className={`h-[32px] flex items-center touch-manipulation disabled:opacity-30 text-sm ${
                itemTextWidthMode === 'manual' ? 'text-teal' : 'text-gray-400 dark:text-gray-500 hover:text-teal'
              }`}
              aria-label="Widen item name column"
            >
              ▶
            </button>
          </div>
          
          {/* Members section */}
          <div className="flex items-center ml-2 flex-shrink-0 gap-2.5">
            {members.map(member => {
              const isMenuOpen = openMenuId === member.id
              const isRenaming = editingMemberId === member.id
              const isMemberOwner = member.created_by === user?.id
              
              return (
                <div key={member.id} className="relative">
                  <div
                    ref={(el) => { if (el) chipRefsMap.current.set(member.id, el); else chipRefsMap.current.delete(member.id) }}
                    className={`relative flex items-center justify-center px-2 py-1 rounded-lg border w-[90px] h-[40px] transition-colors ${
                      isMenuOpen
                        ? 'bg-cyan border-cyan text-white'
                        : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600'
                    } ${!isMemberOwner && !isMenuOpen ? 'opacity-50' : ''} ${!isRenaming ? 'cursor-pointer' : ''}`}
                    data-tour="member-chip"
                    onClick={() => {
                      if (!isRenaming) handleChipClick(member.id)
                    }}
                  >
                    <span className="text-lg truncate flex-1 text-center">
                      {member.name}
                    </span>
                  </div>
                  {/* Rename popover */}
                  {isRenaming && (
                    <div
                      ref={renamePopoverRef}
                      className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg p-2 min-w-[160px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="relative">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="w-full px-3 py-1.5 pr-8 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:border-teal bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setEditName('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* +Task button */}
          {showAddMember && (
            <div ref={addMemberContainerRef} className="relative ml-2.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => isAdding ? void handleAddMember() : setIsAdding(true)}
                className={`flex items-center justify-center rounded-lg text-lg hover:opacity-80 transition-colors h-[40px] w-[90px] ${isAdding ? 'bg-cyan text-white font-medium' : 'bg-white dark:bg-slate-800 text-black dark:text-gray-200 border border-gray-200 dark:border-slate-600'}`}
                data-tour="add-member"
              >
                {isAdding ? 'Add' : '+Task'}
              </button>
              {isAdding && (
                <div
                  ref={addMemberPopoverRef}
                  className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-600 shadow-lg p-2 min-w-[160px]"
                >
                  <div className="relative">
                    <input
                      type="text"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleAddMember()
                        if (e.key === 'Escape') handleCancelAddMember()
                      }}
                      placeholder={suggestedName || 'Name'}
                      className="w-full px-3 py-1.5 pr-8 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:outline-none focus:border-teal bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setNewMemberName('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Gear menu - aligned to right edge matching item card trailing section */}
          <div className="flex-shrink-0 flex items-center ml-auto pl-2.5">
          {showActionsMenu && (
            <div className="relative">
              <button
                ref={actionsButtonRef}
                type="button"
                data-tour="category-sort"
                disabled={actionsMenuLoading}
                onClick={handleToggleActions}
                className="flex items-center justify-center rounded-lg w-[40px] h-[40px] touch-manipulation transition-colors bg-cyan text-white hover:opacity-80 disabled:opacity-50 disabled:pointer-events-none"
                aria-label="List actions"
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
              >
                <GearIcon className="w-5 h-5" />
              </button>
              {actionsOpen && actionsMenuPos && (
                <div
                  ref={actionsMenuRef}
                  className="fixed w-48 flex flex-col rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 py-1 z-50"
                  role="menu"
                  style={{ top: actionsMenuPos.top, right: actionsMenuPos.right }}
                >
                  {onUpdateCategoryNames && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        setShowCategoryModal(true)
                      }}
                    >
                      Set categories
                    </button>
                  )}
                  {onCategorySortClick && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        void onCategorySortClick()
                      }}
                    >
                      Sort by category
                    </button>
                  )}
                  {(onUpdateCategoryNames || onCategorySortClick) && (
                    <div className="my-1 h-px bg-gray-200" role="separator" />
                  )}
                  {onExpandAll && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        onExpandAll()
                      }}
                    >
                      Expand all items
                    </button>
                  )}
                  {onCollapseAll && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        onCollapseAll()
                      }}
                    >
                      Collapse all items
                    </button>
                  )}
                  {hasArchivedItems && (onRestoreAllArchived || onDeleteAllArchived) && (
                    <div className="my-1 h-px bg-gray-200" role="separator" />
                  )}
                  {hasArchivedItems && onRestoreAllArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        onRestoreAllArchived()
                      }}
                    >
                      Restore all archived
                    </button>
                  )}
                  {hasArchivedItems && onDeleteAllArchived && (
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                      onClick={() => {
                        closeActions()
                        onDeleteAllArchived()
                      }}
                    >
                      Delete all archived
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        </div>

      </div>

      {/* Floating member dropdown menu */}
      {openMenuId && openMember && memberMenuPos && !editingMemberId && (
        <div
          ref={memberMenuRef}
          className="fixed w-64 flex flex-col rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 py-1 z-50"
          role="menu"
          style={{ top: memberMenuPos.top, left: memberMenuPos.left, right: memberMenuPos.right }}
        >
          {isOpenMemberOwner ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
                onClick={() => handleStartEdit(openMember)}
              >
                Task: {openMember.name}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 opacity-40">
                  <path fillRule="evenodd" clipRule="evenodd" d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"/>
                </svg>
              </button>
              <hr className="border-gray-200 dark:border-slate-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                onClick={() => void handleTogglePublic(openMember)}
              >
                Owner: {openMember.creator?.nickname || 'Unknown'}
                <br />
                <span className={`text-xs ${openMember.is_public ? 'text-cyan' : 'text-gray-400'}`}>
                  {openMember.is_public ? '(click to reclaim ownership)' : '(click to transfer ownership)'}
                </span>
              </button>
              <hr className="border-gray-200 dark:border-slate-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                onClick={() => {
                  const isShowingAll = !hideDone[openMember.id] || !hideNotRelevant[openMember.id]
                  if (isShowingAll) {
                    if (!hideDone[openMember.id]) onToggleHideDone(openMember.id)
                    if (!hideNotRelevant[openMember.id]) onToggleHideNotRelevant(openMember.id)
                  } else {
                    if (hideDone[openMember.id]) onToggleHideDone(openMember.id)
                    if (hideNotRelevant[openMember.id]) onToggleHideNotRelevant(openMember.id)
                  }
                }}
              >
                {hideDone[openMember.id] && hideNotRelevant[openMember.id]
                  ? 'Show all items'
                  : 'Show only uncompleted items'}
              </button>
              <hr className="border-gray-200 dark:border-slate-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50 dark:hover:bg-slate-700"
                onClick={() => handleDeleteClick(openMember)}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <div className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 cursor-default">
                Task: {openMember.name}
              </div>
              <hr className="border-gray-200 dark:border-slate-600 mx-2" />
              {openMember.is_public ? (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  onClick={() => handleOwnClick(openMember)}
                >
                  Owner: {openMember.creator?.nickname || 'Unknown'}
                  <br />
                  <span className="text-xs text-cyan">(click to grab ownership)</span>
                </button>
              ) : (
                <div className="px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 cursor-default">
                  Owner: {openMember.creator?.nickname || 'Unknown'}
                </div>
              )}
              <hr className="border-gray-200 dark:border-slate-600 mx-2" />
              <button
                type="button"
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                onClick={() => {
                  const isShowingAll = !hideDone[openMember.id] || !hideNotRelevant[openMember.id]
                  if (isShowingAll) {
                    if (!hideDone[openMember.id]) onToggleHideDone(openMember.id)
                    if (!hideNotRelevant[openMember.id]) onToggleHideNotRelevant(openMember.id)
                  } else {
                    if (hideDone[openMember.id]) onToggleHideDone(openMember.id)
                    if (hideNotRelevant[openMember.id]) onToggleHideNotRelevant(openMember.id)
                  }
                }}
              >
                {hideDone[openMember.id] && hideNotRelevant[openMember.id]
                  ? 'Show all items'
                  : 'Show only uncompleted items'}
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, memberId: null, memberName: '' })}
        onConfirm={handleConfirmDelete}
        title="Delete Member"
        message={`Delete "${deleteConfirm.memberName}"? Their quantities and done states will be removed from all items.`}
        confirmText="Delete"
        variant="danger"
        loading={deleteLoading}
      />

      <Modal
        isOpen={ownConfirm.open}
        onClose={() => setOwnConfirm({ open: false, memberId: null, memberName: '' })}
        size="xs"
        hideClose
      >
        <div>
          <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
            Take ownership of &ldquo;{ownConfirm.memberName}&rdquo;?
          </p>
          <div className="flex justify-center gap-6 mb-1">
            <button
              type="button"
              onClick={() => setOwnConfirm({ open: false, memberId: null, memberName: '' })}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmOwn()}
              disabled={ownLoading}
              className="px-4 py-2 text-sm text-white rounded-lg bg-cyan hover:opacity-80 disabled:opacity-50"
            >
              {ownLoading ? 'Taking...' : 'OK'}
            </button>
          </div>
        </div>
      </Modal>

      {onUpdateCategoryNames && onUpdateCategoryOrder && categoryNames && (
        <CategoryNamesModal
          isOpen={showCategoryModal}
          onClose={() => setShowCategoryModal(false)}
          categoryNames={categoryNames}
          categoryOrder={categoryOrder || [1, 2, 3, 4, 5, 6]}
          onSave={async (names, order) => {
            const r1 = await onUpdateCategoryNames(names)
            const r2 = await onUpdateCategoryOrder(order)
            return { error: r1.error || r2.error }
          }}
        />
      )}
    </div>
  )
}
