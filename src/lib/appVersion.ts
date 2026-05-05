'use client'

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'

export type ParsedSemver = {
  major: number
  minor: number
  patch: number
}

export function parseSemver(version: string): ParsedSemver {
  const [majorRaw, minorRaw, patchRaw] = String(version).trim().split('.')
  const major = Number.parseInt(majorRaw ?? '0', 10)
  const minor = Number.parseInt(minorRaw ?? '0', 10)
  const patch = Number.parseInt(patchRaw ?? '0', 10)
  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  }
}

export function compareMajors(storedVersion: string | null | undefined, currentVersion: string): number {
  const storedMajor = parseSemver(storedVersion ?? '0.0.0').major
  const currentMajor = parseSemver(currentVersion).major
  if (storedMajor === currentMajor) return 0
  return storedMajor < currentMajor ? -1 : 1
}
