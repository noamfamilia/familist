// PWA Configuration
const isProdBuild = process.env.NODE_ENV === 'production'
const isPwaDisabledByEnv = process.env.DISABLE_PWA === 'true'

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  scope: '/',
  sw: 'sw.js',
  disable: !isProdBuild || isPwaDisabledByEnv,
  customWorkerDir: 'worker',
  clientsClaim: true,
  /**
   * Next.js does not reliably expose `/_next/app-build-manifest.json` as a static 200 in production
   * (often 404 HTML). Workbox precache then fails install → installing → redundant.
   */
  buildExcludes: [/app-build-manifest\.json$/],
  manifestTransforms: [
    async (manifestEntries) => {
      const manifest = manifestEntries.filter(
        (m) => typeof m.url === 'string' && !m.url.includes('app-build-manifest.json'),
      )
      return { manifest, warnings: [] }
    },
  ],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.npm_package_version ||
      'local',
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = withPWA(nextConfig)
