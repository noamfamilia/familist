'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { log } from '@/lib/startupPerfLog'

export function AppLayoutGateLogger() {
  const { loading } = useAuth()
  const { online, internetReachable } = useConnectivity()
  const prevRef = useRef<string>('')

  useEffect(() => {
    const payload = {
      shouldRender: true,
      online,
      internetReachable: internetReachable === true,
      authReady: !loading,
    }
    const snapshot = JSON.stringify(payload)
    if (snapshot === prevRef.current) return
    prevRef.current = snapshot
    log.info('GATE', 'AppLayout', payload)
  }, [internetReachable, loading, online])

  return null
}
