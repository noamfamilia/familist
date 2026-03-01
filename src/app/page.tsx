'use client'

import { useAuth } from '@/providers/AuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { ListsView } from '@/components/lists/ListsView'
import { TutorialTour } from '@/components/ui/TutorialTour'
import { useState } from 'react'
import type { Step } from 'react-joyride'

const homeTourSteps: Step[] = [
  {
    target: '[data-tour="create-list"]',
    content: 'Create a new shopping list here. Give it a name and click Create.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="join-list"]',
    content: 'Have a token from someone? Enter it here to join their shared list.',
  },
  {
    target: '[data-tour="list-card"]',
    content: 'Click on a list to open it. Use the menu (⋮) to rename, share, archive, or delete.',
  },
]

export default function Home() {
  const { user, profile, loading } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 min-w-[300px]">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-lg w-full sm:w-[450px] max-w-4xl p-4 sm:p-8 relative">
      {/* Auth bar */}
      <div className="absolute top-3 right-3 z-10">
        {user ? (
          <button
            onClick={() => setShowAuthModal(true)}
            className="hover:opacity-80 transition-opacity"
            aria-label="Account settings"
            title={profile?.nickname || profile?.username || user.email}
          >
            <img src="/profile-icon.png" alt="Profile settings" className="w-8 h-8" />
          </button>
        ) : (
          <button
            onClick={() => setShowAuthModal(true)}
            className="text-sm text-primary hover:bg-primary-light px-2 py-1 rounded"
            aria-label="Sign in"
          >
            Sign in
          </button>
        )}
      </div>

      {/* Header */}
      <header className="text-center mb-6 sm:mb-8 pt-6 sm:pt-0">
        <img 
          src="/logo.png" 
          alt="MyFamiList" 
          className="h-12 sm:h-16 mx-auto"
        />
      </header>

      {/* Main content */}
      {user ? (
        <>
          <ListsView />
          <TutorialTour tourId="home" steps={homeTourSteps} />
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p>Sign in to view and manage your lists</p>
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
