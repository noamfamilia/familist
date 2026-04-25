'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/providers/AuthProvider'

export default function ResetPage() {
  const router = useRouter()
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-900 p-4">
        <div className="bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-8 w-full max-w-md text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h1 className="text-2xl font-bold text-primary dark:text-gray-100 mb-2">Password Updated</h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">Your password has been successfully reset.</p>
          <Button onClick={() => router.push('/')} className="w-full">
            Go to Home
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-900 p-4">
      <div className="bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-primary dark:text-gray-100 text-center mb-6">Set New Password</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="New Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter new password"
            required
            minLength={6}
            autoComplete="new-password"
          />

          <Input
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            required
            minLength={6}
            autoComplete="new-password"
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            Update Password
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-teal"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
