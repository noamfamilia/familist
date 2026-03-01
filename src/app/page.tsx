'use client'

import { useAuth } from '@/providers/AuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { ListsView } from '@/components/lists/ListsView'
import { useState } from 'react'

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
            className="text-sm text-primary hover:bg-primary-light px-2 py-1 rounded truncate max-w-[150px] sm:max-w-none"
            aria-label="Account settings"
          >
            <span className="hidden sm:inline">{profile?.username || user.user_metadata?.username || user.email}</span>
            <span className="sm:hidden">Account</span>
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
        <h1 className="text-2xl sm:text-3xl font-semibold text-gray-800">Familist</h1>
      </header>

      {/* Main content */}
      {user ? (
        <ListsView />
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
