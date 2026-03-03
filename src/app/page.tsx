'use client'

import { useAuth } from '@/providers/AuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { ListsView } from '@/components/lists/ListsView'
import { Toggle } from '@/components/ui/Toggle'
import { useState } from 'react'
import type { Step } from 'react-joyride'

const homeTourSteps: Step[] = [
  {
    target: '[data-tour="home-view-toggle"]',
    content: 'Filter to show all lists or just the ones you own.',
    disableBeacon: true,
  },
  {
    target: '[data-tour="create-list"]',
    content: 'Type a name to create a new list, or type @token to join a shared list.',
  },
  {
    target: '[data-tour="list-card"]',
    content: 'Click the list name to archive/restore. Click elsewhere on the card to open the list. Use the menu (⋮) for more options.',
  },
]

export default function Home() {
  const { user, profile, loading } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all')

  if (loading) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal"></div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 p-4 sm:p-8 relative">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        {/* View toggle - top left */}
        {user && (
          <div data-tour="home-view-toggle">
            <Toggle
              options={[
                { value: 'all', label: 'All' },
                { value: 'mine', label: 'Mine' },
              ]}
              value={viewMode}
              onChange={(v) => setViewMode(v as 'all' | 'mine')}
            />
          </div>
        )}
        {!user && <div />}
        
        {/* Auth button - top right */}
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
            className="text-sm text-teal font-medium hover:bg-teal-light px-2 py-1 rounded"
            aria-label="Sign in"
          >
            Sign in
          </button>
        )}
      </div>

      {/* Header */}
      <header className="text-center mb-6 sm:mb-8">
        <img 
          src="/logo.png" 
          alt="MyFamiList" 
          className="h-12 sm:h-16 mx-auto"
        />
      </header>

      {/* Main content */}
      {user ? (
        <>
          <ListsView viewMode={viewMode} homeTourSteps={homeTourSteps} showTutorial={!showAuthModal} />
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
