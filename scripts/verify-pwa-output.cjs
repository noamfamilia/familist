const fs = require('fs')
const path = require('path')

function fail(message) {
  console.error(`[PWA VERIFY] ${message}`)
  process.exit(1)
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} is missing: ${filePath}`)
  }
}

const projectRoot = process.cwd()
const swPath = path.join(projectRoot, 'public', 'sw.js')
ensureFileExists(swPath, 'Service worker file')
ensureFileExists(path.join(projectRoot, 'public', 'icon-192.png'), 'PWA icon-192')
ensureFileExists(path.join(projectRoot, 'public', 'icon-512.png'), 'PWA icon-512')

const swContent = fs.readFileSync(swPath, 'utf8')
if (!swContent || swContent.trim().length === 0) {
  fail('Service worker file is empty')
}

const looksLikeJs = /self\b|workbox|importScripts|addEventListener/.test(swContent)
if (!looksLikeJs) {
  fail('Service worker file does not look like JavaScript output')
}

/** App Router encodes `[id]` as %5Bid%5D in chunk paths emitted into the precache manifest. */
const hasListDetailPageChunk =
  swContent.includes('/_next/static/chunks/app/list/%5Bid%5D/page-') ||
  swContent.includes('/_next/static/chunks/app/list/[id]/page-')
if (!hasListDetailPageChunk) {
  fail(
    'Precache manifest must include the list detail route chunk (/_next/static/chunks/app/list/%5Bid%5D/page-*.js). ' +
      'If this fails after a Next upgrade, update this check or adjust Serwist include/exclude.',
  )
}

if (!/\/_next\/static\/css\/[^'"\s]+\.css/.test(swContent)) {
  fail(
    'Precache manifest must include at least one global CSS bundle (/_next/static/css/*.css). ' +
      'List layout styles are part of that graph; missing CSS usually means precache generation regressed.',
  )
}

console.log(`[PWA VERIFY] OK: ${swPath}`)
