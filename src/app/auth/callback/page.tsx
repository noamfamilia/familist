'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { buildInvitePath, getPendingInviteToken } from '@/lib/invite'

/** Same shell as home auth bootstrap spinner (page.tsx resolving gate). */
function AuthCallbackShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-none sm:rounded-xl shadow-none sm:shadow-lg dark:shadow-black/40 p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
      {children}
    </div>
  )
}

function CallbackSpinner() {
  return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" aria-hidden />
}

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      const supabase = createClient()
      const code = searchParams.get('code')

      let exchangeErrorMessage: string | null = null
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          exchangeErrorMessage = exchangeError.message
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession()

      if (sessionError) {
        setError(sessionError.message)
        return
      }

      if (!data.session) {
        setError(
          exchangeErrorMessage ??
            'No session found. The link may be expired. Please try again.',
        )
        return
      }

      if (type === 'recovery') {
        router.replace('/reset')
      } else {
        const pendingInviteToken = getPendingInviteToken()
        router.replace(pendingInviteToken ? buildInvitePath(pendingInviteToken) : '/')
      }
    }

    void handleCallback()
  }, [router, searchParams, type])

  if (error) {
    return (
      <AuthCallbackShell>
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="text-sm font-medium text-teal hover:opacity-80"
          >
            Go to Home
          </button>
        </div>
      </AuthCallbackShell>
    )
  }

  return (
    <AuthCallbackShell>
      <CallbackSpinner />
    </AuthCallbackShell>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthCallbackShell>
          <CallbackSpinner />
        </AuthCallbackShell>
      }
    >
      <CallbackHandler />
    </Suspense>
  )
}
