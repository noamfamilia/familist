'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/supabase/types'
import { ProfileAvatar } from '@/components/auth/ProfileAvatar'
import { resolveAuthDisplayName } from '@/lib/authDisplayName'
import { shareMyFamilistApp } from '@/lib/shareFamilistApp'

const menuTextClass = 'text-base font-normal text-gray-900 dark:text-gray-100'

const menuRowClass = `block w-full px-4 py-2.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-neutral-800 ${menuTextClass}`

type ProfileHomeMenuProps = {
  user: User | null
  profile: Profile | null
  isGuest: boolean
  profileMenuNeedsSession: boolean
  menuClassName: string
  themeToggleLabel: string
  onCloseMenu: () => void
  onRequestSignIn: () => void
  onToggleTheme: () => void
  onShowTutorial: () => void
  onRequestImport?: () => void
  onRequestFeedback?: () => void
  importDisabled?: boolean
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  updateActorProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>
  signOut: () => Promise<{ error: Error | null }>
  success: (message: string) => void
  showError: (message: string) => void
}

export function ProfileHomeMenu({
  user,
  profile,
  isGuest,
  profileMenuNeedsSession,
  menuClassName,
  themeToggleLabel,
  onCloseMenu,
  onRequestSignIn,
  onToggleTheme,
  onShowTutorial,
  onRequestImport,
  onRequestFeedback,
  importDisabled = false,
  updateProfile,
  updateActorProfile,
  signOut,
  success,
  showError,
}: ProfileHomeMenuProps) {
  const displayNickname = isGuest
    ? profile?.nickname?.trim() || 'Guest'
    : resolveAuthDisplayName(user, profile)
  const [editingNickname, setEditingNickname] = useState(false)
  const [draftNickname, setDraftNickname] = useState(displayNickname)
  const [signingOut, setSigningOut] = useState(false)
  const [savingNickname, setSavingNickname] = useState(false)
  const nicknameInputRef = useRef<HTMLInputElement>(null)
  const nicknamePopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraftNickname(displayNickname)
  }, [displayNickname])

  useEffect(() => {
    if (editingNickname && nicknameInputRef.current) {
      nicknameInputRef.current.focus()
      nicknameInputRef.current.select()
    }
  }, [editingNickname])

  useEffect(() => {
    if (!editingNickname) return
    const onPointerDown = (e: MouseEvent) => {
      if (nicknamePopoverRef.current && !nicknamePopoverRef.current.contains(e.target as Node)) {
        setDraftNickname(displayNickname)
        setEditingNickname(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [editingNickname, displayNickname])

  const openNicknameEditor = useCallback(() => {
    if (profileMenuNeedsSession) return
    setDraftNickname(displayNickname)
    setEditingNickname(true)
  }, [displayNickname, profileMenuNeedsSession])

  const cancelNicknameEdit = useCallback(() => {
    setDraftNickname(displayNickname)
    setEditingNickname(false)
  }, [displayNickname])

  const saveNickname = useCallback(async () => {
    const trimmed = draftNickname.trim()
    if (!trimmed || trimmed === displayNickname) {
      cancelNicknameEdit()
      return
    }
    setSavingNickname(true)
    try {
      const save = isGuest || !user ? updateActorProfile : updateProfile
      const { error } = await save({ nickname: trimmed })
      if (error) {
        showError(error.message || 'Could not save name')
        return
      }
      setEditingNickname(false)
    } finally {
      setSavingNickname(false)
    }
  }, [
    cancelNicknameEdit,
    displayNickname,
    draftNickname,
    isGuest,
    showError,
    updateActorProfile,
    updateProfile,
    user,
  ])

  const handleSignOut = useCallback(async () => {
    if (signingOut || profileMenuNeedsSession) return
    setSigningOut(true)
    try {
      const { error } = await signOut()
      if (error) {
        showError(error.message || 'Failed to sign out')
        return
      }
      onCloseMenu()
    } finally {
      setSigningOut(false)
    }
  }, [onCloseMenu, profileMenuNeedsSession, showError, signOut, signingOut])

  const handleShare = useCallback(() => {
    onCloseMenu()
    void shareMyFamilistApp({ success, error: showError })
  }, [onCloseMenu, showError, success])

  const handleImport = useCallback(() => {
    if (importDisabled || profileMenuNeedsSession) return
    onCloseMenu()
    onRequestImport?.()
  }, [importDisabled, onCloseMenu, onRequestImport, profileMenuNeedsSession])

  return (
    <div
      className={`relative w-max min-w-[240px] origin-top-left overflow-visible ${menuClassName}`}
      role="menu"
      aria-label="Account menu"
    >
      <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200/90 bg-white shadow-xl shadow-black/10 dark:divide-neutral-700 dark:border-neutral-600/90 dark:bg-neutral-900 dark:shadow-black/50">
        <div className="relative">
          <button
            type="button"
            disabled={profileMenuNeedsSession}
            className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-neutral-800 ${
              profileMenuNeedsSession ? 'cursor-not-allowed opacity-50' : ''
            }`}
            role="menuitem"
            onClick={openNicknameEditor}
          >
            <ProfileAvatar user={user} guest={isGuest} size={32} className="h-8 w-8 shrink-0" />
            <span className={`min-w-0 flex-1 truncate ${menuTextClass}`}>{displayNickname}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="shrink-0 text-gray-400 dark:text-gray-500"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"
              />
            </svg>
          </button>
          {editingNickname && (
            <div
              ref={nicknamePopoverRef}
              className="absolute left-3 right-3 top-full z-[60] mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-neutral-600 dark:bg-neutral-900 dark:shadow-black/40"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                ref={nicknameInputRef}
                type="text"
                value={draftNickname}
                onChange={(e) => setDraftNickname(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNickname()
                  if (e.key === 'Escape') cancelNicknameEdit()
                }}
                disabled={savingNickname}
                className={`mb-2 w-full rounded-lg border border-teal px-2 py-1 text-center ${menuTextClass} focus:outline-none focus:ring-2 focus:ring-teal/20 disabled:opacity-60`}
                aria-label="Display name"
              />
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={savingNickname}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={cancelNicknameEdit}
                  className="flex-1 rounded bg-gray-400 px-1 py-1 text-xs text-white hover:bg-gray-500 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingNickname}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void saveNickname()}
                  className="flex-1 rounded bg-teal px-1 py-1 text-xs text-white hover:opacity-80 disabled:opacity-60"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {isGuest ? (
          <button
            type="button"
            disabled={profileMenuNeedsSession}
            className={`${menuRowClass} ${
              profileMenuNeedsSession
                ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-500'
                : ''
            }`}
            role="menuitem"
            onClick={() => {
              if (profileMenuNeedsSession) return
              onCloseMenu()
              onRequestSignIn()
            }}
          >
            Sign in
          </button>
        ) : (
          <button
            type="button"
            disabled={signingOut || profileMenuNeedsSession}
            className={`${menuRowClass} ${
              signingOut || profileMenuNeedsSession
                ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-500'
                : ''
            }`}
            role="menuitem"
            onClick={() => void handleSignOut()}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        )}

        <button
          type="button"
          className={menuRowClass}
          role="menuitem"
          onClick={() => {
            onCloseMenu()
            onToggleTheme()
          }}
        >
          {themeToggleLabel}
        </button>

        {!isGuest && onRequestImport ? (
          <button
            type="button"
            disabled={importDisabled || profileMenuNeedsSession}
            className={`${menuRowClass} ${
              importDisabled || profileMenuNeedsSession
                ? 'cursor-not-allowed text-gray-400 opacity-50 dark:text-gray-500'
                : ''
            }`}
            role="menuitem"
            title={
              profileMenuNeedsSession
                ? 'Restoring session…'
                : importDisabled
                  ? 'Requires an internet connection'
                  : undefined
            }
            onClick={handleImport}
          >
            Import List
          </button>
        ) : null}

        <button
          type="button"
          className={menuRowClass}
          role="menuitem"
          onClick={() => {
            onCloseMenu()
            onShowTutorial()
          }}
        >
          Show tutorial
        </button>

        {!isGuest && onRequestFeedback ? (
          <button
            type="button"
            className={menuRowClass}
            role="menuitem"
            onClick={() => {
              onCloseMenu()
              onRequestFeedback()
            }}
          >
            User feedback
          </button>
        ) : null}

        <button type="button" className={menuRowClass} role="menuitem" onClick={handleShare}>
          Share My Familist
        </button>
      </div>
    </div>
  )
}
