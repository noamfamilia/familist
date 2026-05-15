/** Recovery health check timeout (ConnectivityProvider recovery flight). */
export const RECOVERY_HEALTH_TIMEOUT_MS = 10_000

export type RecoveryHealthResult = 'ok' | 'connectivity_failure'

type RecoveryHealthJson = {
  flightId?: string
  ok?: boolean
}

/**
 * GET /api/recovery-health — any HTTP response with matching flightId counts as link-up.
 * Network/abort errors are connectivity failures.
 */
export async function runRecoveryHealthCheck(
  flightId: string,
  signal: AbortSignal,
): Promise<RecoveryHealthResult> {
  const url = `/api/recovery-health?flightId=${encodeURIComponent(flightId)}&ts=${Date.now()}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
    })
    let body: RecoveryHealthJson | null = null
    try {
      body = (await res.json()) as RecoveryHealthJson
    } catch {
      // Non-JSON still means we reached the server.
    }
    if (body?.flightId != null && body.flightId !== flightId) {
      return 'connectivity_failure'
    }
    return 'ok'
  } catch {
    return 'connectivity_failure'
  }
}
