'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { ListDetailView } from '@/components/lists/ListDetailView'

function ListDetailFallback() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center p-8">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-teal" aria-hidden />
    </div>
  )
}

function ListRouteBody() {
  const params = useParams()
  const listId = params.id as string
  return <ListDetailView listId={listId} surface="page" />
}

export default function ListPage() {
  return (
    <Suspense fallback={<ListDetailFallback />}>
      <ListRouteBody />
    </Suspense>
  )
}
