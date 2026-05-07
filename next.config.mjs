import withSerwistInit from '@serwist/next'
import pkg from './package.json' with { type: 'json' }

const isProdBuild = process.env.NODE_ENV === 'production'
const isPwaDisabledByEnv = process.env.DISABLE_PWA === 'true'
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.npm_package_version ||
  'local'

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: !isProdBuild || isPwaDisabledByEnv,
  additionalPrecacheEntries: [{ url: '/', revision: buildId }],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default withSerwist(nextConfig)
