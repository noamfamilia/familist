import { USER_MUTATION_WAIT_MSG } from '@/lib/userMutationGate'

/** Same string as ConnectivityProvider blocked mutations. */
export const OFFLINE_ACTIONS_DISABLED_MSG = 'Offline (actions disabled)'

/** Returned when `status === 'recovering'`; mutations blocked until a canonical fetch succeeds. */
export const RECOVERING_MUTATIONS_DISABLED_MSG = 'Reconnecting — try again shortly.'

/** Block a single action that targets an optimistic temp id (does not change global connectivity). */
export const STILL_SAVING_TEMP_ENTITY_MSG = 'Still saving this item. Try again in a moment.'

/**
 * When false, skip error toast — connectivity UI (wifi) already reflects offline / wait state.
 */
export function shouldShowConnectivityRelatedMutationToast(message: string | undefined): boolean {
  if (!message) return true
  if (message === OFFLINE_ACTIONS_DISABLED_MSG) return false
  if (message === RECOVERING_MUTATIONS_DISABLED_MSG) return false
  if (message === STILL_SAVING_TEMP_ENTITY_MSG) return false
  if (message === 'Syncing with server ...') return false
  if (message === USER_MUTATION_WAIT_MSG) return false
  return true
}
