import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

/** Same string as ConnectivityProvider blocked mutations. */
export const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'

/**
 * When false, skip error toast — connectivity UI (wifi) already reflects offline / wait state.
 */
export function shouldShowConnectivityRelatedMutationToast(message: string | undefined): boolean {
  if (!message) return true
  if (message === OFFLINE_ACTIONS_DISABLED_MSG) return false
  if (message === 'Syncing with server ...') return false
  if (message === USER_MUTATION_WAIT_MSG) return false
  return true
}
