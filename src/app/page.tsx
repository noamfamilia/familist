'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/providers/AuthProvider'
import { ListsView } from '@/components/lists/ListsView'
import { Toggle } from '@/components/ui/Toggle'
import { Suspense, useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type { Step } from 'react-joyride'
import { clearPendingInviteToken, setPendingInviteToken } from '@/lib/invite'

const AuthModal = dynamic(() => import('@/components/auth/AuthModal').then(mod => mod.AuthModal), {
  ssr: false,
})

// All home tour steps - list steps only shown when lists exist
const homeTourSteps: Step[] = [
  {
    target: '[data-tour="profile-icon"]',
    content: 'Access your profile settings.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="home-view-toggle"]',
    content: 'Show all lists or just the ones you own.',
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
  },
  // List-specific steps - only shown when list targets exist
  {
    target: '[data-tour="list-archive"]',
    content: 'Use ▼/▲ to archive/restore a list.',
  },
  {
    target: '[data-tour="list-share"]',
    content: 'List sharing options.',
  },
  {
    target: '[data-tour="list-menu"]',
    content: 'List menu options',
  },
]

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading, updateProfile } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const inviteToken = searchParams.get('invite')
  const [viewMode, setViewMode] = useState<'all' | 'mine'>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('home_list_filter')
      if (cached === 'all' || cached === 'mine') return cached
    }
    return 'all'
  })

  // Sync viewMode from profile (for cross-device consistency)
  useEffect(() => {
    if (profile?.list_filter === 'mine' || profile?.list_filter === 'all') {
      setViewMode(profile.list_filter)
      localStorage.setItem('home_list_filter', profile.list_filter)
    }
  }, [profile?.list_filter])

  useEffect(() => {
    if (!inviteToken) return
    setPendingInviteToken(inviteToken)
  }, [inviteToken])

  useEffect(() => {
    if (!loading && !user && inviteToken) {
      setShowAuthModal(true)
    }
  }, [loading, user, inviteToken])

  const clearInviteState = () => {
    clearPendingInviteToken()

    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    const search = url.searchParams.toString()
    router.replace(`${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
  }

  // Save viewMode to localStorage and profile when changed
  const handleViewModeChange = (mode: 'all' | 'mine') => {
    setViewMode(mode)
    localStorage.setItem('home_list_filter', mode)
    updateProfile({ list_filter: mode })
  }

  if (loading) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8 relative">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        {/* Auth button - top left */}
        {user ? (
          <button
            onClick={() => setShowAuthModal(true)}
            className="h-8 flex items-center hover:opacity-80 transition-opacity"
            aria-label="Account settings"
            title={user.email}
            data-tour="profile-icon"
          >
            <Image src="/profile.png" alt="Profile settings" width={32} height={32} className="w-8 h-8" />
          </button>
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="h-8 flex items-center text-sm text-teal font-medium hover:bg-teal-light px-2 py-1 rounded"
            aria-label="Sign in"
          >
            Sign in
          </button>
        )}
        
        {/* View toggle - top right */}
        {user && (
          <div data-tour="home-view-toggle">
            <Toggle
              options={[
                { value: 'all', label: 'All' },
                { value: 'mine', label: 'Owned' },
              ]}
              value={viewMode}
              onChange={handleViewModeChange}
            />
          </div>
        )}
        {!user && <div />}
      </div>

      {/* Header */}
      <header className="text-center mb-6 sm:mb-8">
        <Image
          src="/logo.png"
          alt="MyFamiList"
          width={256}
          height={64}
          className="h-12 sm:h-16 w-auto mx-auto"
          priority
        />
      </header>

      {/* Main content */}
      {user ? (
        <>
          <ListsView 
            viewMode={viewMode} 
            homeTourSteps={homeTourSteps}
            showTutorial={!showAuthModal} 
            inviteToken={inviteToken}
            onInviteHandled={clearInviteState}
          />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p>{inviteToken ? 'Sign in to join the shared list' : 'Sign in to view and manage your lists'}</p>
        </div>
      )}

      {/* Auth modal */}
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
      />
    </div>
  )
}

function HomeFallback() {
  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
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
