import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'Surrogate-Control': 'no-store',
} as const

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const flightId = searchParams.get('flightId')?.trim()
  if (!flightId) {
    return NextResponse.json(
      { ok: false, error: 'flightId required' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const ts = Date.now()
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { ok: false, flightId, ts, auth: false },
        { status: 401, headers: NO_STORE_HEADERS },
      )
    }

    return NextResponse.json({ ok: true, flightId, ts, auth: true }, {
      status: 200,
      headers: NO_STORE_HEADERS,
    })
  } catch {
    return NextResponse.json(
      { ok: false, flightId, ts, error: 'server_error' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
