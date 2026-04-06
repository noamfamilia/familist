import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_CSV_BYTES = 2 * 1024 * 1024
const ALLOWED_HOSTS = new Set(['docs.google.com', 'drive.google.com'])

const SPREADSHEET_ID_RE = /^[a-zA-Z0-9-_]+$/

function parseSpreadsheetUrl(urlStr: string): { id: string; gid: string } | null {
  try {
    const u = new URL(urlStr)
    if (!ALLOWED_HOSTS.has(u.hostname)) return null

    const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (m) {
      const gid = u.searchParams.get('gid') || '0'
      return { id: m[1], gid }
    }

    if (u.hostname === 'drive.google.com' && u.pathname === '/open') {
      const id = u.searchParams.get('id')
      if (id && SPREADSHEET_ID_RE.test(id)) {
        const gid = u.searchParams.get('gid') || '0'
        return { id, gid }
      }
    }

    return null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  const parsed = parseSpreadsheetUrl(url)
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Use a Google Sheets link (e.g. docs.google.com/spreadsheets/d/…/edit or drive.google.com/open?id=…).',
      },
      { status: 400 }
    )
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${encodeURIComponent(parsed.gid)}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)

  let res: Response
  try {
    res = await fetch(csvUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'FamilistSheetImport/1.0' },
    })
  } catch (e) {
    clearTimeout(timeout)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return NextResponse.json(
      { error: aborted ? 'Download timed out' : 'Failed to reach Google Sheets' },
      { status: 502 }
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    return NextResponse.json(
      {
        error: `Could not export CSV (HTTP ${res.status}). Share the spreadsheet so anyone with the link can view, then try again.`,
      },
      { status: 502 }
    )
  }

  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'Sheet is too large (max 2 MB CSV).' }, { status: 400 })
  }

  const csv = new TextDecoder('utf-8', { fatal: false }).decode(buf)

  let title: string | null = null
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY
  if (apiKey) {
    try {
      const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parsed.id)}?fields=properties.title&key=${encodeURIComponent(apiKey)}`
      const metaController = new AbortController()
      const metaT = setTimeout(() => metaController.abort(), 8000)
      const metaRes = await fetch(metaUrl, { signal: metaController.signal })
      clearTimeout(metaT)
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as { properties?: { title?: string } }
        const t = meta.properties?.title?.trim()
        title = t || null
      }
    } catch {
      /* optional title */
    }
  }

  if (!title) {
    title = await fetchSpreadsheetTitleFromDocsPage(parsed.id)
  }

  return NextResponse.json({ csv, title })
}

const MAX_HTML_SNIPPET_BYTES = 600_000

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** Best-effort title from the public /edit HTML (og:title or <title>), no API key required. */
function extractSpreadsheetTitleFromHtml(html: string): string | null {
  const head = html.slice(0, MAX_HTML_SNIPPET_BYTES)

  const ogPatterns = [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i,
    /<meta\s+content=["']([^"']*)["']\s+property=["']og:title["']/i,
    /<meta\s+itemprop=["']name["']\s+content=["']([^"']*)["']/i,
  ]
  for (const re of ogPatterns) {
    const m = head.match(re)
    if (m?.[1]) {
      const t = decodeBasicHtmlEntities(m[1]).trim()
      if (t && !isGenericRejectedTitle(t)) return t
    }
  }

  const titleMatch = head.match(/<title[^>]*>([^<]{1,500})<\/title>/i)
  if (titleMatch?.[1]) {
    let t = decodeBasicHtmlEntities(titleMatch[1]).trim()
    t = t.replace(/\s*-\s*Google Sheets\s*$/i, '').replace(/\s*-\s*Google Drive\s*$/i, '').trim()
    if (t && !isGenericRejectedTitle(t)) return t
  }

  return null
}

function isGenericRejectedTitle(t: string): boolean {
  const lower = t.toLowerCase()
  if (lower === 'google sheets' || lower === 'sign in' || lower.includes('sign in to continue')) return true
  return false
}

async function fetchSpreadsheetTitleFromDocsPage(spreadsheetId: string): Promise<string | null> {
  const pageUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
  const metaController = new AbortController()
  const metaT = setTimeout(() => metaController.abort(), 10_000)
  try {
    const pageRes = await fetch(pageUrl, {
      signal: metaController.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'FamilistSheetImport/1.0' },
    })
    if (!pageRes.ok) return null

    const buf = await pageRes.arrayBuffer()
    const n = Math.min(buf.byteLength, MAX_HTML_SNIPPET_BYTES)
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, n))
    return extractSpreadsheetTitleFromHtml(html)
  } catch {
    return null
  } finally {
    clearTimeout(metaT)
  }
}
