'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Suspense } from 'react'

function CallbackHandler() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState('Processing authentication...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for code-based return (PKCE flow)
        const code = searchParams.get('code')

        if (code) {
          setStatus('Exchanging code for session...')
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(`Code exchange error: ${exchangeError.message}`)
            return
          }
          
          // Success - redirect to reset password page
          router.replace('/reset')
          return
        }

        // No code present
        setError('Missing authentication code. Please request a new reset email.')
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        setError(`Callback failed: ${message}`)
      }
    }

    handleCallback()
  }, [router, searchParams, supabase.auth])

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
        <p className="text-gray-600">{status}</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  )
}
