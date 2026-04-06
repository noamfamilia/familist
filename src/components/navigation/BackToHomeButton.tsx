'use client'

import { useRouter } from 'next/navigation'
import { navigateBackToHome } from '@/lib/navigation/backToHome'

interface BackToHomeButtonProps {
  className?: string
  children?: React.ReactNode
}

export function BackToHomeButton({ className, children = '← Back' }: BackToHomeButtonProps) {
  const router = useRouter()
  return (
    <button type="button" className={className} onClick={() => navigateBackToHome(router)}>
      {children}
    </button>
  )
}
