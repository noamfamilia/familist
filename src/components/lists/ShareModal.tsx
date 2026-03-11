'use client'
// @ts-nocheck

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { forceNewClient } from '@/lib/supabase/client'
import type { List } from '@/lib/supabase/types'

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

export function ShareModal({ isOpen, onClose, list, onUpdate }: ShareModalProps) {
  const { success, error: showError } = useToast()
  const [visibility, setVisibility] = useState<'private' | 'link'>(list.visibility)
  const [token, setToken] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [otherMembersCount, setOtherMembersCount] = useState(0)
  const [joinedUsers, setJoinedUsers] = useState<JoinedUser[]>([])
  const [userToRemove, setUserToRemove] = useState<JoinedUser | null>(null)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)

  // Fetch joined users when modal opens
  const fetchJoinedUsers = async () => {
    const supabase = forceNewClient()
    
    const { data, error } = await (supabase.rpc as any)('get_list_joined_users', {
      p_list_id: list.id
    })
    
    if (error) {
      console.error('Error fetching joined users:', error)
      return
    }

    setJoinedUsers(data || [])
  }

  // Only reset state when modal opens, not when list object reference changes
  useEffect(() => {
    if (isOpen) {
      setVisibility(list.visibility)
      setToken('')
      setShowConfirm(false)
      setShowRemoveConfirm(false)
      setUserToRemove(null)
      
      // Fetch joined users if link-enabled
      if (list.visibility === 'link') {
        fetchJoinedUsers()
      } else {
        setJoinedUsers([])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, list.visibility])

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
    success('Token copied to clipboard')
  }

  const generateTokenAndCopy = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { data, error } = await (supabase.rpc as any)('generate_share_token', {
        p_list_id: list.id,
      })
      if (error) throw error
      setToken(data)
      await copyToClipboard(data)
    } catch (err) {
      console.error('Error generating token:', err)
    } finally {
      setLoading(false)
    }
  }

  const checkOtherMembers = async (): Promise<number> => {
    const supabase = forceNewClient()
    // Count members not created by the list owner
    const { data, error } = await supabase
      .from('members')
      .select('id, created_by')
      .eq('list_id', list.id)
      .neq('created_by', list.owner_id)
    
    if (error) {
      console.error('Error checking members:', error)
      return 0
    }
    return data?.length || 0
  }

  const handleVisibilityChange = async (newVisibility: 'private' | 'link') => {
    if (newVisibility === 'link') {
      setVisibility('link')
      await generateTokenAndCopy()
      onUpdate()
    } else {
      // Check if there are members created by other users
      setLoading(true)
      const count = await checkOtherMembers()
      setLoading(false)
      
      if (count > 0) {
        setOtherMembersCount(count)
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
      const { error } = await (supabase.rpc as any)('revoke_share_token', {
        p_list_id: list.id,
      })

      if (error) throw error
      setToken('')
      setVisibility('private')
      setShowConfirm(false)
      setJoinedUsers([])
      onUpdate()
    } catch (err) {
      console.error('Error updating visibility:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveUser = (user: JoinedUser) => {
    setUserToRemove(user)
    if (user.member_count > 0) {
      setShowRemoveConfirm(true)
    } else {
      removeUser(user)
    }
  }

  const removeUser = async (user: JoinedUser) => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { error } = await (supabase.rpc as any)('remove_user_from_list', {
        p_list_id: list.id,
        p_user_id: user.user_id,
      })

      if (error) throw error
      
      setJoinedUsers(prev => prev.filter(u => u.user_id !== user.user_id))
      setShowRemoveConfirm(false)
      setUserToRemove(null)
      success('User removed')
      onUpdate()
    } catch (err) {
      console.error('Error removing user:', err)
      showError('Failed to remove user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Settings">
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
          <label className="text-sm text-gray-500 mb-2 block">Share token:</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={token ? '@' + token : ''}
              readOnly
              placeholder="Regenerate overrides old token"
              className="w-0 flex-1 min-w-0 px-3 py-2 border-2 border-gray-200 rounded-lg font-mono bg-gray-50 text-sm truncate"
            />
            <button
              onClick={generateTokenAndCopy}
              disabled={loading}
              className="px-3 py-2 bg-coral text-white text-sm font-medium rounded-lg hover:bg-coral-dark disabled:opacity-50 flex-shrink-0"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {/* Joined users section */}
      {visibility === 'link' && joinedUsers.length > 0 && (
        <div className="pt-4 mt-4 border-t border-gray-200">
          <label className="text-sm text-gray-500 mb-2 block">Users who joined:</label>
          <div className="space-y-2">
            {joinedUsers.map(user => (
              <div key={user.user_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium">
                  {user.nickname || 'Unknown user'}
                </span>
                <button
                  onClick={() => handleRemoveUser(user)}
                  disabled={loading}
                  className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal"></div>
        </div>
      )}

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={makePrivate}
        title="Make List Private"
        message={`This will remove ${otherMembersCount} member${otherMembersCount > 1 ? 's' : ''} created by other users and all their data. This cannot be undone.`}
        confirmText="Make Private"
        variant="danger"
        loading={loading}
      />

      <ConfirmModal
        isOpen={showRemoveConfirm}
        onClose={() => {
          setShowRemoveConfirm(false)
          setUserToRemove(null)
        }}
        onConfirm={() => userToRemove && removeUser(userToRemove)}
        title="Remove User"
        message={`This will remove ${userToRemove?.nickname || 'this user'} and delete ${userToRemove?.member_count} member${(userToRemove?.member_count || 0) > 1 ? 's' : ''} they created. This cannot be undone.`}
        confirmText="Remove"
        variant="danger"
        loading={loading}
      />
    </Modal>
  )
}
