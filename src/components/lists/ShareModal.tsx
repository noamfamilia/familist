'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { RegenerateIcon, ShareActionIcon } from '@/components/ui/ShareIcons'
import { useToast } from '@/components/ui/Toast'
import { copyTextToClipboard, isMobileDevice } from '@/lib/clipboard'
import { buildInviteUrl } from '@/lib/invite'
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
  /** Active items then archived, one name per line, for copying as plain text. */
  listItemsAsText: string
}

interface JoinedUser {
  user_id: string
  nickname: string | null
  member_count: number
}

type JoinedUsersRpcResult = Database['public']['Functions']['get_list_joined_users']['Returns']

export function ShareModal({ isOpen, onClose, list, onUpdate, listItemsAsText }: ShareModalProps) {
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

  const fetchInviteToken = async () => {
    const supabase = forceNewClient()

    const { data, error } = await supabase
      .from('lists')
      .select('join_token')
      .eq('id', list.id)
      .maybeSingle()

    if (error) {
      console.error('Error fetching invite token:', error)
      showError('Failed to load invite link')
      setToken('')
      return null
    }

    const nextToken = data?.join_token || ''
    setToken(nextToken)
    return nextToken
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
        Promise.all([fetchJoinedUsers(), fetchInviteToken()]).finally(() => setContentReady(true))
      } else {
        setJoinedUsers([])
        setToken('')
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
    let refreshTimeouts: NodeJS.Timeout[] = []

    const scheduleRefresh = () => {
      refreshTimeouts.forEach(clearTimeout)
      refreshTimeouts = [200, 1500, 3000].map(delayMs =>
        setTimeout(() => {
          fetchJoinedUsers()
        }, delayMs)
      )
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
      refreshTimeouts.forEach(clearTimeout)
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, visibility, list.id])

  const canUseNativeShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    isMobileDevice()

  const copyInviteLink = async (inviteLink: string) => {
    await copyTextToClipboard(inviteLink)
    if (!isMobileDevice()) {
      success('Copied to clipboard')
    }
  }

  const handleCopyListAsText = async () => {
    try {
      await copyTextToClipboard(listItemsAsText)
      success('Copied list to clipboard')
    } catch {
      showError('Could not copy')
    }
  }

  const generateInviteToken = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_list_id: list.id,
        p_force_regenerate: false,
      })
      if (error) throw error
      setToken(data)
      return data
    } catch (err) {
      console.error('Error generating token:', err)
      showError('Failed to generate invite link')
      return null
    } finally {
      setLoading(false)
    }
  }

  const shareInviteLink = async (inviteLink: string) => {
    if (!canUseNativeShare) {
      await copyInviteLink(inviteLink)
      return
    }

    try {
      await navigator.share({
        title: `${list.name} on MyFamiList`,
        text: `Join my shared list: ${list.name}`,
        url: inviteLink,
      })
    } catch (err) {
      const shareError = err as Error & { name?: string }
      if (shareError.name === 'AbortError') return
      console.error('Error sharing invite link:', err)
      showError('Failed to share invite link')
    }
  }

  const handleShareInvite = async () => {
    const currentToken = token || await generateInviteToken()
    if (!currentToken) return
    await shareInviteLink(buildInviteUrl(currentToken))
  }

  const handleRegenerateInvite = async () => {
    setLoading(true)
    try {
      const supabase = forceNewClient()
      const { data, error } = await supabase.rpc('generate_share_token', {
        p_list_id: list.id,
        p_force_regenerate: true,
      })
      if (error) throw error
      setToken(data)
      success('New link created. Old link is invalid.')
    } catch (err) {
      console.error('Error regenerating token:', err)
      showError('Failed to regenerate invite link')
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
      const nextToken = await generateInviteToken()
      if (nextToken) {
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
      <p className="text-center text-gray-500 dark:text-gray-400 font-medium mb-3">{list.name}</p>

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
              : 'border-gray-200 dark:border-neutral-600 hover:bg-gray-50 dark:hover:bg-neutral-800'
          }`}>
            <span className="text-2xl">🔒</span>
            <div>
              <div className="font-semibold">Private</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Only you can access this list</div>
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
              : 'border-gray-200 dark:border-neutral-600 hover:bg-gray-50 dark:hover:bg-neutral-800'
          }`}>
            <span className="text-2xl">🔗</span>
            <div>
              <div className="font-semibold">Link-enabled</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Anyone with the invite link can join</div>
            </div>
          </div>
        </label>
      </div>

      {visibility === 'private' && (
        <div className="flex justify-center mb-5">
          <button
            type="button"
            onClick={() => void handleCopyListAsText()}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-600 dark:bg-cyan-600 dark:hover:bg-cyan-500 shadow-sm transition-colors"
          >
            Copy list as text
          </button>
        </div>
      )}

      {/* Invite link section */}
      {visibility === 'link' && (
        <div className="pt-4 border-t border-gray-200 dark:border-neutral-600">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => void handleRegenerateInvite()}
              disabled={loading}
              title="Regenerate invite link"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal text-white shadow-sm transition-colors hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Regenerate invite link"
            >
              <RegenerateIcon className="h-5 w-5 shrink-0" />
            </button>
            <input
              type="text"
              value={token ? buildInviteUrl(token) : ''}
              placeholder="Invite link"
              readOnly
              className="min-w-0 flex-1 px-3 py-2.5 border-2 border-gray-200 dark:border-neutral-600 rounded-lg bg-gray-50 dark:bg-neutral-900 text-sm truncate"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void handleShareInvite()}
              disabled={loading}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-red-500 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={canUseNativeShare ? 'Share invite link' : 'Copy invite link'}
            >
              <ShareActionIcon className="h-4 w-4 shrink-0" />
              Share list
            </button>
            <button
              type="button"
              onClick={() => void handleCopyListAsText()}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-cyan-500 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-600 dark:bg-cyan-600 dark:hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Copy list as text
            </button>
          </div>
        </div>
      )}

      {/* Joined users section */}
      {visibility === 'link' && joinedUsers.length > 0 && (
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-neutral-600">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-gray-500 dark:text-gray-400">Users who joined:</label>
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
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {selectedUserIds.size === joinedUsers.length ? 'Deselect all' : 'Select all'}
              </span>
              <input
                type="checkbox"
                checked={selectedUserIds.size === joinedUsers.length && joinedUsers.length > 0}
                onChange={toggleSelectAll}
                disabled={loading}
                className="w-4 h-4 rounded border-gray-300 dark:border-neutral-600 text-teal focus:ring-teal"
              />
            </label>
          </div>
          
          {/* User rows */}
          <div className="space-y-2">
            {joinedUsers.map(user => (
              <label key={user.user_id} className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-neutral-900 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-neutral-700">
                <div className="flex items-center gap-1 text-sm">
                  <span dir="auto" className="font-medium">{user.nickname || 'Unknown user'}</span>
                  <span dir="ltr" className="text-gray-400 dark:text-gray-500">· {user.member_count} task{user.member_count !== 1 ? 's' : ''}</span>
                </div>
                <input
                  type="checkbox"
                  checked={selectedUserIds.has(user.user_id)}
                  onChange={() => toggleUserSelection(user.user_id)}
                  disabled={loading}
                  className="w-4 h-4 rounded border-gray-300 dark:border-neutral-600 text-teal focus:ring-teal"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {visibility === 'link' && joinedUsers.length === 0 && (
        <div className="pt-4 mt-4 border-t border-gray-200 dark:border-neutral-600 text-center text-sm text-gray-500 dark:text-gray-400">
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
        message={`This will remove ${totalUsers} user${totalUsers !== 1 ? 's' : ''} and ${totalMembers} task${totalMembers !== 1 ? 's' : ''} from the list. This cannot be undone.`}
        confirmText="Make Private"
        variant="danger"
        loading={loading}
      />

      <ConfirmModal
        isOpen={showRemoveConfirm}
        onClose={() => setShowRemoveConfirm(false)}
        onConfirm={removeSelectedUsers}
        title="Remove Users"
        message={`This will remove ${selectedUsersCount} user${selectedUsersCount !== 1 ? 's' : ''} and ${selectedMembersCount} task${selectedMembersCount !== 1 ? 's' : ''} from the list. This cannot be undone.`}
        confirmText="Remove"
        variant="danger"
        loading={loading}
      />
    </Modal>
  )
}
