'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/providers/AuthProvider'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { user, profile, signIn, signUp, signOut, updateProfile } = useAuth()
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (isSignUp) {
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

        const { error } = await signUp(email, password, username.trim(), nickname.trim())
        if (error) {
          setError(error.message)
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
              <p className="text-gray-800">{displayNickname}</p>
            </div>
          </div>

          <Button
            variant="danger"
            className="w-full mt-6"
            onClick={handleSignOut}
          >
            Sign Out
          </Button>
        </div>
      </Modal>
    )
  }

  // Sign in / Sign up form
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={isSignUp ? 'Sign Up' : 'Sign In'}
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

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Your password"
          required
          minLength={6}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
        />

        {isSignUp && (
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

        <Button
          type="submit"
          className="w-full"
          loading={loading}
        >
          {isSignUp ? 'Sign Up' : 'Sign In'}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500">
        {isSignUp ? "Already have an account?" : "Don't have an account?"}
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp)
            setError('')
          }}
          className="ml-2 text-primary font-semibold hover:underline"
        >
          {isSignUp ? 'Sign In' : 'Sign Up'}
        </button>
      </div>
    </Modal>
  )
}
