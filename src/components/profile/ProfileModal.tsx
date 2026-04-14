'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { InstallAppButton } from '@/components/ui/InstallAppButton'
import { copyTextToClipboard, isMobileDevice } from '@/lib/clipboard'
import { ThemedImage } from '@/components/ui/ThemedImage'
import { Modal } from '@/components/ui/Modal'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { success, error: showError } = useToast()
  const [error, setError] = useState('')

  const displayNickname = profile?.nickname || user?.user_metadata?.nickname || '-'
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const [editNickname, setEditNickname] = useState(displayNickname)
  const [savingNickname, setSavingNickname] = useState(false)

  useEffect(() => {
    setEditNickname(displayNickname)
  }, [displayNickname])

  useEffect(() => {
    if (!isOpen) {
      setIsEditingNickname(false)
      setError('')
    }
  }, [isOpen])

  const handleSaveNickname = async () => {
    if (!editNickname.trim() || editNickname === displayNickname) {
      setIsEditingNickname(false)
      return
    }
    setSavingNickname(true)
    setError('')
    const { error: upErr } = await updateProfile({ nickname: editNickname.trim() })
    if (upErr) {
      setError(upErr.message)
    }
    setSavingNickname(false)
    setIsEditingNickname(false)
  }

  const handleSignOut = async () => {
    setError('')
    const { error: outErr } = await signOut()
    if (outErr) {
      setError(outErr.message || 'Failed to sign out')
      return
    }
    onClose()
  }

  if (!user) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Account settings" contentClassName="!overflow-visible">
      <div className="space-y-4">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Email</label>
            <p className="text-gray-800 dark:text-gray-200 break-all">{user.email}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Nickname</label>
            {isEditingNickname ? (
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleSaveNickname()
                    if (e.key === 'Escape') {
                      setEditNickname(displayNickname)
                      setIsEditingNickname(false)
                    }
                  }}
                  className="flex-1 px-3 py-1.5 border border-teal rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/20"
                  autoFocus
                  disabled={savingNickname}
                />
                <Button size="sm" onClick={() => void handleSaveNickname()} loading={savingNickname}>
                  Save
                </Button>
              </div>
            ) : (
              <p
                className="text-gray-800 dark:text-gray-200 cursor-pointer hover:text-teal"
                onClick={() => {
                  setEditNickname(displayNickname)
                  setIsEditingNickname(true)
                }}
                title="Click to edit"
              >
                {displayNickname} <span className="text-gray-400 dark:text-gray-500 text-sm">✎</span>
              </p>
            )}
          </div>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg text-sm">{error}</div>}

        <InstallAppButton />

        <Button variant="danger" className="w-full mt-2" onClick={() => void handleSignOut()}>
          Sign Out
        </Button>

        <div className="flex justify-center items-center pt-2">
          <button
            type="button"
            className="hover:opacity-80"
            onClick={async () => {
              const url = 'https://myfamilist.com/'

              const canUseNativeShare =
                typeof navigator !== 'undefined' &&
                typeof navigator.share === 'function' &&
                isMobileDevice()

              const copyOnly = async () => {
                await copyTextToClipboard(url)
                if (!isMobileDevice()) {
                  success('Copied to clipboard')
                }
              }

              if (!canUseNativeShare) {
                await copyOnly()
                return
              }

              try {
                await navigator.share({ url })
              } catch (err) {
                const shareError = err as Error & { name?: string }
                if (shareError.name === 'AbortError') return
                console.error('Error sharing app link:', err)
                showError('Failed to share')
                await copyOnly()
              }
            }}
          >
            <ThemedImage src="/share.png" alt="Share MyFamiList" width={48} height={48} className="h-12 w-[92px]" />
          </button>
        </div>

        <div className="text-center text-xs text-gray-400 dark:text-gray-500">All rights reserved: Noam Familia</div>
      </div>
    </Modal>
  )
}
