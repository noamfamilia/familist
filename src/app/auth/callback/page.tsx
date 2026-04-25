'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildInvitePath, getPendingInviteToken } from '@/lib/invite'

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const [message, setMessage] = useState('Completing authentication...')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()

      const { data, error: sessionError } = await supabase.auth.getSession()
      
      if (sessionError) {
        setError(`Auth error: ${sessionError.message}`)
        return
      }

      if (!data.session) {
        setError('No session found. The link may be expired. Please try again.')
        return
      }

      // Branch based on flow type
      if (type === 'recovery') {
        router.replace('/reset')
      } else {
        const pendingInviteToken = getPendingInviteToken()
        router.replace(pendingInviteToken ? buildInvitePath(pendingInviteToken) : '/')
      }
    }

    handleCallback()
  }, [router, type])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-900 p-4">
        <div className="bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-8 w-full max-w-md text-center">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <h1 className="text-xl font-bold text-primary dark:text-gray-100 mb-2">Authentication Error</h1>
          <p className="text-red-600 dark:text-red-400 mb-6 text-sm break-words">{error}</p>
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-900 p-4">
      <div className="bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-8 w-full max-w-md text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-300">{message}</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-900 p-4">
        <div className="bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-8 w-full max-w-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  )
}
