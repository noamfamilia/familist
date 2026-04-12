'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextType {
  toasts: Toast[]
  showToast: (message: string, type?: ToastType) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts(prev => {
      const next = [...prev, { id, message, type }]
      return next.length > 2 ? next.slice(-2) : next
    })

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const success = useCallback((message: string) => showToast(message, 'success'), [showToast])
  const error = useCallback((message: string) => showToast(message, 'error'), [showToast])
  const warning = useCallback((message: string) => showToast(message, 'warning'), [showToast])
  const info = useCallback((message: string) => showToast(message, 'info'), [showToast])

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ toasts, showToast, success, error, warning, info }}>
      {children}
      
      {/* Toast container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setIsVisible(true))
  }, [])

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  }

  const colors = {
    success: 'border-l-green-500 text-green-600',
    error: 'border-l-red-500 text-red-600',
    warning: 'border-l-yellow-500 text-yellow-600',
    info: 'border-l-blue-500 text-blue-600',
  }

  return (
    <div
      className={`
        pointer-events-auto flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 rounded-lg shadow-lg dark:shadow-slate-900/50
        border-l-4 ${colors[toast.type]} max-w-[350px]
        transition-transform duration-300 ease-out
        ${isVisible ? 'translate-x-0' : 'translate-x-[120%]'}
      `}
    >
      <span className="text-lg flex-shrink-0">{icons[toast.type]}</span>
      <span className="flex-1 text-sm text-gray-700 dark:text-gray-200">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
