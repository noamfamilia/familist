'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/providers/AuthProvider'
import { ListsView } from '@/components/lists/ListsView'
import { ThemedImage } from '@/components/ui/ThemedImage'

import Link from 'next/link'
import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
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
  const [selectedLabel, setSelectedLabel] = useState('Any')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const [availableLabels, setAvailableLabels] = useState<string[]>([])
  const labelDropdownRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!labelDropdownOpen) return
    const close = (e: MouseEvent) => {
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(e.target as Node)) {
        setLabelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [labelDropdownOpen])

  const handleLabelsChange = useCallback((labels: string[]) => {
    setAvailableLabels(labels)
  }, [])

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
        
        {user ? (
            <div className="flex items-center gap-2" ref={labelDropdownRef}>
            <svg className="h-8 w-8 flex-shrink-0" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M746.5 575.9L579.2 743.6l-173-173.5-53.3-112.4 108.3-108.6 112.2 53.4z" fill="#FBBA22" />
              <path d="M579.4 389.9l-112.2-53.4c-5.3-2.5-11.6-1.4-15.8 2.7L435 355.7c-85.5-108.1-150.2-83.1-152.9-82-5 2-8.4 6.7-8.8 12.1-4.6 72.2 38.2 118.1 86.8 145l-17 17c-4.2 4.2-5.3 10.5-2.7 15.8L393.7 576c0.7 1.4 1.6 2.8 2.7 3.9l173.1 173.5c5.4 5.4 14.2 5.4 19.7 0l167.3-167.6c2.6-2.6 4.1-6.2 4.1-9.9s-1.5-7.2-4.1-9.9L583.3 392.6c-1.2-1.1-2.5-2-3.9-2.7z m-278.7-91.5c17.3-0.6 58.8 5.9 114 76.6 0.1 0.2 0.3 0.3 0.5 0.5l-34.7 34.8c-38.8-19.1-78.8-53-79.8-111.9z m426.1 277.5L579.2 723.8 417.7 562l-48-101.4 17-17c14 5.8 27.9 10.1 40.7 13.1 1.1 4.7 3.5 9.3 7.2 13a27.22 27.22 0 0 0 38.6 0c10.7-10.7 10.7-28 0-38.7-10.3-10.3-26.6-10.6-37.3-1.1-7.5-1.8-17.1-4.4-27.6-8l55.8-55.9 101.2 48 161.5 161.9z" fill="#211F1E" />
            </svg>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLabelDropdownOpen(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  labelDropdownOpen
                    ? 'bg-white dark:bg-slate-800 text-teal border border-teal'
                    : 'bg-teal text-white'
                }`}
              >
                {selectedLabel === '' ? <span className="text-gray-400">None</span> : selectedLabel}
                <svg className={`h-3 w-3 transition-transform ${labelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>

              {labelDropdownOpen && (
                <div className="absolute right-0 mt-1 min-w-[160px] rounded-lg border border-teal bg-white dark:bg-slate-800 shadow-lg dark:shadow-slate-900/50 z-50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setSelectedLabel('Any'); setLabelDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      selectedLabel === 'Any' ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    Any
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSelectedLabel(''); setLabelDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      selectedLabel === '' ? 'bg-gray-100 dark:bg-slate-700 text-gray-400 font-semibold' : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    None
                  </button>
                  {availableLabels.map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => { setSelectedLabel(l); setLabelDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        selectedLabel === l ? 'bg-teal/10 text-teal font-semibold' : 'text-teal hover:bg-gray-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div />
        )}
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
            selectedLabel={selectedLabel}
            onLabelsChange={handleLabelsChange}
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
