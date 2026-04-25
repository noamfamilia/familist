'use client'

import { forwardRef, useState } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, type, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={isPassword && showPassword ? 'text' : type}
            className={`w-full px-4 py-3 border border-gray-200 dark:border-neutral-600 rounded-lg text-base text-primary dark:text-gray-100 dark:bg-neutral-900 transition-all duration-200 focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20 ${error ? 'border-red-500' : ''} ${className}`}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          )}
        </div>
        {error && (
          <span className="text-sm text-red-500">{error}</span>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
