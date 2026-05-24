'use client'

import { useCallback, useEffect, useRef } from 'react'
import Script from 'next/script'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import {
  generateGoogleOneTapNonce,
  googleEmailMatchesAccount,
  GOOGLE_EMAIL_MISMATCH_MESSAGE,
  linkGoogleOneTapCredential,
  parseGoogleIdTokenEmail,
  signInWithGoogleOneTapCredential,
} from '@/lib/authGoogleOneTap'
import {
  applyOAuthSignUpDowngradeForExistingAccount,
  consumeOpenProfileAfterOAuthSignUp,
} from '@/lib/authOAuthPostRedirect'
import { createClient } from '@/lib/supabase/client'
import { userHasGoogleIdentity } from '@/lib/googleProfileNickname'

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
  const { user, authPhase, loading, isGuest, activateAuthenticatedSession } = useAuth()
  const { error: showError, success } = useToast()
  const rawNonceRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const scriptReadyRef = useRef(false)

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const canLinkGoogle =
    !!user &&
    authPhase === 'authenticated' &&
    !userHasGoogleIdentity(user) &&
    !!user.email?.trim()

  const shouldOffer =
    enabled &&
    !!clientId &&
    !loading &&
    authPhase !== 'resolving' &&
    (!user || canLinkGoogle)

  const cancelOneTap = useCallback(() => {
    window.google?.accounts.id.cancel()
    initializedRef.current = false
  }, [])

  const initializeOneTap = useCallback(async () => {
    if (!shouldOffer || !window.google?.accounts?.id || initializedRef.current) return

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const allowDespiteSession = canLinkGoogle
    if (session && !allowDespiteSession) return

    const [raw, hashed] = await generateGoogleOneTapNonce()
    rawNonceRef.current = raw
    const openProfileAfterSignUp = isGuest

    window.google.accounts.id.initialize({
      client_id: clientId,
      use_fedcm_for_prompt: true,
      nonce: hashed,
      callback: async (response: CredentialResponse) => {
        const token = response.credential
        const nonce = rawNonceRef.current
        if (!token || !nonce) return

        const { data: sessionData } = await supabase.auth.getSession()
        const sessionUser = sessionData.session?.user ?? null
        const linking =
          !!sessionUser &&
          !userHasGoogleIdentity(sessionUser) &&
          !!sessionUser.email?.trim()

        if (linking) {
          if (!parseGoogleIdTokenEmail(token)) {
            showError('Could not read an email from this Google account.')
            return
          }
          if (!googleEmailMatchesAccount(sessionUser.email, token)) {
            showError(GOOGLE_EMAIL_MISMATCH_MESSAGE)
            return
          }

          const { data, error } = await linkGoogleOneTapCredential(token, nonce)
          if (error) {
            showError(error.message)
            return
          }
          if (data.user) {
            await activateAuthenticatedSession(data.user, 'google-one-tap-link')
            success('Google account linked.')
          }
          return
        }

        const { data, error } = await signInWithGoogleOneTapCredential(token, nonce, {
          openProfileAfterSignUp,
        })
        if (error) {
          showError(error.message)
          return
        }

        if (data.user) {
          await activateAuthenticatedSession(data.user, 'google-one-tap')
        }

        if (openProfileAfterSignUp && data.user) {
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
  }, [
    shouldOffer,
    clientId,
    isGuest,
    canLinkGoogle,
    showError,
    success,
    onNewGoogleSignUp,
    activateAuthenticatedSession,
  ])

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
