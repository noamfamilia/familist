'use client'

import { useLayoutEffect, useState } from 'react'

/**
 * True after the first client layout effect so the first paint can match post-hydration state sooner than `useEffect`.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => {
    setMounted(true)
  }, [])

  return mounted
}
