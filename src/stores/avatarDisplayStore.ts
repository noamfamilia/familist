'use client'

import { create } from 'zustand'
import { getActiveCacheUserId } from '@/lib/cache'
import { isGuestId } from '@/lib/guestSession'
import {
  clearAvatarDisplaySession,
  readAvatarDisplayHint,
  writeAvatarDisplayHint,
} from '@/lib/avatarDisplaySession'

type AvatarDisplayState = {
  activeUserId: string | null
  photoSrc: string | null
  sourceUrl: string | null
  useFallback: boolean
}

type AvatarDisplayActions = {
  beginSession: (userId: string, initialSrc?: string | null) => void
  applyPhotoSrc: (userId: string, next: string, sourceUrl?: string | null) => void
  setUseFallback: (userId: string) => void
  clearSession: () => void
}

function readBootAvatarState(): AvatarDisplayState {
  if (typeof window === 'undefined') {
    return { activeUserId: null, photoSrc: null, sourceUrl: null, useFallback: false }
  }
  const userId = getActiveCacheUserId()
  if (!userId || isGuestId(userId)) {
    return { activeUserId: null, photoSrc: null, sourceUrl: null, useFallback: false }
  }
  const hint = readAvatarDisplayHint(userId)
  return {
    activeUserId: userId,
    photoSrc: hint,
    sourceUrl: hint,
    useFallback: false,
  }
}

export const useAvatarDisplayStore = create<AvatarDisplayState & AvatarDisplayActions>((set, get) => ({
  ...readBootAvatarState(),

  beginSession: (userId, initialSrc) => {
    const st = get()
    if (st.activeUserId === userId && st.photoSrc && !st.useFallback) {
      if (initialSrc && st.photoSrc !== initialSrc && !st.photoSrc.startsWith('blob:')) {
        set({ photoSrc: initialSrc, sourceUrl: initialSrc })
        writeAvatarDisplayHint(userId, initialSrc)
      }
      return
    }

    const hint = initialSrc ?? readAvatarDisplayHint(userId)
    set({
      activeUserId: userId,
      photoSrc: hint,
      sourceUrl: hint,
      useFallback: false,
    })
  },

  applyPhotoSrc: (userId, next, sourceUrl) => {
    const st = get()
    if (st.activeUserId !== userId) return

    const current = st.photoSrc
    if (current === next) return

    if (sourceUrl && current === sourceUrl && next.startsWith('blob:')) {
      writeAvatarDisplayHint(userId, sourceUrl)
      set({ sourceUrl })
      return
    }

    const hintUrl = sourceUrl ?? (next.startsWith('blob:') ? st.sourceUrl : next)
    if (hintUrl) writeAvatarDisplayHint(userId, hintUrl)

    set({
      photoSrc: next,
      sourceUrl: hintUrl ?? st.sourceUrl,
      useFallback: false,
    })
  },

  setUseFallback: (userId) => {
    if (get().activeUserId !== userId) return
    set({ useFallback: true, photoSrc: null })
  },

  clearSession: () => {
    clearAvatarDisplaySession()
    set({
      activeUserId: null,
      photoSrc: null,
      sourceUrl: null,
      useFallback: false,
    })
  },
}))

/** Sync boot from active cache user (pull-to-refresh, before React paints). */
export function bootstrapAvatarDisplaySession(userId: string, initialSrc?: string | null): void {
  if (isGuestId(userId)) {
    useAvatarDisplayStore.getState().clearSession()
    return
  }
  useAvatarDisplayStore.getState().beginSession(userId, initialSrc ?? null)
}
