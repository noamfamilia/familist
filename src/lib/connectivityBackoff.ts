/** Backoff delays (ms) for lightweight manifest probes while offline or recovering. */
export const CONNECTIVITY_PROBE_BACKOFF_MS = [5000, 10_000, 20_000, 30_000, 60_000] as const

export function connectivityProbeDelayForStep(step: number): number {
  const i = Math.min(Math.max(0, step), CONNECTIVITY_PROBE_BACKOFF_MS.length - 1)
  return CONNECTIVITY_PROBE_BACKOFF_MS[i]
}
