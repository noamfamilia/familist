'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/providers/AuthProvider'
import { resetTutorial } from '@/components/ui/TutorialTour'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function InstallAppButton() {
  const [canInstall, setCanInstall] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    // Check for iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
    setIsIOS(isIOSDevice)

    if (isIOSDevice) {
      const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator as any).standalone
      if (!isInStandaloneMode) {
        setCanInstall(true)
      }
    } else {
      const handler = (e: Event) => {
        e.preventDefault()
        setDeferredPrompt(e as BeforeInstallPromptEvent)
        setCanInstall(true)
      }
      window.addEventListener('beforeinstallprompt', handler)
      return () => window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const handleInstall = async () => {
    if (isIOS) {
      alert('To install MyFamiList:\n\n1. Tap the Share button (□↑) at the bottom of Safari\n2. Scroll down and tap "Add to Home Screen"\n3. Tap "Add" to confirm')
      return
    }

    if (!deferredPrompt) return

    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setCanInstall(false)
      setIsInstalled(true)
    }
    setDeferredPrompt(null)
  }

  if (isInstalled || !canInstall) {
    return null
  }

  return (
    <Button variant="secondary" className="w-full" onClick={handleInstall}>
      Install App
    </Button>
  )
}

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { user, profile, signIn, signUp, signOut, updateProfile, resetPassword } = useAuth()
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [nickname, setNickname] = useState('')

  const resetForm = () => {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setUsername('')
    setNickname('')
    setError('')
    setSuccessMessage('')
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setLoading(true)

    try {
      if (mode === 'forgotPassword') {
        const { error } = await resetPassword(email)
        if (error) {
          setError(error.message)
        } else {
          setSuccessMessage('Password reset email sent! Check your inbox.')
        }
      } else if (mode === 'signUp') {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          setLoading(false)
          return
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters')
          setLoading(false)
          return
        }
        if (!username.trim()) {
          setError('Username is required')
          setLoading(false)
          return
        }

        const { error, needsEmailConfirmation } = await signUp(email, password, username.trim(), nickname.trim())
        if (error) {
          setError(error.message)
        } else if (needsEmailConfirmation) {
          setSuccessMessage('Account created! Check your email to confirm your account.')
        } else {
          handleClose()
        }
      } else {
        const { error } = await signIn(email, password)
        if (error) {
          setError(error.message)
        } else {
          handleClose()
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    handleClose()
  }

  // If user is logged in and not in the middle of auth transition, show account info
  // Use profile data, or fall back to user metadata if profile not loaded
  const displayUsername = profile?.username || user?.user_metadata?.username || '-'
  const displayNickname = profile?.nickname || user?.user_metadata?.nickname || '-'
  
  const [isEditingNickname, setIsEditingNickname] = useState(false)
  const [editNickname, setEditNickname] = useState(displayNickname)
  const [savingNickname, setSavingNickname] = useState(false)

  const handleSaveNickname = async () => {
    if (!editNickname.trim() || editNickname === displayNickname) {
      setIsEditingNickname(false)
      return
    }
    setSavingNickname(true)
    const { error } = await updateProfile({ nickname: editNickname.trim() })
    if (error) {
      setError(error.message)
    }
    setSavingNickname(false)
    setIsEditingNickname(false)
  }

  if (user && !loading) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Account">
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</label>
              <p className="text-gray-800 break-all">{user.email}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Username</label>
              <p className="text-gray-800">{displayUsername}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nickname</label>
              {isEditingNickname ? (
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={editNickname}
                    onChange={(e) => setEditNickname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveNickname()
                      if (e.key === 'Escape') {
                        setEditNickname(displayNickname)
                        setIsEditingNickname(false)
                      }
                    }}
                    className="flex-1 px-3 py-1.5 border border-teal rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal/20"
                    autoFocus
                    disabled={savingNickname}
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveNickname}
                    loading={savingNickname}
                  >
                    Save
                  </Button>
                </div>
              ) : (
                <p 
                  className="text-gray-800 cursor-pointer hover:text-teal"
                  onClick={() => {
                    setEditNickname(displayNickname)
                    setIsEditingNickname(true)
                  }}
                  title="Click to edit"
                >
                  {displayNickname} <span className="text-gray-400 text-sm">✎</span>
                </p>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <InstallAppButton />

          <Button
            variant="danger"
            className="w-full mt-6"
            onClick={handleSignOut}
          >
            Sign Out
          </Button>

          <div className="relative flex justify-center items-center mt-2">
            <button
              className="hover:opacity-80"
              onClick={() => {
                navigator.clipboard.writeText('Check out MyFamiList - a shared lists app for families! https://myfamilist.com')
                alert('Link copied to clipboard!')
              }}
            >
              <img src="/share.png" alt="Share MyFamiList" className="h-12" />
            </button>

            <button
              className="absolute right-0 text-sm text-teal hover:underline flex flex-col items-end"
              onClick={() => {
                resetTutorial('home-intro')
                resetTutorial('home-lists')
                resetTutorial('list-intro')
                resetTutorial('list-items')
                resetTutorial('list-members')
                handleClose()
                window.location.reload()
              }}
            >
              <span>Replay</span>
              <span>Tutorial</span>
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // Get modal title based on mode
  const getTitle = () => {
    if (mode === 'forgotPassword') return 'Reset Password'
    if (mode === 'signUp') return 'Sign Up'
    return 'Sign In'
  }

  // Sign in / Sign up / Forgot password form
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={getTitle()}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          autoComplete="username"
        />

        {mode !== 'forgotPassword' && (
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
            minLength={6}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          />
        )}

        {mode === 'signUp' && (
          <>
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your password"
              required
              minLength={6}
              autoComplete="new-password"
            />

            <Input
              label="Username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. john_smith"
              required
              maxLength={100}
              autoComplete="name"
            />

            <Input
              label="Nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. John"
              maxLength={50}
              autoComplete="nickname"
            />
          </>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 text-green-600 px-4 py-3 rounded-lg text-sm text-center">
            {successMessage}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          loading={loading}
        >
          {mode === 'forgotPassword' ? 'Send Reset Email' : mode === 'signUp' ? 'Sign Up' : 'Sign In'}
        </Button>

        {mode === 'signIn' && (
          <button
            type="button"
            onClick={() => {
              setMode('forgotPassword')
              setError('')
              setSuccessMessage('')
            }}
            className="w-full text-sm text-gray-500 hover:text-teal"
          >
            Forgot your password?
          </button>
        )}
      </form>

      <div className="mt-6 flex flex-col items-center gap-2">
        <span className="text-sm text-gray-500">
          {mode === 'signUp' ? "Already have an account?" : mode === 'forgotPassword' ? "Remember your password?" : "Don't have an account?"}
        </span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (mode === 'signUp') {
              setMode('signIn')
            } else {
              setMode(mode === 'forgotPassword' ? 'signIn' : 'signUp')
            }
            setError('')
            setSuccessMessage('')
          }}
        >
          {mode === 'signUp' ? 'Sign In' : mode === 'forgotPassword' ? 'Sign In' : 'Sign Up'}
        </Button>
      </div>
    </Modal>
  )
}
