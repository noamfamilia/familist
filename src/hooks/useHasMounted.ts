'use client'

import { useEffect, useState } from 'react'

/**
 * True only after the first client effect, so initial client render matches SSR.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}
