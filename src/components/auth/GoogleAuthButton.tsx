'use client'

import { forwardRef } from 'react'
import { GoogleGIcon } from '@/components/auth/GoogleGIcon'

type GoogleAuthButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  flow: 'signIn' | 'signUp'
  loading?: boolean
}

const labelForFlow = {
  signIn: 'Sign in with Google',
  signUp: 'Sign up with Google',
} as const

export const GoogleAuthButton = forwardRef<HTMLButtonElement, GoogleAuthButtonProps>(
  ({ flow, loading, disabled, className = '', ...props }, ref) => {
    const label = labelForFlow[flow]

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        aria-label={label}
        className={[
          'relative w-full inline-flex items-center justify-center gap-3',
          'rounded-full border border-[#747775] bg-white px-4 py-2.5',
          'text-sm font-medium text-[#1f1f1f]',
          'transition-colors duration-200',
          'hover:bg-[#f8f9fa] active:bg-[#f1f3f4]',
          'disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-white',
          'dark:border-neutral-500 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white',
          className,
        ].join(' ')}
        {...props}
      >
        <span className={loading ? 'invisible' : 'inline-flex items-center justify-center gap-3'}>
          <GoogleGIcon className="h-5 w-5 shrink-0" />
          <span>{label}</span>
        </span>
        {loading ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <svg className="h-5 w-5 animate-spin text-[#1f1f1f]" viewBox="0 0 24 24" aria-hidden>
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        ) : null}
      </button>
    )
  },
)

GoogleAuthButton.displayName = 'GoogleAuthButton'
