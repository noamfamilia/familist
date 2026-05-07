/** Backoff delays (ms) for lightweight heartbeat probes while offline/recovering. */
export const CONNECTIVITY_PROBE_BACKOFF_MS = [5_000, 10_000, 30_000] as const

export function connectivityProbeDelayForStep(step: number): number {
  const i = Math.min(Math.max(0, step), CONNECTIVITY_PROBE_BACKOFF_MS.length - 1)
  return CONNECTIVITY_PROBE_BACKOFF_MS[i]
}
