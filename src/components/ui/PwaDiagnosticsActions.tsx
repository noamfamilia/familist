'use client'

import { useCallback, useMemo } from 'react'

/**
 * In-app link to open /sw.js with build id cache-buster, same origin as the running app (PWA or tab).
 */
export function PwaDiagnosticsActions() {
  const probeUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const id = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
    return `${window.location.origin}/sw.js?v=${encodeURIComponent(id)}`
  }, [])

  const openProbe = useCallback(() => {
    if (!probeUrl) return
    window.open(probeUrl, '_blank', 'noopener,noreferrer')
  }, [probeUrl])

  if (!probeUrl) return null

  return (
    <div className="fixed bottom-14 left-2 z-40 max-w-[min(100vw-1rem,280px)] rounded-md border border-gray-200 bg-white/95 px-2 py-1.5 text-[10px] leading-tight shadow dark:border-neutral-600 dark:bg-neutral-900/95">
      <button
        type="button"
        onClick={openProbe}
        className="text-left text-teal-700 underline hover:text-teal-900 dark:text-teal-400 dark:hover:text-teal-300"
      >
        Open /sw.js?v=build (same origin)
      </button>
      <div className="mt-0.5 truncate text-neutral-500 dark:text-neutral-400" title={probeUrl}>
        {probeUrl}
      </div>
    </div>
  )
}
