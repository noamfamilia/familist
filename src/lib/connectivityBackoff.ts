/** Backoff delays (ms) between reachability probes while offline (after post-online fast probe). */
export const CONNECTIVITY_PROBE_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000] as const

/** After `window` `online` or tab visible while offline — delay before first probe. */
export const POST_ONLINE_PROBE_DELAY_MS = 500

export const MAX_PROBE_BACKOFF_STEP = CONNECTIVITY_PROBE_BACKOFF_MS.length - 1

export function connectivityProbeDelayForStep(step: number): number {
  const i = Math.min(Math.max(0, step), MAX_PROBE_BACKOFF_STEP)
  return CONNECTIVITY_PROBE_BACKOFF_MS[i]
}
