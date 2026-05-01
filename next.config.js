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
