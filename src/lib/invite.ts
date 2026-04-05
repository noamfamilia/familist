'use client'

const PENDING_INVITE_TOKEN_KEY = 'pending_invite_token'

export function buildInvitePath(token: string) {
  return `/?invite=${encodeURIComponent(token)}`
}

export function buildInviteUrl(token: string) {
  if (typeof window === 'undefined') return buildInvitePath(token)
  return `${window.location.origin}${buildInvitePath(token)}`
}

export function setPendingInviteToken(token: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(PENDING_INVITE_TOKEN_KEY, token)
}

export function getPendingInviteToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(PENDING_INVITE_TOKEN_KEY)
}

export function clearPendingInviteToken() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PENDING_INVITE_TOKEN_KEY)
}
