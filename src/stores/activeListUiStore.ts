'use client'

import { create } from 'zustand'

/** Which list is open on the home shell (full-screen modal). Session rows live in `listDataStore` via `useList`. */
type ActiveListUiState = {
  activeListId: string | null
  setActiveListId: (listId: string | null) => void
}

export const useActiveListUiStore = create<ActiveListUiState>((set) => ({
  activeListId: null,
  setActiveListId: (listId) => set({ activeListId: listId }),
}))
