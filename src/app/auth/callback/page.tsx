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
        // 1) Check for hash-based return (server cannot see this)
        const hash = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : ''
        const hashParams = new URLSearchParams(hash)

        // Check for errors in hash
        const hashError = hashParams.get('error') || hashParams.get('error_code')
        if (hashError) {
          const desc = hashParams.get('error_description')?.replace(/\+/g, ' ') || 'Unknown error'
          setError(`${hashError}: ${desc}`)
          return
        }

        // Check for tokens in hash (implicit flow)
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const typeFromHash = hashParams.get('type')

        if (accessToken && refreshToken) {
          setStatus('Setting session from tokens...')
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) {
            setError(`Session error: ${sessionError.message}`)
            return
          }
          // Clear hash to avoid re-processing
          window.history.replaceState({}, document.title, window.location.pathname)
          
          if (typeFromHash === 'recovery') {
            router.replace('/reset')
          } else {
            router.replace('/')
          }
          return
        }

        // 2) Check for code-based return (PKCE flow)
        const code = searchParams.get('code')
        const type = searchParams.get('type')

        if (code) {
          setStatus('Exchanging code for session...')
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(`Code exchange error: ${exchangeError.message}`)
            return
          }
          
          // Redirect based on type
          if (type === 'recovery') {
            router.replace('/reset')
          } else {
            router.replace('/')
          }
          return
        }

        // 3) Nothing useful present
        setError('Missing authentication parameters. Please request a new reset email.')
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
