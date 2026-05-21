'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { GoogleGIcon } from '@/components/auth/GoogleGIcon'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'signIn' | 'signUp'
}

export function AuthModal({ isOpen, onClose, initialMode = 'signIn' }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const { error: showErrorToast } = useToast()
  const [mode, setMode] = useState<'signIn' | 'signUp' | 'forgotPassword'>(initialMode)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')

  useEffect(() => {
    if (isOpen) setMode(initialMode)
  }, [isOpen, initialMode])

  const resetForm = () => {
    setEmail('')
    setPassword('')
    setConfirmPassword('')
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
        const { error, needsEmailConfirmation } = await signUp(email, password, nickname.trim())
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
            autoComplete="email"
          />

          {mode === 'signUp' && (
            <Input
              label="Nickname (you can change it later)"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. John"
              required
              maxLength={50}
              autoComplete="nickname"
            />
          )}

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
            </>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm text-center">
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
            disabled={googleLoading}
          >
            {mode === 'forgotPassword' ? 'Send Reset Email' : mode === 'signUp' ? 'Sign Up' : 'Sign In'}
          </Button>

          {mode !== 'forgotPassword' && (
            <>
              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-gray-200 dark:bg-neutral-600" aria-hidden />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">OR</span>
                <div className="h-px flex-1 bg-gray-200 dark:bg-neutral-600" aria-hidden />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full flex items-center justify-center gap-2"
                loading={googleLoading}
                disabled={loading}
                aria-label="Continue with Google"
                onClick={async () => {
                  setError('')
                  setSuccessMessage('')
                  setGoogleLoading(true)
                  const intent = mode === 'signUp' ? 'signUp' : 'signIn'
                  const { error: googleError } = await signInWithGoogle(intent)
                  if (googleError) {
                    setGoogleLoading(false)
                    setError(googleError.message)
                    showErrorToast(googleError.message)
                  }
                }}
              >
                <GoogleGIcon className="h-5 w-5 shrink-0" />
                Continue with Google
              </Button>
            </>
          )}

          {mode === 'signIn' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgotPassword')
                setError('')
                setSuccessMessage('')
              }}
              className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-teal"
            >
              Forgot your password?
            </button>
          )}
        </form>

        <div className="mt-6 flex flex-col items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
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
