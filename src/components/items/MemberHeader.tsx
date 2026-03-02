'use client'

import { useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import type { Member, MemberWithCreator } from '@/lib/supabase/types'

interface MemberHeaderProps {
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  hideNotRelevant: Record<string, boolean>
  onToggleHideDone: (memberId: string) => void
  onToggleHideNotRelevant: (memberId: string) => void
  onAddMember: (name: string, creatorNickname?: string) => Promise<any>
  onUpdateMember: (memberId: string, updates: Partial<MemberWithCreator>) => Promise<{ error?: { message: string } | null }>
  onDeleteMember: (memberId: string) => Promise<{ error?: { message: string } | null }>
  listId: string
  showAddMember?: boolean
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
    const nameToAdd = newMemberName.trim() || profile?.nickname || 'Me'
    
    const nameExists = members.some(m => m.name.toLowerCase() === nameToAdd.toLowerCase())
    if (nameExists) {
      showError(`Member "${nameToAdd}" already exists`)
      return
    }
    
    await onAddMember(nameToAdd, profile?.nickname || undefined)
    setNewMemberName('')
    setIsAdding(false)
  }

  const handleStartEdit = (member: Member) => {
    setEditingMemberId(member.id)
    setEditName(member.name)
    setOpenMenuId(null)
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
      }
    }
    setEditingMemberId(null)
    setEditName('')
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
          <div className="w-20 flex-shrink-0 h-[40px]" />
          
          {/* Members section */}
          <div className="flex items-center ml-2 flex-shrink-0 gap-2.5">
            {members.map(member => {
              const isMenuOpen = openMenuId === member.id
              
              return (
                <div key={member.id}>
                  {/* Member container - fixed size to match item state containers */}
                  <div className={`flex items-center justify-between px-2 py-1 rounded-lg border border-gray-200 bg-white w-[90px] h-[40px] ${isMenuOpen ? 'border-teal' : ''}`}>
                    {editingMemberId === member.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit()
                          if (e.key === 'Escape') {
                            setEditingMemberId(null)
                            setEditName('')
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
                      >
                        {isMenuOpen ? '✕' : '⋮'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add member section - same size as member containers */}
          {showAddMember && (
            <div className="relative ml-2.5">
              {isAdding ? (
                <div className="flex items-center justify-center px-2 py-1 rounded-lg border border-gray-200 bg-white w-[90px] h-[40px]">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    onBlur={handleAddMember}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddMember()
                      if (e.key === 'Escape') {
                        setIsAdding(false)
                        setNewMemberName('')
                      }
                    }}
                    placeholder={profile?.nickname || 'Name'}
                    className="w-full px-1 py-0.5 text-lg border border-teal rounded"
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  onClick={() => setIsAdding(true)}
                  className="flex items-center justify-center rounded-lg bg-teal text-white text-sm hover:opacity-80 transition-colors w-[90px] h-[40px]"
                >
                  +Member
                </button>
              )}
            </div>
          )}
        </div>

        {/* Expanded menu - full width of header card */}
        {openMenuId && openMember && (
          <div className="px-3 py-2 bg-gray-100 border-t border-gray-200 rounded-b-lg">
            <div className="flex items-center gap-2 flex-wrap">
              {isOpenMemberOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartEdit(openMember)
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Rename
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleHideDone(openMember.id)
                  setOpenMenuId(null)
                }}
                className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {hideDone[openMember.id] ? 'Show done' : 'Hide done'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleHideNotRelevant(openMember.id)
                  setOpenMenuId(null)
                }}
                className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {hideNotRelevant[openMember.id] ? 'Show 0' : 'Hide 0'}
              </button>
              {isOpenMemberOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleTogglePublic(openMember)
                    setOpenMenuId(null)
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {openMember.is_public ? 'Set private' : 'Set public'}
                </button>
              )}
              {isOpenMemberOwner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteClick(openMember)
                  }}
                  className="px-3 py-1.5 text-sm bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 text-red-600"
                >
                  Delete
                </button>
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
