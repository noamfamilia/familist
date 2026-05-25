'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import {
  generateGoogleOneTapNonce,
  signInWithGoogleOneTapCredential,
} from '@/lib/authGoogleOneTap'
import {
  applyOAuthSignUpDowngradeForExistingAccount,
  consumeOpenProfileAfterOAuthSignUp,
} from '@/lib/authOAuthPostRedirect'
import { createClient } from '@/lib/supabase/client'

type CredentialResponse = { credential?: string }

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void
          prompt: () => void
          cancel: () => void
        }
      }
    }
  }
}

type GoogleOneTapPromptProps = {
  enabled?: boolean
  onNewGoogleSignUp?: () => void
}

/**
 * Google One Tap is for guest sign-in only. Signed-in email/password users link Google
 * from Profile (OAuth), not FedCM One Tap — avoids FedCM abort noise and session churn.
 */
export function GoogleOneTapPrompt({ enabled = true, onNewGoogleSignUp }: GoogleOneTapPromptProps) {
  const { authPhase, loading, isGuest, sessionRestoring, activateAuthenticatedSession } = useAuth()
  const { error: showError } = useToast()
  const rawNonceRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const initInFlightRef = useRef(false)
  const onNewGoogleSignUpRef = useRef(onNewGoogleSignUp)
  onNewGoogleSignUpRef.current = onNewGoogleSignUp
  const [scriptReady, setScriptReady] = useState(false)

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  const shouldOffer =
    enabled &&
    !!clientId &&
    isGuest &&
    authPhase === 'guest' &&
    !loading &&
    !sessionRestoring

  const initializeOneTap = useCallback(async () => {
    if (!shouldOffer || !window.google?.accounts?.id || initializedRef.current || initInFlightRef.current) {
      return
    }
    initInFlightRef.current = true
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session) return
      if (!shouldOffer || initializedRef.current || !window.google?.accounts?.id) return

      const [raw, hashed] = await generateGoogleOneTapNonce()
      rawNonceRef.current = raw

      window.google.accounts.id.initialize({
        client_id: clientId,
        use_fedcm_for_prompt: true,
        nonce: hashed,
        callback: async (response: CredentialResponse) => {
          const token = response.credential
          const nonce = rawNonceRef.current
          if (!token || !nonce) return

          const { data, error } = await signInWithGoogleOneTapCredential(token, nonce, {
            openProfileAfterSignUp: true,
          })
          if (error) {
            showError(error.message)
            return
          }

          if (data.user) {
            await activateAuthenticatedSession(data.user, 'google-one-tap')
          }

          if (data.user) {
            if (applyOAuthSignUpDowngradeForExistingAccount(data.user)) {
              // Existing account: info toast handled on home via sessionStorage notice.
            } else if (consumeOpenProfileAfterOAuthSignUp()) {
              onNewGoogleSignUpRef.current?.()
            }
          }
        },
      })

      initializedRef.current = true
      window.google.accounts.id.prompt()
    } finally {
      initInFlightRef.current = false
    }
  }, [shouldOffer, clientId, showError, activateAuthenticatedSession])

  useEffect(() => {
    if (!shouldOffer) {
      if (initializedRef.current) {
        window.google?.accounts.id.cancel()
      }
      return
    }
    if (!scriptReady) return
    void initializeOneTap()
  }, [shouldOffer, scriptReady, initializeOneTap])

  if (!clientId || !isGuest) return null

  return (
    <Script
      src="https://accounts.google.com/gsi/client"
      strategy="afterInteractive"
      onLoad={() => setScriptReady(true)}
    />
  )
}
