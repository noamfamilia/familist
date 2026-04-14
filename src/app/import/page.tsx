'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'

function ImportRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const sheet = searchParams.get('sheet')
    router.replace(sheet ? `/?sheet=${encodeURIComponent(sheet)}` : '/')
  }, [router, searchParams])
  return null
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <ImportRedirect />
    </Suspense>
  )
}
