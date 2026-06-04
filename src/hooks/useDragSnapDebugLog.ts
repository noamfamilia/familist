'use client'

import { useEffect, useState } from 'react'
import {
  getDragSnapDebugLines,
  getLastDragSnap,
  subscribeDragSnapDebug,
} from '@/lib/dragSnapDebugLog'

export function useDragSnapDebugLog() {
  const [revision, setRevision] = useState(0)

  useEffect(() => subscribeDragSnapDebug(() => setRevision((n) => n + 1)), [])

  void revision
  return {
    lastSnap: getLastDragSnap(),
    lines: [...getDragSnapDebugLines()],
    revision,
  }
}
