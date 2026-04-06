'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { useAuth } from '@/providers/AuthProvider'
import { useLists } from '@/hooks/useLists'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { parseSheetCsv, resolveImportListName } from '@/lib/sheetImport/parseSheetCsv'
import type { Json } from '@/lib/supabase/types'

function ImportContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const { lists, loading: listsLoading, createList, deleteList } = useLists()
  const [sheetUrl, setSheetUrl] = useState('')
  const [nameOverride, setNameOverride] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = searchParams.get('sheet')
    if (!raw) return
    try {
      setSheetUrl(decodeURIComponent(raw))
    } catch {
      setSheetUrl(raw)
    }
  }, [searchParams])

  const ownedListNames = lists.filter(l => l.role === 'owner').map(l => l.name)

  const runImport = async () => {
    setError('')
    const url = sheetUrl.trim()
    if (!url) {
      setError('Paste your Google Sheet link.')
      return
    }
    if (!user) {
      setError('Sign in to import.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/sheet-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const payload = (await res.json()) as { csv?: string; title?: string | null; error?: string }
      if (!res.ok) {
        setError(payload.error || 'Could not download the sheet.')
        return
      }
      const csv = payload.csv
      if (typeof csv !== 'string') {
        setError('Unexpected response from server.')
        return
      }

      const parsed = parseSheetCsv(csv)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }

      const override = nameOverride.trim()
      const listName = override || resolveImportListName(payload.title ?? null, ownedListNames)

      const { data: newList, error: createErr } = await createList(listName)
      if (createErr || !newList?.id) {
        setError(createErr?.message || 'Could not create list.')
        return
      }

      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('import_list_items', {
        p_list_id: newList.id,
        p_rows: parsed.rows as unknown as Json,
      })

      if (rpcError) {
        await deleteList(newList.id)
        setError(rpcError.message || 'Import failed; the new list was removed.')
        return
      }

      router.push(`/list/${newList.id}`)
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || (user && listsLoading)) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <Image src="/logo.png" alt="MyFamiList" width={256} height={64} className="h-12 sm:h-16 w-auto" priority />
        </div>
        <p className="text-center text-gray-600 mb-6">Sign in from the home page to import a Google Sheet.</p>
        <div className="flex justify-center">
          <Link href="/" className="text-teal font-medium hover:underline">
            Back to lists
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg w-full sm:w-[450px] max-w-4xl min-h-screen sm:min-h-0 px-4 pb-4 pt-6 sm:p-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="text-sm text-teal font-medium hover:underline">
          ← Back
        </Link>
        <Image src="/logo.png" alt="MyFamiList" width={180} height={48} className="h-10 w-auto" />
        <span className="w-12" aria-hidden />
      </div>

      <div>
        <h1 className="text-lg font-semibold text-gray-900">Import from Google Sheet</h1>
        <p className="text-sm text-gray-500 mt-1">
          First row must include an <strong>Items</strong> column. Optional: <strong>archived</strong>,{' '}
          <strong>comments</strong>, <strong>category</strong>. Share the sheet so anyone with the link can view.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="sheet-url" className="text-sm font-medium text-gray-700">
          Sheet URL
        </label>
        <textarea
          id="sheet-url"
          value={sheetUrl}
          onChange={e => setSheetUrl(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent"
          placeholder="https://docs.google.com/spreadsheets/d/…"
          disabled={busy}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="list-name-override" className="text-sm font-medium text-gray-700">
          List name (optional)
        </label>
        <Input
          id="list-name-override"
          value={nameOverride}
          onChange={e => setNameOverride(e.target.value)}
          placeholder="Uses sheet title or Import / Import 2… if empty"
          disabled={busy}
        />
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}

      <Button type="button" className="w-full bg-red-500 hover:bg-red-600" loading={busy} onClick={() => void runImport()}>
        Import
      </Button>
    </div>
  )
}

function ImportFallback() {
  return (
    <div className="bg-white rounded-none sm:rounded-xl shadow-none sm:shadow-lg p-8 w-full sm:min-w-[300px] min-h-screen sm:min-h-0 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal" />
    </div>
  )
}

export default function ImportPage() {
  return (
    <Suspense fallback={<ImportFallback />}>
      <ImportContent />
    </Suspense>
  )
}
