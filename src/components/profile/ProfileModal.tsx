'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { InstallAppButton } from '@/components/ui/InstallAppButton'
import { copyTextToClipboard, isMobileDevice } from '@/lib/clipboard'
import { ThemedImage } from '@/components/ui/ThemedImage'
import { Modal } from '@/components/ui/Modal'
import { APP_VERSION } from '@/lib/appVersion'
import { useTheme } from 'next-themes'
import { GoogleGIcon } from '@/components/auth/GoogleGIcon'
import { userHasGoogleIdentity } from '@/lib/googleProfileNickname'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onRequestSignIn?: () => void
  onRequestSignUp?: () => void
}

export function ProfileModal({ isOpen, onClose, onRequestSignIn, onRequestSignUp }: ProfileModalProps) {
  const { user, profile, isGuest, signedOutToGuest, clearSignedOutToGuest, signOut, updateProfile, linkGoogleIdentity } = useAuth()
  const { success, error: showError } = useToast()
  const { resolvedTheme, setTheme } = useTheme()
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [linkingGoogle, setLinkingGoogle] = useState(false)
  const googleLinked = user ? userHasGoogleIdentity(user) : false
  const displayNickname = profile?.nickname || user?.user_metadata?.nickname || '-'
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const [editNickname, setEditNickname] = useState(displayNickname)

  useEffect(() => {
    setEditNickname(displayNickname)
  }, [displayNickname])

  useEffect(() => {
    if (!isOpen) {
      setIsEditingNickname(false)
      setError('')
      if (signedOutToGuest) clearSignedOutToGuest()
    }
  }, [isOpen, signedOutToGuest, clearSignedOutToGuest])

  const handleSaveNickname = () => {
    if (!editNickname.trim() || editNickname === displayNickname) {
      setIsEditingNickname(false)
      return
    }
    setError('')
    setIsEditingNickname(false)
    void updateProfile({ nickname: editNickname.trim() }).then(({ error: upErr }) => {
      if (upErr) setError(upErr.message)
    })
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setError('')
    setSigningOut(true)
    try {
      const { error: outErr } = await signOut()
      if (outErr) {
        setError(outErr.message || 'Failed to sign out')
        return
      }
      onClose()
    } finally {
      setSigningOut(false)
    }
  }

  if (!isOpen) return null

  if (isGuest) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Guest mode" contentClassName="!overflow-visible">
        <div className="space-y-4">
          {signedOutToGuest ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Signed out. You&apos;re browsing as a guest again.
            </p>
          ) : null}
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">You&apos;re using guest mode</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Sign up to share lists and join family and friends across devices.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="w-full" onClick={() => { onClose(); onRequestSignUp?.() }}>Sign up</Button>
            <Button variant="secondary" className="w-full" onClick={() => { onClose(); onRequestSignIn?.() }}>Sign in</Button>
          </div>
          <Button variant="secondary" className="w-full" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
            {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          </Button>
          <InstallAppButton />
          <div className="text-center text-xs text-gray-400 dark:text-gray-500">v{APP_VERSION}</div>
        </div>
      </Modal>
    )
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
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Name</label>
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
                />
                <Button size="sm" onClick={() => void handleSaveNickname()}>
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

        <div className="space-y-2 pt-1 border-t border-gray-200 dark:border-neutral-600">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Google account
          </label>
          {googleLinked ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">Google account linked</p>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-full flex items-center justify-center gap-2"
              loading={linkingGoogle}
              disabled={linkingGoogle || signingOut}
              aria-label="Link Google account"
              onClick={async () => {
                setError('')
                setLinkingGoogle(true)
                const { error: linkErr } = await linkGoogleIdentity()
                setLinkingGoogle(false)
                if (linkErr) {
                  setError(linkErr.message)
                  showError(linkErr.message)
                }
              }}
            >
              <GoogleGIcon className="h-5 w-5 shrink-0" />
              Link Google account
            </Button>
          )}
        </div>

        <InstallAppButton />

        <Button
          variant="danger"
          className="w-full mt-2"
          loading={signingOut}
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          Sign Out
        </Button>

        <div className="relative flex items-center justify-center pt-2">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-gray-500">
            v{APP_VERSION}
          </span>
          <button
            type="button"
            className="hover:opacity-80 shrink-0"
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
