/**
 * Report client connectivity failures to ConnectivityProvider without importing React context
 * (used by outbound sync, fetch hooks, etc.).
 */

let onConnectivityFailure: ((cause: string) => void) | null = null

export function registerConnectivityFailureHandler(fn: ((cause: string) => void) | null): void {
  onConnectivityFailure = fn
}

export function reportConnectivityFailure(cause: string): void {
  onConnectivityFailure?.(cause)
}
