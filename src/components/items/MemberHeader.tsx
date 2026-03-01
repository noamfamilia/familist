'use client'

import { useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import type { Member, MemberWithCreator } from '@/lib/supabase/types'

interface MemberHeaderProps {
  members: MemberWithCreator[]
  hideDone: Record<string, boolean>
  onToggleHideDone: (memberId: string) => void
  onAddMember: (name: string, creatorNickname?: string) => Promise<any>
  onUpdateMember: (memberId: string, updates: Partial<MemberWithCreator>) => Promise<{ error?: { message: string } | null }>
  onDeleteMember: (memberId: string) => Promise<{ error?: { message: string } | null }>
  listId: string
}

export function MemberHeader({
  members,
  hideDone,
  onToggleHideDone,
  onAddMember,
  onUpdateMember,
  onDeleteMember,
  listId,
}: MemberHeaderProps) {
  const { user, profile } = useAuth()
  const { error: showError } = useToast()
  const [isAdding, setIsAdding] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [deleteLoading, setDeleteLoading] = useState(false)

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
    <div className="mb-3">
      {/* Header row */}
      <div className="inline-flex items-start gap-0.5 px-3 py-3 bg-primary/10 rounded-lg min-w-full">
        <span className="text-sm tracking-tighter invisible flex-shrink-0">⋮⋮</span>
        <div className="w-36 flex-shrink-0 flex flex-col">
          <div className="h-6"></div>
          <span className="text-xs text-gray-500 mt-1">Hide done</span>
        </div>
        
        {/* Members section - toggle below name */}
        <div className="flex items-start ml-2 flex-shrink-0 gap-3">
          {members.map(member => (
            <div key={member.id} className="flex flex-col items-center group min-w-[70px]">
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
                  className="w-16 px-2 py-1 text-sm border border-primary rounded"
                  autoFocus
                />
              ) : (
                <>
                  <div className="flex items-center">
                    <span
                      onClick={() => member.created_by === user?.id && handleStartEdit(member)}
                      className={`text-lg font-semibold text-primary truncate max-w-[70px] ${member.created_by === user?.id ? 'cursor-pointer hover:text-primary-dark' : ''}`}
                      title={member.creator?.nickname ? `${member.name} (${member.creator.nickname})` : member.name}
                    >
                      {member.name}
                    </span>
                    {member.created_by === user?.id && (
                      <button
                        onClick={() => handleDeleteClick(member)}
                        className="text-red-500 text-base opacity-60 hover:opacity-100 transition-opacity ml-1"
                        title="Delete member"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {/* Toggle switch below name - larger size */}
                  <button
                    onClick={() => onToggleHideDone(member.id)}
                    className={`mt-1.5 w-12 h-6 rounded-full transition-colors relative ${hideDone[member.id] ? 'bg-primary' : 'bg-gray-300'}`}
                    title={hideDone[member.id] ? 'Show done items' : 'Hide done items'}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${hideDone[member.id] ? 'right-1' : 'left-1'}`} />
                  </button>
                </>
              )}
            </div>
          ))}

        </div>

        {/* Trailing section - fixed width to match item cards */}
        <div className="w-28 flex-shrink-0 flex justify-end items-start ml-2">
          {isAdding ? (
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
              className="w-24 px-2 py-1 text-sm border border-primary rounded"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="text-sm text-primary hover:bg-primary/20 px-2 py-1 rounded whitespace-nowrap"
            >
              + Add member
            </button>
          )}
        </div>
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
