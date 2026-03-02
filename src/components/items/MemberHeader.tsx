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
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null)
      }
    }
    if (openMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenuId])

  const handleAddMember = async () => {
    const nameToAdd = newMemberName.trim() || profile?.nickname || 'Me'
    
    // Check if name already exists
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
  }

  const handleSaveEdit = async () => {
    if (editingMemberId && editName.trim()) {
      const trimmedName = editName.trim()
      
      // Check if name already exists (excluding current member)
      const nameExists = members.some(m => 
        m.id !== editingMemberId && m.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (nameExists) {
        showError(`Member "${trimmedName}" already exists`)
        // Revert to original name
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

  return (
    <div className="mb-3 min-w-full w-max">
      {/* Header row - matching item card styling */}
      <div className="flex items-center gap-0.5 px-3 py-1 bg-gray-50 rounded-lg whitespace-nowrap">
        <div className="w-5 flex-shrink-0" />
        <div className="w-20 flex-shrink-0" />
        
        {/* Members section */}
        <div className="flex items-center ml-2 flex-shrink-0 gap-2.5">
          {members.map(member => {
            const isOwner = member.created_by === user?.id
            const isMenuOpen = openMenuId === member.id
            
            return (
              <div key={member.id} className="relative" ref={isMenuOpen ? menuRef : null}>
                {/* Member container - fixed size to match item state containers */}
                <div className="flex items-center justify-between px-2 py-1 rounded-lg border border-gray-200 bg-white w-[90px] h-[40px]">
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
                      ⋮
                    </button>
                  )}
                  
                  {/* Dropdown menu */}
                  {isMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[140px]">
                      {isOwner && (
                        <button
                          onClick={() => {
                            handleStartEdit(member)
                            setOpenMenuId(null)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <span>✏️</span> Rename
                        </button>
                      )}
                      <button
                        onClick={() => {
                          onToggleHideDone(member.id)
                          setOpenMenuId(null)
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span>{hideDone[member.id] ? '👁' : '🙈'}</span>
                        {hideDone[member.id] ? 'Show completed' : 'Hide completed'}
                      </button>
                      <button
                        onClick={() => {
                          onToggleHideNotRelevant(member.id)
                          setOpenMenuId(null)
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                      >
                        <span>{hideNotRelevant[member.id] ? '👁' : '🙈'}</span>
                        {hideNotRelevant[member.id] ? 'Show not-relevant' : 'Hide not-relevant'}
                      </button>
                      {isOwner && (
                        <button
                          onClick={() => {
                            handleDeleteClick(member)
                            setOpenMenuId(null)
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 text-red-500 flex items-center gap-2"
                        >
                          <span>🗑️</span> Delete
                        </button>
                      )}
                      {!isOwner && member.creator?.nickname && (
                        <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
                          Created by: {member.creator.nickname}
                        </div>
                      )}
                    </div>
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
                className="flex items-center justify-center rounded-lg bg-coral text-white text-sm hover:bg-coral-dark transition-colors w-[90px] h-[40px]"
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
