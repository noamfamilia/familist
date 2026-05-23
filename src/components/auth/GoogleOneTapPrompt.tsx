'use client'

import { useCallback, useEffect, useRef } from 'react'
import Script from 'next/script'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { generateGoogleOneTapNonce, signInWithGoogleOneTapCredential } from '@/lib/authGoogleOneTap'
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

export function GoogleOneTapPrompt({ enabled = true, onNewGoogleSignUp }: GoogleOneTapPromptProps) {
  const { user, authPhase, loading, isGuest } = useAuth()
  const { error: showError } = useToast()
  const rawNonceRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const scriptReadyRef = useRef(false)

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  const shouldOffer =
    enabled &&
    !!clientId &&
    !loading &&
    !user &&
    authPhase !== 'resolving'

  const cancelOneTap = useCallback(() => {
    window.google?.accounts.id.cancel()
    initializedRef.current = false
  }, [])

  const initializeOneTap = useCallback(async () => {
    if (!shouldOffer || !window.google?.accounts?.id || initializedRef.current) return

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session) return

    const [raw, hashed] = await generateGoogleOneTapNonce()
    rawNonceRef.current = raw
    const treatAsSignUp = isGuest

    window.google.accounts.id.initialize({
      client_id: clientId,
      use_fedcm_for_prompt: true,
      nonce: hashed,
      callback: async (response: CredentialResponse) => {
        const token = response.credential
        const nonce = rawNonceRef.current
        if (!token || !nonce) return

        const { data, error } = await signInWithGoogleOneTapCredential(token, nonce, { treatAsSignUp })
        if (error) {
          showError(error.message)
          return
        }

        if (treatAsSignUp && data.user) {
          if (applyOAuthSignUpDowngradeForExistingAccount(data.user)) {
            // Existing account: info toast handled on home via sessionStorage notice.
          } else if (consumeOpenProfileAfterOAuthSignUp()) {
            onNewGoogleSignUp?.()
          }
        }
      },
    })

    initializedRef.current = true
    window.google.accounts.id.prompt()
  }, [shouldOffer, clientId, isGuest, showError, onNewGoogleSignUp])

  useEffect(() => {
    if (!shouldOffer) {
      cancelOneTap()
      return
    }
    if (scriptReadyRef.current) {
      void initializeOneTap()
    }
    return cancelOneTap
  }, [shouldOffer, initializeOneTap, cancelOneTap])

  if (!clientId) return null

  return (
    <Script
      src="https://accounts.google.com/gsi/client"
      strategy="afterInteractive"
      onLoad={() => {
        scriptReadyRef.current = true
        initializedRef.current = false
        if (shouldOffer) void initializeOneTap()
      }}
    />
  )
}
