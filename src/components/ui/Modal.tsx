'use client'

import { useEffect, useRef } from 'react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
  manageHistory?: boolean
}

export function Modal({ isOpen, onClose, title, children, size = 'md', manageHistory = true }: ModalProps) {
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
      // Store current focus
      previousFocusRef.current = document.activeElement as HTMLElement
      
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
      
      // Push state for back button handling
      if (manageHistory && !historyPushedRef.current) {
        window.history.pushState({ modal: true }, '')
        historyPushedRef.current = true
      }
      if (manageHistory) {
        window.addEventListener('popstate', handlePopState)
      }
      
      // Focus the modal
      setTimeout(() => modalRef.current?.focus(), 0)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      if (manageHistory) {
        window.removeEventListener('popstate', handlePopState)
      }
      document.body.style.overflow = ''
      
      // If modal closes normally (not via back button), clean up history
      if (manageHistory && historyPushedRef.current) {
        historyPushedRef.current = false
        window.history.back()
      }
      
      // Restore focus
      if (previousFocusRef.current) {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen, manageHistory])

  if (!isOpen) return null

  const sizeClasses = {
    xs: 'max-w-[240px]',
    sm: 'max-w-xs',
    md: 'max-w-md',
    lg: 'max-w-lg',
  }

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal content */}
      <div 
        ref={modalRef}
        tabIndex={-1}
        className={`relative mx-auto my-4 bg-white rounded-xl shadow-xl p-6 sm:p-8 w-full max-h-[calc(100vh-2rem)] overflow-y-auto ${sizeClasses[size]} animate-in fade-in zoom-in-95 duration-200`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none p-1 rounded hover:bg-gray-100"
          aria-label="Close modal"
        >
          &times;
        </button>

        {/* Title */}
        {title && (
          <h2 id="modal-title" className="text-xl font-semibold text-center mb-6">{title}</h2>
        )}

        {children}
      </div>
    </div>
  )
}
