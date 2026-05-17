'use client'

import { useEffect, useState } from 'react'
import {
  getServerSessionEntries,
  getServerSessionSummary,
  subscribeServerSessionLog,
} from '@/lib/serverSessionLog'

export function useServerSessionLog() {
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeServerSessionLog(() => setTick((n) => n + 1)), [])

  void tick
  return {
    /** Fresh array each notify so consumers’ `useMemo` deps see updates. */
    entries: [...getServerSessionEntries()],
    summary: getServerSessionSummary(),
    revision: tick,
  }
}
