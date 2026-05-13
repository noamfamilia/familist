/**
 * User-facing copy for invite-link join failures (RPC / connectivity).
 */

export function formatJoinListInviteErrorForUser(message: string): string {
  const raw = message.trim()
  const lower = raw.toLowerCase()

  if (!raw) return 'Could not join this list.'

  if (lower.includes('session still loading')) return raw

  if (lower.includes('not authenticated')) {
    return 'Sign in to join this list.'
  }

  if (lower.includes('join your own list') || lower.includes('cannot join your own')) {
    return "You can't join your own list."
  }

  if (
    lower.includes('invalid') &&
    (lower.includes('token') || lower.includes('expired') || lower.includes('revoked'))
  ) {
    return "This list link isn't valid or has expired."
  }

  if (lower.includes('token is required')) {
    return "This list link isn't valid or has expired."
  }

  if (lower.includes('join did not return')) {
    return 'Could not join this list. Try again.'
  }

  return raw
}
