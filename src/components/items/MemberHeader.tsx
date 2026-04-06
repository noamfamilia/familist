'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import type { Member, MemberWithCreator } from '@/lib/supabase/types'
import { SortAmountDownIcon } from '@/components/icons/SortAmountDownIcon'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})

interface MemberHeaderProps {
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onToggleHideDone: (memberId: string) => void
  onToggleHideNotRelevant: (memberId: string) => void
  onAddMember: (name: string, creatorNickname?: string) => Promise<{ error?: { message?: string } | null }>
  onUpdateMember: (memberId: string, updates: Partial<MemberWithCreator>) => Promise<{ error?: { message: string } | null }>
  onDeleteMember: (memberId: string) => Promise<{ error?: { message: string } | null }>
  listId: string
  showAddMember?: boolean
  itemTextWidth?: number
  itemTextWidthMode?: 'auto' | 'manual'
  onWidthChange?: (delta: number) => void
  onWidthModeToggle?: () => void
  showCategorySort?: boolean
  categorySortLoading?: boolean
  onCategorySortClick?: () => void | Promise<void>
}

export function MemberHeader({
  members,
  hideDone,
  hideNotRelevant,
  onToggleHideDone,
  onToggleHideNotRelevant,
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  listId,
  showAddMember = true,
  itemTextWidth = 80,
  itemTextWidthMode = 'auto',
  onWidthChange,
  onWidthModeToggle,
  showCategorySort = false,
  categorySortLoading = false,
  onCategorySortClick,
}: MemberHeaderProps) {
  const { user, profile } = useAuth()
  const { error: showError } = useToast()
  const [isAdding, setIsAdding] = useState(false)
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

  const handleAddMember = async () => {
    const fallbackName = profile?.nickname?.trim() || ''
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
    const { error } = await onUpdateMember(member.id, { is_public: !member.is_public })
    if (error) {
      showError(error.message || 'Failed to update member')
    }
  }

  const openMember = openMenuId ? members.find(m => m.id === openMenuId) : null
  const isOpenMemberOwner = openMember?.created_by === user?.id

  return (
    <div className="mb-3 min-w-full w-max">
      {/* Header card container */}
      <div className={`bg-gray-50 ${openMenuId ? 'rounded-t-lg' : 'rounded-lg'}`}>
        {/* Header row - matching item card styling */}
        <div className="flex items-center gap-0.5 px-3 py-1 whitespace-nowrap">
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
              disabled={itemTextWidthMode === 'auto' || itemTextWidth <= 80}
              className="h-[32px] flex items-center touch-manipulation text-gray-400 hover:text-teal disabled:opacity-30 text-sm"
              aria-label="Narrow item name column"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onWidthModeToggle?.()
              }}
              className="text-[11px] font-medium leading-none touch-manipulation text-gray-400 hover:text-teal select-none"
            >
              {itemTextWidthMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onWidthChange?.(20)
              }}
              disabled={itemTextWidthMode === 'auto'}
              className="h-[32px] flex items-center touch-manipulation text-gray-400 hover:text-teal disabled:opacity-30 text-sm"
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
                <div key={member.id} className={isHidden ? 'invisible' : ''}>
                  {/* Member container - fixed size to match item state containers */}
                  <div
                    className="flex items-center justify-between px-2 py-1 rounded-lg border border-gray-200 bg-white w-[90px] h-[40px]"
                    data-tour="member-chip"
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
                      />
                    ) : (
                      <span className="text-lg truncate flex-1 text-center">
                        {member.name}
                      </span>
                    )}
                    
                    {/* Kebab menu button */}
                    {editingMemberId !== member.id && (
                      <button
                        onClick={() => setOpenMenuId(isMenuOpen ? null : member.id)}
                        className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-1"
                        data-tour="member-kebab"
                      >
                        {isMenuOpen ? '✕' : '⋮'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center ml-auto flex-shrink-0 gap-2.5">
          {/* +Goal, then sort by category (to its right) */}
          {showAddMember && (
            <div className={`relative ${openMenuId ? 'invisible' : ''}`}>
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
                    placeholder={profile?.nickname || 'Name'}
                    className="w-[90px] h-[40px] px-2 py-0.5 text-lg border border-teal rounded-lg bg-white"
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
                  +Goal
                </button>
              )}
            </div>
          )}

          {showCategorySort && onCategorySortClick && (
            <button
              type="button"
              data-tour="category-sort"
              disabled={categorySortLoading}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void onCategorySortClick()
              }}
              className="flex items-center justify-center rounded-lg w-[40px] h-[40px] touch-manipulation transition-colors bg-cyan text-white hover:opacity-80 disabled:opacity-50 disabled:pointer-events-none"
            >
              <span className="sr-only">Sort items by category</span>
              <SortAmountDownIcon className="w-5 h-5" />
            </button>
          )}
          </div>
        </div>

        {/* Expanded menu - full width of header card */}
        {openMenuId && openMember && (
          <div className="px-3 py-2 bg-gray-50 rounded-b-lg">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Private/Public status icon - clickable for owner */}
              {isOpenMemberOwner ? (
                <button
                  onClick={() => handleTogglePublic(openMember)}
                  className="text-lg hover:opacity-70"
                  title={openMember.is_public ? 'Public - Click to make private' : 'Private - Click to make public'}
                >
                  {openMember.is_public ? '🔓' : '🔒'}
                </button>
              ) : (
                <span className="text-lg opacity-60" title={openMember.is_public ? 'Public member' : 'Private member'}>
                  {openMember.is_public ? '🔓' : '🔒'}
                </span>
              )}
              
              {/* Show all / Show to-do toggle */}
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
              
              {isOpenMemberOwner && (
                <>
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
                      editingMemberId === openMember.id ? 'bg-red-500 hover:bg-red-600' : 'bg-teal hover:opacity-80'
                    }`}
                  >
                    {editingMemberId === openMember.id ? 'Done' : 'Rename'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteClick(openMember)
                    }}
                    className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-80 bg-teal"
                  >
                    Delete
                  </button>
                </>
              )}
              
              {!isOpenMemberOwner && openMember.creator?.nickname && (
                <span className="px-3 py-1.5 text-sm text-gray-500">
                  Created by: {openMember.creator.nickname}
                </span>
              )}
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
    </div>
  )
}
