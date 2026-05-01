// PWA Configuration
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  scope: '/',
  disable: process.env.NODE_ENV === 'development',
  customWorkerDir: 'worker',
  workboxOptions: {
    clientsClaim: true,
    skipWaiting: true,
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
}

module.exports = withPWA(nextConfig)
