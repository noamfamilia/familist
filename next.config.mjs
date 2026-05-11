import withSerwistInit from '@serwist/next'
import pkg from './package.json' with { type: 'json' }

const isProdBuild = process.env.NODE_ENV === 'production'
const isPwaDisabledByEnv = process.env.DISABLE_PWA === 'true'
const isPwaEnabled = isProdBuild && !isPwaDisabledByEnv
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.npm_package_version ||
  'local'

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: !isPwaEnabled,
  /** Root HTML shell revision bumps when deploy changes; merged with webpack precache manifest. */
  additionalPrecacheEntries: [{ url: '/', revision: buildId }],
  /**
   * Serwist default is 2 MiB (`maximumFileSizeToCacheInBytes` in @serwist/build). Assets over the
   * limit are omitted from **precache** (install-time) and only appear after a visit via runtime
   * caches. Keep this high enough that heavy App Router chunks (e.g. `app/list/[id]/page-*.js`)
   * stay in the precache manifest.
   */
  maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_PWA_ENABLED: isPwaEnabled ? 'true' : 'false',
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default withSerwist(nextConfig)
