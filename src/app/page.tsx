'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/providers/AuthProvider'
import { ListsView } from '@/components/lists/ListsView'
import { ThemedImage } from '@/components/ui/ThemedImage'

import Link from 'next/link'
import { Suspense, useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { Step } from 'react-joyride'
import { clearPendingInviteToken, setPendingInviteToken } from '@/lib/invite'
import { resetTutorial } from '@/components/ui/TutorialTour'
import { useTheme } from 'next-themes'

const AuthModal = dynamic(() => import('@/components/auth/AuthModal').then(mod => mod.AuthModal), {
  ssr: false,
})

// All home tour steps - list steps only shown when lists exist
const homeTourSteps: Step[] = [
  {
    target: '[data-tour="home-profile-menu"]',
    content: 'App settings',
    disableBeacon: true,
  },
  {
    target: '[data-tour="create-list"]',
    content: 'Create a new list.',
  },
  {
    target: '[data-tour="list-card"]',
    content: 'Click list to view and manage items',
  },
  {
    target: '[data-tour="list-drag-handle"]',
    content: 'Drag to re-arrange lists.',
    spotlightPadding: 2,
  },
  // List-specific steps - only shown when list targets exist
  {
    target: '[data-tour="list-archive"]',
    content: 'Use ▼/▲ to archive/restore a list.',
    spotlightPadding: 2,
  },
  {
    target: '[data-tour="list-share"]',
    content: 'List sharing options.',
  },
  {
    target: '[data-tour="list-menu"]',
    content: 'List menu options',
    spotlightPadding: 2,
  },
]

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading, updateProfile } = useAuth()
  const { theme, setTheme } = useTheme()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const inviteToken = searchParams.get('invite')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [showDenote, setShowDenote] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!inviteToken) return
    setPendingInviteToken(inviteToken)
  }, [inviteToken])

  useEffect(() => {
    if (!loading && !user && inviteToken) {
      setShowAuthModal(true)
    }
  }, [loading, user, inviteToken])

  useEffect(() => {
    if (!profileMenuOpen) return
    const close = (e: MouseEvent) => {
      const el = profileMenuRef.current
      if (el && !el.contains(e.target as Node)) setProfileMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!profileMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [profileMenuOpen])

  const clearInviteState = () => {
    clearPendingInviteToken()

    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    const search = url.searchParams.toString()
    router.replace(`${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8 relative">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        {/* Auth button - top left */}
        {user ? (
          <div className="relative" ref={profileMenuRef} data-tour="home-profile-menu">
            <button
              type="button"
              onClick={() => setProfileMenuOpen(o => !o)}
              className="h-8 flex items-center hover:opacity-80 transition-opacity rounded-lg"
              aria-label="Account menu"
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              title={user.email}
            >
              <ThemedImage src="/profile.png" alt="" width={32} height={32} className="w-8 h-8" />
            </button>
            {profileMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1 min-w-[220px] rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 py-1 z-50"
                role="menu"
              >
                <Link
                  href="/profile"
                  className="block px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  role="menuitem"
                  onClick={() => setProfileMenuOpen(false)}
                >
                  Profile settings
                </Link>
                <Link
                  href="/import"
                  className="block px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  role="menuitem"
                  onClick={() => setProfileMenuOpen(false)}
                >
                  Import from Google Sheet
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    resetTutorial('home')
                    resetTutorial('list')
                    window.location.reload()
                  }}
                >
                  Replay tutorial
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  onClick={() => {
                    setTheme(theme === 'dark' ? 'light' : 'dark')
                    setProfileMenuOpen(false)
                  }}
                >
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-700"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    setShowDenote(true)
                  }}
                >
                  Denote
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="h-8 flex items-center text-sm text-teal font-medium hover:bg-teal-light px-2 py-1 rounded"
            aria-label="Sign in"
          >
            Sign in
          </button>
        )}
        
        <div />
        {!user && <div />}
      </div>

      {/* Header */}
      <header className="text-center mb-6 sm:mb-8">
        <ThemedImage
          src="/logo.png"
          alt="MyFamiList"
          width={256}
          height={64}
          className="h-12 w-40 sm:h-16 sm:w-52 mx-auto"
          priority
        />
      </header>

      {/* Main content */}
      {user ? (
        <>
          <ListsView 
            viewMode="all" 
            homeTourSteps={homeTourSteps}
            showTutorial={!showAuthModal} 
            inviteToken={inviteToken}
            onInviteHandled={clearInviteState}
          />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>{inviteToken ? 'Sign in to join the shared list' : 'Sign in to view and manage your lists'}</p>
        </div>
      )}

      {/* Auth modal */}
      <AuthModal
        isOpen={showAuthModal && !user}
        onClose={() => setShowAuthModal(false)}
      />

      {showDenote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDenote(false)} />
          <div
            className="relative w-full max-w-md aspect-square rounded-xl bg-cover bg-center shadow-xl"
            style={{ backgroundImage: 'url(/denote.jpg)' }}
          >
            <button
              onClick={() => setShowDenote(false)}
              className="absolute top-3 right-3 text-white text-4xl font-bold leading-none drop-shadow-lg hover:opacity-80"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HomeFallback() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-slate-900/50 p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeContent />
    </Suspense>
  )
}
