/**
 * Reentrant mutex for one logical user mutation per hook instance.
 * - First top-level caller acquires the root lock.
 * - Nested calls (same stack, e.g. createTargets → updateMemberFilter) increment depth only.
 * - Parallel work (Promise.all) stays inside one gated async function — root stays held until await completes.
 */
export const USER_MUTATION_WAIT_MSG =
  'Please wait — still saving your previous change.'

export function createUserMutationGate(warn: (message: string) => void) {
  let nestDepth = 0
  let rootBusy = false

  const tryBegin = (): boolean => {
    if (nestDepth > 0) {
      nestDepth++
      return true
    }
    if (rootBusy) {
      warn(USER_MUTATION_WAIT_MSG)
      return false
    }
    rootBusy = true
    nestDepth = 1
    return true
  }

  const end = () => {
    nestDepth--
    if (nestDepth <= 0) {
      nestDepth = 0
      rootBusy = false
    }
  }

  return { tryBegin, end }
}
