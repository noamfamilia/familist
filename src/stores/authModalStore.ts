import { create } from 'zustand'

export type AuthModalMode = 'signIn' | 'signUp'

interface AuthModalState {
  isOpen: boolean
  mode: AuthModalMode
  open: (mode?: AuthModalMode) => void
  close: () => void
}

export const useAuthModalStore = create<AuthModalState>((set) => ({
  isOpen: false,
  mode: 'signIn',
  open: (mode = 'signIn') => set({ isOpen: true, mode }),
  close: () => set({ isOpen: false }),
}))
