'use client'

import { useEffect, useState } from 'react'

export function ClientHydrationGate({ children }: { children: React.ReactNode }) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) {
    return <div style={{ display: 'none' }}>Loading...</div>
  }

  return <>{children}</>
}
