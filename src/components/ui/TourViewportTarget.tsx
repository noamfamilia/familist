'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHasMounted } from '@/hooks/useHasMounted'

type Box = {
  top: number
  left: number
  width: number
  height: number
}

type TourViewportTargetProps = {
  /** Value for `data-tour` on the fixed viewport mirror (Joyride target). */
  target: string
  className?: string
  children: React.ReactNode
}

/**
 * Renders a fixed-position mirror on document.body at the source element's viewport
 * rect. Joyride can target the mirror while the real control stays inside nested
 * fixed/scroll/sticky layouts.
 */
export function TourViewportTarget({ target, className, children }: TourViewportTargetProps) {
  const hasMounted = useHasMounted()
  const sourceRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const lastBoxKeyRef = useRef('')

  useLayoutEffect(() => {
    const sync = () => {
      const el = sourceRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const nextBox: Box = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
      const boxKey = `${nextBox.top}|${nextBox.left}|${nextBox.width}|${nextBox.height}`

      setBox(prev => {
        if (
          prev &&
          prev.top === nextBox.top &&
          prev.left === nextBox.left &&
          prev.width === nextBox.width &&
          prev.height === nextBox.height
        ) {
          return prev
        }
        return nextBox
      })

      if (boxKey !== lastBoxKeyRef.current) {
        lastBoxKeyRef.current = boxKey
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'))
        })
      }
    }

    sync()
    const ro = new ResizeObserver(sync)
    const el = sourceRef.current
    if (el) ro.observe(el)

    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [])

  return (
    <>
      <div ref={sourceRef} className={className}>
        {children}
      </div>
      {hasMounted && box
        ? createPortal(
            <div
              data-tour={target}
              style={{
                position: 'fixed',
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                pointerEvents: 'none',
              }}
              aria-hidden
            />,
            document.body,
          )
        : null}
    </>
  )
}
