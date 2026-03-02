'use client'

import { useState, useEffect, useRef } from 'react'
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

  return (
    <div className="mb-3 min-w-full w-max">
      {/* Header row - matching item card styling */}
      <div className="flex items-start gap-0.5 px-3 py-1 bg-gray-50 rounded-lg whitespace-nowrap">
        <div className="w-5 flex-shrink-0 h-[40px]" />
        <div className="w-20 flex-shrink-0 h-[40px]" />
        
        {/* Members section */}
        <div className="flex items-start ml-2 flex-shrink-0 gap-2.5">
          {members.map(member => {
            const isOwner = member.created_by === user?.id
            const isMenuOpen = openMenuId === member.id
            
            return (
              <div key={member.id} className="flex flex-col">
                {/* Member container - fixed size to match item state containers */}
                <div className="flex items-center justify-between px-2 py-1 rounded-t-lg border border-gray-200 bg-white w-[90px] h-[40px]">
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
                
                {/* Expanded menu within the card */}
                {isMenuOpen && (
                  <div className="px-2 py-2 bg-gray-100 border border-t-0 border-gray-200 rounded-b-lg w-[90px] space-y-1">
                    {isOwner && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStartEdit(member)
                        }}
                        className="w-full px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
                      >
                        <span>✏️</span>
                        <span>Rename</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleHideDone(member.id)
                        setOpenMenuId(null)
                      }}
                      className="w-full px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
                    >
                      <span>{hideDone[member.id] ? '👁' : '🙈'}</span>
                      <span>{hideDone[member.id] ? 'Show done' : 'Hide done'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleHideNotRelevant(member.id)
                        setOpenMenuId(null)
                      }}
                      className="w-full px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
                    >
                      <span>{hideNotRelevant[member.id] ? '👁' : '🙈'}</span>
                      <span>{hideNotRelevant[member.id] ? 'Show 0' : 'Hide 0'}</span>
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleTogglePublic(member)
                          setOpenMenuId(null)
                        }}
                        className="w-full px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
                      >
                        <span>{member.is_public ? '🔓' : '🔒'}</span>
                        <span>{member.is_public ? 'Public' : 'Private'}</span>
                      </button>
                    )}
                    {isOwner && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteClick(member)
                        }}
                        className="w-full px-2 py-1 text-xs bg-red-50 border border-red-200 rounded hover:bg-red-100 text-red-600 flex items-center gap-1"
                      >
                        <span>🗑️</span>
                        <span>Delete</span>
                      </button>
                    )}
                    {!isOwner && member.creator?.nickname && (
                      <div className="px-2 py-1 text-xs text-gray-500 border-t border-gray-200 mt-1">
                        By: {member.creator.nickname}
                      </div>
                    )}
                  </div>
                )}
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
