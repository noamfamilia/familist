'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import type { CategoryNames, Member, MemberWithCreator } from '@/lib/supabase/types'
import { GearIcon } from '@/components/icons/GearIcon'

const CategoryNamesModal = dynamic(() => import('@/components/lists/CategoryNamesModal').then(mod => mod.CategoryNamesModal), {
  ssr: false,
})

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
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
    setOpenMenuId(null)
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
    const newPublic = !member.is_public
    const { error } = await onUpdateMember(member.id, { is_public: newPublic })
    if (error) {
      showError(error.message || 'Failed to update member')
    } else {
      showSuccess(newPublic
        ? `Any user can edit status of ${member.name}`
        : `Only you can edit status of ${member.name}`)
    }
  }

  const handleOwnClick = (member: MemberWithCreator) => {
    setOwnConfirm({ open: true, memberId: member.id, memberName: member.name })
    setOpenMenuId(null)
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
      if (newMemberId) setOpenMenuId(newMemberId)
    }
    setOwnConfirm({ open: false, memberId: null, memberName: '' })
  }

  const openMember = openMenuId ? members.find(m => m.id === openMenuId) : null
  const openMemberIndex = openMenuId ? members.findIndex(m => m.id === openMenuId) : -1
  const isOpenMemberOwner = openMember?.created_by === user?.id

  const memberMenuRef = useRef<HTMLDivElement>(null)
  const memberMenuContainerRef = useRef<HTMLDivElement>(null)
  const [menuPaddingRight, setMenuPaddingRight] = useState<number>(0)

  useEffect(() => {
    if (!openMenuId || openMemberIndex < 0) return
    const chipRightEdge = 12 + 20 + 2 + itemTextWidth + 2 + 8 + (openMemberIndex + 1) * 90 + openMemberIndex * 10

    // First render with ideal alignment, then measure and clamp
    setMenuPaddingRight(-1) // sentinel to trigger measurement

    requestAnimationFrame(() => {
      const container = memberMenuContainerRef.current
      const wrapper = memberMenuRef.current
      if (!container || !wrapper) return

      // Temporarily set ideal padding to measure
      const containerWidth = container.offsetWidth
      const idealPR = Math.max(0, containerWidth - chipRightEdge)
      wrapper.style.paddingRight = `${idealPR}px`

      // Measure widest row's content width
      const gap = 12 // gap-3 = 12px
      let maxRowWidth = 0
      for (let r = 0; r < wrapper.children.length; r++) {
        const row = wrapper.children[r] as HTMLElement
        let rowWidth = 0
        for (let i = 0; i < row.children.length; i++) {
          rowWidth += (row.children[i] as HTMLElement).offsetWidth
        }
        rowWidth += Math.max(0, row.children.length - 1) * gap
        maxRowWidth = Math.max(maxRowWidth, rowWidth)
      }

      // If content + idealPR exceeds container, reduce paddingRight
      const available = containerWidth
      const needed = maxRowWidth + idealPR
      if (needed > available) {
        setMenuPaddingRight(Math.max(0, idealPR - (needed - available)))
      } else {
        setMenuPaddingRight(idealPR)
      }
    })
  }, [openMenuId, openMemberIndex, itemTextWidth])

  return (
    <div className="mb-3 min-w-full w-max">
      {/* Header card container */}
      <div className={`bg-gray-50 dark:bg-slate-900 ${openMenuId ? 'rounded-t-lg' : 'rounded-lg'}`}>
        {/* Header row - matching item card styling */}
        <div className="relative flex items-center gap-0.5 pl-3 pr-1 py-1 whitespace-nowrap">
          {openMenuId && (
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 z-[5] rounded-t-lg pointer-events-none" />
          )}
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
              const isHidden = openMenuId && !isMenuOpen
              
              return (
                <div key={member.id} className={isMenuOpen ? 'relative z-10' : ''}>
                  {/* Member container - fixed size to match item state containers */}
                  <div
                    className={`relative flex items-center justify-center px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 w-[90px] h-[40px] ${editingMemberId !== member.id ? 'cursor-pointer' : ''}`}
                    data-tour="member-chip"
                    onClick={() => {
                      if (editingMemberId !== member.id) setOpenMenuId(isMenuOpen ? null : member.id)
                    }}
                  >
                    {editingMemberId === member.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={handleCancelEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit()
                          if (e.key === 'Escape') {
                            handleCancelEdit()
                          }
                        }}
                        className="w-14 px-1 py-0.5 text-sm border border-teal rounded"
                        autoFocus
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className="text-lg truncate flex-1 text-center">
                        {member.name}
                      </span>
                    )}
                    {isMenuOpen && editingMemberId !== member.id && (
                      <span className="absolute top-0.5 right-1 text-gray-400 dark:text-gray-500 text-xs leading-none">✕</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* +Task button */}
          {showAddMember && (
            <div className="relative ml-2.5 flex-shrink-0">
              {isAdding ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    onBlur={handleCancelAddMember}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddMember()
                      if (e.key === 'Escape') {
                        handleCancelAddMember()
                      }
                    }}
                    placeholder={suggestedName || 'Name'}
                    className="w-[90px] h-[40px] px-2 py-0.5 text-lg border border-teal rounded-lg bg-white dark:bg-slate-800"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleAddMember}
                    onMouseDown={(e) => e.preventDefault()}
                    className="px-3 h-[40px] text-sm text-white rounded-lg bg-red-500 hover:bg-red-600"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAdding(true)}
                  className="flex items-center justify-center rounded-lg bg-cyan text-white text-base font-medium hover:opacity-80 transition-colors w-[90px] h-[40px]"
                  data-tour="add-member"
                >
                  +Task
                </button>
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

        {/* Expanded menu - right-aligned to selected member chip, items flow right-to-left */}
        {openMenuId && openMember && openMemberIndex >= 0 && (
          <div ref={memberMenuContainerRef} className="py-2 bg-gray-50 dark:bg-slate-900 rounded-b-lg overflow-hidden">
            <div
              ref={memberMenuRef}
              className="flex flex-col gap-2"
              style={{ paddingRight: menuPaddingRight >= 0 ? menuPaddingRight : undefined }}
            >
              {/* Row 1 */}
              <div className="flex flex-row-reverse items-center gap-3">
                {isOpenMemberOwner ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteClick(openMember)
                      }}
                      className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-red-500"
                    >
                      Delete
                    </button>
                    <Toggle
                      options={[
                        { value: 'private', label: 'Private' },
                        { value: 'public', label: 'Public' },
                      ]}
                      value={openMember.is_public ? 'public' : 'private'}
                      onChange={(v) => {
                        const wantPublic = v === 'public'
                        if (wantPublic !== openMember.is_public) handleTogglePublic(openMember)
                      }}
                      variant="menu"
                    />
                  </>
                ) : (
                  <>
                    {openMember.is_public && onOwnMember && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOwnClick(openMember)
                        }}
                        className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
                      >
                        Own It!
                      </button>
                    )}
                    {openMember.creator?.nickname && (
                      <span className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                        Owner: {openMember.creator.nickname}
                      </span>
                    )}
                  </>
                )}
              </div>
              {/* Row 2 */}
              <div className="flex flex-row-reverse items-center gap-3">
                {isOpenMemberOwner && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (editingMemberId === openMember.id) {
                        void handleSaveEdit()
                        return
                      }
                      handleStartEdit(openMember)
                    }}
                    onMouseDown={(e) => {
                      if (editingMemberId === openMember.id) e.preventDefault()
                    }}
                    className={`px-3 py-1.5 text-sm text-white rounded-lg ${
                      editingMemberId === openMember.id ? 'bg-red-500 hover:bg-red-600' : 'bg-cyan hover:opacity-80'
                    }`}
                  >
                    {editingMemberId === openMember.id ? 'Done' : 'Rename'}
                  </button>
                )}
                <Toggle
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'todo', label: 'To do' },
                  ]}
                  value={hideDone[openMember.id] && hideNotRelevant[openMember.id] ? 'todo' : 'all'}
                  onChange={(v) => {
                    const showTodo = v === 'todo'
                    if (showTodo !== hideDone[openMember.id]) onToggleHideDone(openMember.id)
                    if (showTodo !== hideNotRelevant[openMember.id]) onToggleHideNotRelevant(openMember.id)
                  }}
                  variant="menu"
                />
              </div>
            </div>
          </div>
        )}
      </div>

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

      <ConfirmModal
        isOpen={ownConfirm.open}
        onClose={() => setOwnConfirm({ open: false, memberId: null, memberName: '' })}
        onConfirm={handleConfirmOwn}
        title="Take Ownership"
        message={`Take ownership of "${ownConfirm.memberName}"? It will become your private member.`}
        confirmText="Own It!"
        loading={ownLoading}
      />

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
