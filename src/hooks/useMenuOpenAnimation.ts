import { useEffect, useState } from 'react'

/** Matches transition duration in globals.css per variant */
export const MENU_ANIMATION_MS = {
  dropdown: 300,
  'slide-ltr': 280,
  'slide-panel-ltr': 480,
} as const

export type MenuOpenAnimationVariant = keyof typeof MENU_ANIMATION_MS

/** @deprecated use MENU_ANIMATION_MS.dropdown */
export const MENU_OPEN_ANIMATION_MS = MENU_ANIMATION_MS.dropdown

/**
 * Mount/unmount timing for animated menus (opacity + translate).
 * Open: mount → add `open` on next frames. Close: remove `open` → unmount after transition.
 */
export function useMenuOpenAnimation(isOpen: boolean, variant: MenuOpenAnimationVariant = 'dropdown') {
  const [mounted, setMounted] = useState(isOpen)
  const [openClass, setOpenClass] = useState(false)
  const durationMs = MENU_ANIMATION_MS[variant]
  const baseClass =
    variant === 'slide-panel-ltr'
      ? 'menu-slide-panel-ltr'
      : variant === 'slide-ltr'
        ? 'menu-slide-ltr'
        : 'menu'
  const openSuffix = openClass ? ' open' : ''

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setOpenClass(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        if (raf2) cancelAnimationFrame(raf2)
      }
    }
    setOpenClass(false)
    const t = window.setTimeout(() => setMounted(false), durationMs)
    return () => window.clearTimeout(t)
  }, [durationMs, isOpen])

  return {
    mounted,
    /** Includes base animation class and `open` when fully visible */
    menuClassName: `${baseClass}${openSuffix}`,
    backdropClassName:
      variant === 'slide-panel-ltr' ? `menu-slide-panel-backdrop${openSuffix}` : undefined,
  }
}
