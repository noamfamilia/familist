import { useEffect, useState } from 'react'

/** Matches `.menu` / `.menu-slide-ltr` transition duration in globals.css */
export const MENU_OPEN_ANIMATION_MS = 300

export type MenuOpenAnimationVariant = 'dropdown' | 'slide-ltr'

/**
 * Mount/unmount timing for animated menus (opacity + translate).
 * Open: mount → add `open` on next frames. Close: remove `open` → unmount after transition.
 */
export function useMenuOpenAnimation(isOpen: boolean, variant: MenuOpenAnimationVariant = 'dropdown') {
  const [mounted, setMounted] = useState(isOpen)
  const [openClass, setOpenClass] = useState(false)
  const baseClass = variant === 'slide-ltr' ? 'menu-slide-ltr' : 'menu'

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
    const t = window.setTimeout(() => setMounted(false), MENU_OPEN_ANIMATION_MS)
    return () => window.clearTimeout(t)
  }, [isOpen])

  return {
    mounted,
    /** Includes base animation class and `open` when fully visible */
    menuClassName: `${baseClass}${openClass ? ' open' : ''}`,
  }
}
