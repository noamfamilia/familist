'use client'

import { useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
  manageHistory?: boolean
  hideClose?: boolean
  contentClassName?: string
  /** Edge-to-edge on small screens; touch scroll inside, scrollbars hidden */
  fullScreenMobile?: boolean
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  manageHistory = true,
  hideClose = false,
  contentClassName = '',
  fullScreenMobile = false,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const historyPushedRef = useRef(false)
  onCloseRef.current = onClose

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
      }
    }

    const handlePopState = () => {
      if (historyPushedRef.current) {
        historyPushedRef.current = false
        onCloseRef.current()
      }
    }

    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement

      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'

      if (manageHistory && !historyPushedRef.current) {
        window.history.pushState({ modal: true }, '')
        historyPushedRef.current = true
      }
      if (manageHistory) {
        window.addEventListener('popstate', handlePopState)
      }

      setTimeout(() => modalRef.current?.focus(), 0)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      if (manageHistory) {
        window.removeEventListener('popstate', handlePopState)
      }
      document.body.style.overflow = ''

      if (manageHistory && historyPushedRef.current) {
        historyPushedRef.current = false
        window.history.back()
      }

      if (previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen, manageHistory])

  if (!isOpen) return null

  const sizeClasses = {
    xs: 'max-w-[240px] !px-4 !pt-6 !pb-4',
    sm: 'max-w-xs',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }

  const closeBtnClass =
    size === 'xs'
      ? 'absolute top-1 right-1 z-20'
      : 'absolute top-3 right-3 z-20 sm:top-4 sm:right-4'

  const titleBlock =
    title && (
      <h2 id="modal-title" className="text-xl font-semibold text-center mb-6 max-sm:mb-4">
        {title}
      </h2>
    )

  const closeBtn = !hideClose && (
    <button
      type="button"
      onClick={onClose}
      className={`${closeBtnClass} text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none p-1 rounded hover:bg-gray-100 dark:hover:bg-neutral-700`}
      aria-label="Close modal"
    >
      &times;
    </button>
  )

  const panelClass = fullScreenMobile
    ? `relative mx-auto w-full bg-white dark:bg-neutral-950 shadow-lg dark:shadow-black/40 outline-none animate-in fade-in zoom-in-95 duration-200 max-sm:fixed max-sm:inset-0 max-sm:m-0 max-sm:flex max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:max-w-none max-sm:flex-col max-sm:overflow-hidden max-sm:rounded-none max-sm:p-0 sm:relative sm:mx-auto sm:my-4 sm:max-h-[calc(100vh-2rem)] sm:overflow-y-auto sm:rounded-xl sm:p-6 sm:p-8 sm:shadow-lg ${sizeClasses[size]} ${contentClassName}`
    : `relative mx-auto my-4 bg-white dark:bg-neutral-950 rounded-xl shadow-lg dark:shadow-black/40 p-6 sm:p-8 w-full max-h-[calc(100vh-2rem)] overflow-y-auto outline-none ${sizeClasses[size]} animate-in fade-in zoom-in-95 duration-200 ${contentClassName}`

  const inner = (
    <>
      {titleBlock}
      {children}
    </>
  )

  return (
    <div
      className={`fixed inset-0 z-50 ${fullScreenMobile ? 'max-sm:overflow-hidden max-sm:p-0' : 'overflow-y-auto p-4'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        onClick={onClose}
        aria-hidden="true"
      />

      <div ref={modalRef} tabIndex={-1} className={panelClass}>
        {closeBtn}
        {fullScreenMobile ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-sm:min-h-0 sm:contents">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:px-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:pt-14 sm:contents">
              {inner}
            </div>
          </div>
        ) : (
          inner
        )}
      </div>
    </div>
  )
}
