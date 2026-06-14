'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { useHasMounted } from '@/hooks/useHasMounted'
import { useAuthModalStore } from '@/stores/authModalStore'

const AuthModal = dynamic(() => import('@/components/auth/AuthModal').then(mod => mod.AuthModal), {
  ssr: false,
})

/** Opens sign-in once guest mode is resolved; renders {@link AuthModal} app-wide. */
export function GlobalAuthModal() {
  const { user, isGuest, authPhase, sessionRestoring, loading } = useAuth()
  const { isOffline } = useConnectivity()
  const hasMounted = useHasMounted()
  const isOpen = useAuthModalStore(s => s.isOpen)
  const mode = useAuthModalStore(s => s.mode)
  const open = useAuthModalStore(s => s.open)
  const close = useAuthModalStore(s => s.close)
  const autoOpenedRef = useRef(false)

  useEffect(() => {
    if (!hasMounted || authPhase === 'resolving' || sessionRestoring || loading) return
    if (!isGuest || user || autoOpenedRef.current || isOffline) return
    autoOpenedRef.current = true
    open('signIn')
  }, [hasMounted, authPhase, sessionRestoring, loading, isGuest, user, isOffline, open])

  useEffect(() => {
    if (user) close()
  }, [user, close])

  if (!isOpen || user) return null

  return <AuthModal isOpen initialMode={mode} onClose={close} />
}
