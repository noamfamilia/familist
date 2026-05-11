/**
 * Human-readable server / PostgREST / RPC errors for toasts (message, details, hint, code).
 */

export function formatServerErrorForUser(err: unknown): string {
  if (err == null || err === false) return ''
  if (typeof err === 'string') return err.trim()
  if (err instanceof Error) return (err.message || err.name || 'Error').trim()

  if (typeof err === 'object') {
    const o = err as Record<string, unknown>
    const parts: string[] = []
    const msg = typeof o.message === 'string' ? o.message.trim() : ''
    if (msg) parts.push(msg)
    const details = typeof o.details === 'string' ? o.details.trim() : ''
    if (details && details !== msg) parts.push(details)
    const hint = typeof o.hint === 'string' ? o.hint.trim() : ''
    if (hint) parts.push(`Hint: ${hint}`)
    const code = typeof o.code === 'string' ? o.code.trim() : ''
    if (code) parts.push(`Code: ${code}`)
    if (parts.length > 0) return parts.join('\n')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }

  return String(err).trim()
}
