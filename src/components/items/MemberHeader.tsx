'use client'

import { useState, useEffect, useRef } from 'react'
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
  showAddMember?: boolean
}

export function MemberHeader({
  members,
  hideDone,
  onToggleHideDone,
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; memberId: string | null; memberName: string }>({
    open: false,
    memberId: null,
    memberName: '',
  })
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [showCreatorInfo, setShowCreatorInfo] = useState<string | null>(null)
  const creatorInfoRef = useRef<HTMLDivElement>(null)

  // Close creator info popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (creatorInfoRef.current && !creatorInfoRef.current.contains(event.target as Node)) {
        setShowCreatorInfo(null)
      }
    }
    if (showCreatorInfo) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showCreatorInfo])

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
      {/* Header row */}
      <div className="flex items-start gap-0.5 px-3 py-3 rounded-lg whitespace-nowrap" style={{ backgroundColor: '#f5f3e8' }}>
        <span className="text-lg tracking-tighter invisible flex-shrink-0">⋮⋮</span>
        <div className="w-20 flex-shrink-0 flex flex-col">
          <div className="h-6"></div>
          <div className="h-10 mt-1.5"></div>
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
                  className="w-16 px-2 py-1 text-sm border border-teal rounded"
                  autoFocus
                />
              ) : (
                <>
                  <span
                    onClick={() => member.created_by === user?.id && handleStartEdit(member)}
                    className={`text-lg font-semibold text-primary truncate max-w-[70px] ${member.created_by === user?.id ? 'cursor-pointer hover:text-primary-dark' : ''}`}
                  >
                    {member.name}
                  </span>
                  {/* Info/Delete and Hide done buttons in container */}
                  <div ref={showCreatorInfo === member.id ? creatorInfoRef : null} className="flex items-center gap-1 mt-1.5 px-2 py-1 rounded-lg border border-gray-200 bg-white relative">
                    {member.created_by === user?.id ? (
                      <button
                        onClick={() => handleDeleteClick(member)}
                        className="w-8 h-8 flex items-center justify-center text-sm font-bold transition-colors bg-red-500 text-white rounded-lg hover:bg-red-600"
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowCreatorInfo(showCreatorInfo === member.id ? null : member.id)}
                        className="w-8 h-8 flex items-center justify-center text-xl transition-colors text-teal hover:text-teal-dark"
                      >
                        ℹ
                      </button>
                    )}
                    <button
                      onClick={() => onToggleHideDone(member.id)}
                      className={`w-8 h-8 flex items-center justify-center text-2xl transition-colors ${
                        hideDone[member.id] 
                          ? 'text-teal' 
                          : 'text-gray-400'
                      } hover:opacity-80`}
                      title={hideDone[member.id] ? 'Show done items' : 'Hide done items'}
                    >
                      {hideDone[member.id] ? '🙈' : '👁'}
                    </button>
                    {/* Creator info popup */}
                    {showCreatorInfo === member.id && member.creator?.nickname && (
                      <div className="absolute top-full left-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg z-20 whitespace-nowrap text-sm">
                        Created by: <span className="font-semibold">{member.creator.nickname}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

        </div>

        {/* Add member section - same pitch as member columns */}
        {showAddMember && (
        <div className="flex flex-col items-center min-w-[70px]">
          {isAdding ? (
            <>
              <input
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                onBlur={() => {
                  setIsAdding(false)
                  setNewMemberName('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddMember()
                  if (e.key === 'Escape') {
                    setIsAdding(false)
                    setNewMemberName('')
                  }
                }}
                placeholder={profile?.nickname || 'Name'}
                className="w-16 px-2 py-1 text-lg text-center border border-teal rounded"
                autoFocus
              />
              <button
                onMouseDown={handleAddMember}
                className="mt-1.5 w-16 h-8 rounded-lg flex items-center justify-center text-sm font-semibold transition-colors bg-red-500 text-white hover:bg-red-600"
              >
                Add
              </button>
            </>
          ) : (
            <span
              onClick={() => setIsAdding(true)}
              className="text-lg font-semibold text-primary cursor-pointer hover:text-primary-dark"
            >
              +Member
            </span>
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
