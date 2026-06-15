'use client'

import { useSyncExternalStore } from 'react'

let listTourItemTargetsEnabled = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

/** Toggle Joyride mirrors on the list tour anchor row only. */
export function syncListTourItemTargetsEnabled(enabled: boolean) {
  if (listTourItemTargetsEnabled === enabled) return
  listTourItemTargetsEnabled = enabled
  emit()
}

export function useListTourItemTargetsEnabled(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange)
      return () => listeners.delete(onStoreChange)
    },
    () => listTourItemTargetsEnabled,
    () => false,
  )
}
