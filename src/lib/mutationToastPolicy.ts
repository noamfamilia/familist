import { isLikelyConnectivityError } from '@/lib/connectivityErrors'
import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

/** Same string as ConnectivityProvider blocked mutations. */
export const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'

/** Returned when `status === 'recovering'`; mutations blocked until a canonical fetch succeeds. */
export const RECOVERING_MUTATIONS_DISABLED_MSG = 'Reconnecting — try again shortly.'

/**
 * When false, skip error toast — connectivity UI (wifi) already reflects offline / wait state.
 */
export function shouldShowConnectivityRelatedMutationToast(message: string | undefined): boolean {
  if (!message) return true
  if (message === OFFLINE_ACTIONS_DISABLED_MSG) return false
  if (message === RECOVERING_MUTATIONS_DISABLED_MSG) return false
  if (message === 'Syncing with server ...') return false
  if (message === USER_MUTATION_WAIT_MSG) return false
  if (isLikelyConnectivityError(message)) return false
  const m = message.toLowerCase()
  if (m.includes('failed to fetch') || m.includes('fetch failed') || m.includes('load failed')) {
    return false
  }
  return true
}
