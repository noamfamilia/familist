'use client'

import { useEffect, useState } from 'react'
import {
  getConnectivityDebugLines,
  subscribeConnectivityDebugLog,
} from '@/lib/connectivityDebugLog'

export function useConnectivityDebugLog() {
  const [revision, setRevision] = useState(0)

  useEffect(() => subscribeConnectivityDebugLog(() => setRevision((n) => n + 1)), [])

  void revision
  return {
    lines: [...getConnectivityDebugLines()],
    revision,
  }
}
