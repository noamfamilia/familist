'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { createClient, forceNewClient } from '@/lib/supabase/client'
import type { Database, List } from '@/lib/supabase/types'
import type { RealtimeChannel } from '@supabase/supabase-js'

const ConfirmModal = dynamic(() => import('@/components/ui/ConfirmModal').then(mod => mod.ConfirmModal), {
  ssr: false,
})

interface ShareModalProps {
  isOpen: boolean
  onClose: () => void
  list: List
  onUpdate: () => void
}

interface JoinedUser {
  user_id: string
  nickname: string | null
  member_count: number
}

type JoinedUsersRpcResult = Database['public']['Functions']['get_list_joined_users']['Returns']

export function ShareModal({ isOpen, onClose, list, onUpdate }: ShareModalProps) {
  const { success, error: showError } = useToast()
  const [visibility, setVisibility] = useState<'private' | 'link'>(list.visibility)
  const [token, setToken] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [joinedUsers, setJoinedUsers] = useState<JoinedUser[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [contentReady, setContentReady] = useState(false)

  // Fetch joined users when modal opens
  const fetchJoinedUsers = async (): Promise<JoinedUser[]> => {
    const supabase = forceNewClient()
    
    const { data, error } = await supabase.rpc('get_list_joined_users', {
      p_list_id: list.id
    })
    
    if (error) {
      console.error('Error fetching joined users:', error)
      showError('Failed to load joined users')
      setJoinedUsers([])
      return []
    }

    const nextUsers: JoinedUsersRpcResult = data || []
    setJoinedUsers(nextUsers)
    setSelectedUserIds(prev => {
      const validUserIds = new Set(nextUsers.map(user => user.user_id))
      return new Set(Array.from(prev).filter(userId => validUserIds.has(userId)))
    })
    return nextUsers
  }

  // Only reset state when the modal opens, not when list visibility changes while open.
  useEffect(() => {
    if (isOpen) {
      setVisibility(list.visibility)
      setToken('')
      setShowConfirm(false)
      setShowRemoveConfirm(false)
      setSelectedUserIds(new Set())
      
      // Fetch joined users if link-enabled, then show content
      if (list.visibility === 'link') {
        setContentReady(false)
        fetchJoinedUsers().finally(() => setContentReady(true))
      } else {
        setJoinedUsers([])
        setContentReady(true)
      }
    } else {
      setContentReady(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, list.id])

  useEffect(() => {
    if (!isOpen || visibility !== 'link') return

    const supabase = createClient()
    let refreshTimeout: NodeJS.Timeout | null = null

    const scheduleRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout)
      refreshTimeout = setTimeout(() => {
        fetchJoinedUsers()
      }, 200)
    }

    const channel: RealtimeChannel = supabase
      .channel(`share-modal-${list.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_users', filter: `list_id=eq.${list.id}` },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members', filter: `list_id=eq.${list.id}` },
        scheduleRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout)
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, visibility, list.id])

  const copyToClipboard = async (tokenValue: string) => {
    const tokenWithPrefix = '@' + tokenValue
    try {
      await navigator.clipboard.writeText(tokenWithPrefix)
    } catch {
      const textArea = document.createElement('textarea')
      textArea.value = tokenWithPrefix
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }
  }

  const generateTokenAndCopy = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_list_id: list.id,
      })
      if (error) throw error
      setToken(data)
      await copyToClipboard(data)
      return true
    } catch (err) {
      console.error('Error generating token:', err)
      showError('Failed to generate token')
      return false
    } finally {
      setLoading(false)
    }
  }

  // Calculate totals from joinedUsers
  const totalUsers = joinedUsers.length
  const totalMembers = joinedUsers.reduce((sum, u) => sum + (u.member_count || 0), 0)
  
  // Calculate selected totals
  const selectedUsers = joinedUsers.filter(u => selectedUserIds.has(u.user_id))
  const selectedUsersCount = selectedUsers.length
  const selectedMembersCount = selectedUsers.reduce((sum, u) => sum + (u.member_count || 0), 0)
  
  // Selection handlers
  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }
  
  const toggleSelectAll = () => {
    if (selectedUserIds.size === joinedUsers.length) {
      setSelectedUserIds(new Set())
    } else {
      setSelectedUserIds(new Set(joinedUsers.map(u => u.user_id)))
    }
  }

  const handleVisibilityChange = async (newVisibility: 'private' | 'link') => {
    if (newVisibility === 'link') {
      const didGenerateToken = await generateTokenAndCopy()
      if (didGenerateToken) {
        setVisibility('link')
        onUpdate()
      }
    } else {
      // If there are users/members, show confirmation
      if (totalUsers > 0 || totalMembers > 0) {
        setShowConfirm(true)
      } else {
        await makePrivate()
      }
    }
  }

  const makePrivate = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { error } = await supabase.rpc('revoke_share_token', {
        p_list_id: list.id,
      })

      if (error) throw error
      setToken('')
      setVisibility('private')
      setShowConfirm(false)
      setJoinedUsers([])
      onUpdate()
      return true
    } catch (err) {
      console.error('Error updating visibility:', err)
      showError('Failed to update sharing settings')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveSelected = () => {
    if (selectedUsersCount > 0) {
      setShowRemoveConfirm(true)
    }
  }

  const removeSelectedUsers = async () => {
    if (selectedUserIds.size === 0) return
    
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const userIdsArray = Array.from(selectedUserIds)
      
      const { error } = await supabase.rpc('remove_users_from_list', {
        p_list_id: list.id,
        p_user_ids: userIdsArray,
      })

      if (error) throw error
      
      setJoinedUsers(prev => prev.filter(u => !selectedUserIds.has(u.user_id)))
      setSelectedUserIds(new Set())
      setShowRemoveConfirm(false)
      success(`${selectedUsersCount} user${selectedUsersCount > 1 ? 's' : ''} removed`)
    } catch (err) {
      console.error('Error removing users:', err)
      showError('Failed to remove users')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Settings">
      {!contentReady ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal"></div>
        </div>
      ) : (
        <>
      <p className="text-center text-gray-500 font-medium mb-5">{list.name}</p>

      <div className="space-y-3 mb-5">
        {/* Private option */}
        <label className="cursor-pointer block">
          <input
            type="radio"
            name="visibility"
            value="private"
            checked={visibility === 'private'}
            onChange={() => handleVisibilityChange('private')}
            disabled={loading}
            className="sr-only"
          />
          <div className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
            visibility === 'private' 
              ? 'border-teal bg-teal-light' 
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <span className="text-2xl">🔒</span>
            <div>
              <div className="font-semibold">Private</div>
              <div className="text-sm text-gray-500">Only you can access this list</div>
            </div>
          </div>
        </label>

        {/* Link-enabled option */}
        <label className="cursor-pointer block">
          <input
            type="radio"
            name="visibility"
            value="link"
            checked={visibility === 'link'}
            onChange={() => handleVisibilityChange('link')}
            disabled={loading}
            className="sr-only"
          />
          <div className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-all ${
            visibility === 'link' 
              ? 'border-teal bg-teal-light' 
              : 'border-gray-200 hover:bg-gray-50'
          }`}>
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-semibold">Link-enabled</div>
              <div className="text-sm text-gray-500">Anyone with the token can join</div>
            </div>
          </div>
        </label>
      </div>

      {/* Token section */}
      {visibility === 'link' && (
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={token ? '@' + token : ''}
              readOnly
              className="w-0 flex-1 min-w-0 px-3 py-2 border-2 border-gray-200 rounded-lg font-mono bg-gray-50 text-sm truncate"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={generateTokenAndCopy}
              disabled={loading}
              className="flex-shrink-0 py-2"
            >
              Regenerate
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Share your token with friends.
          </p>
          <p className="text-xs text-gray-400 text-center">
            Regenerating a new token will invalidate the current one.
          </p>
        </div>
      )}

      {/* Joined users section */}
      {visibility === 'link' && joinedUsers.length > 0 && (
        <div className="pt-4 mt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-500">Users who joined:</label>
          </div>
          
          {/* Header row with select all and remove button */}
          <div className="flex items-center justify-between py-2 px-3 mb-2">
            {selectedUsersCount > 0 && (
              <button
                onClick={handleRemoveSelected}
                disabled={loading}
                className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-50"
              >
                Remove selected
              </button>
            )}
            {selectedUsersCount === 0 && <div />}
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">
                {selectedUserIds.size === joinedUsers.length ? 'Deselect all' : 'Select all'}
              </span>
              <input
                type="checkbox"
                checked={selectedUserIds.size === joinedUsers.length && joinedUsers.length > 0}
                onChange={toggleSelectAll}
                disabled={loading}
                className="w-4 h-4 rounded border-gray-300 text-teal focus:ring-teal"
              />
            </label>
          </div>
          
          {/* User rows */}
          <div className="space-y-2">
            {joinedUsers.map(user => (
              <label key={user.user_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                <div className="flex items-center gap-1 text-sm">
                  <span dir="auto" className="font-medium">{user.nickname || 'Unknown user'}</span>
                  <span dir="ltr" className="text-gray-400">· {user.member_count} member{user.member_count !== 1 ? 's' : ''}</span>
                </div>
                <input
                  type="checkbox"
                  checked={selectedUserIds.has(user.user_id)}
                  onChange={() => toggleUserSelection(user.user_id)}
                  disabled={loading}
                  className="w-4 h-4 rounded border-gray-300 text-teal focus:ring-teal"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {visibility === 'link' && joinedUsers.length === 0 && (
        <div className="pt-4 mt-4 border-t border-gray-200 text-center text-sm text-gray-500">
          No one has joined this list yet.
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal"></div>
        </div>
      )}
        </>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={makePrivate}
        title="Make List Private"
        message={`This will remove ${totalUsers} user${totalUsers !== 1 ? 's' : ''} and ${totalMembers} member${totalMembers !== 1 ? 's' : ''} from the list. This cannot be undone.`}
        confirmText="Make Private"
        variant="danger"
        loading={loading}
      />

      <ConfirmModal
        isOpen={showRemoveConfirm}
        onClose={() => setShowRemoveConfirm(false)}
        onConfirm={removeSelectedUsers}
        title="Remove Users"
        message={`This will remove ${selectedUsersCount} user${selectedUsersCount !== 1 ? 's' : ''} and ${selectedMembersCount} member${selectedMembersCount !== 1 ? 's' : ''} from the list. This cannot be undone.`}
        confirmText="Remove"
        variant="danger"
        loading={loading}
      />
    </Modal>
  )
}
