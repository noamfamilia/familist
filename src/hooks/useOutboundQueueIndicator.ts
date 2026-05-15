'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnectivity } from '@/providers/ConnectivityProvider'
import { useSyncQueueBadge } from '@/lib/data/queries'

/** Show indicator after outbound queue exceeds this; hide only when count returns to 0. */
export const OUTBOUND_QUEUE_INDICATOR_THRESHOLD = 6

export function useOutboundQueueIndicator() {
  const { isOffline, isRecovering } = useConnectivity()
  const queueCount = useSyncQueueBadge() ?? 0
  const latchedRef = useRef(false)
  const [latched, setLatched] = useState(false)

  useEffect(() => {
    if (queueCount > OUTBOUND_QUEUE_INDICATOR_THRESHOLD) {
      latchedRef.current = true
    }
    if (queueCount === 0) {
      latchedRef.current = false
    }
    setLatched(latchedRef.current)
  }, [queueCount])

  const shouldShow = latched && queueCount > 0 && !isOffline && !isRecovering

  return { shouldShow, queueCount }
}
