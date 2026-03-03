'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [message, setMessage] = useState('Completing password recovery...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()

      const { data, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        setError(`Auth error: ${sessionError.message}`)
        return
      }

      if (data.session) {
        router.replace('/reset')
        return
      }

      setError('No recovery session found. Please request a new reset email.')
    }

    handleCallback()
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md text-center">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <h1 className="text-xl font-bold text-primary mb-2">Authentication Error</h1>
          <p className="text-red-600 mb-6 text-sm break-words">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="bg-teal text-white px-6 py-2 rounded-lg hover:bg-teal/90"
          >
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal mx-auto mb-4"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  )
}
