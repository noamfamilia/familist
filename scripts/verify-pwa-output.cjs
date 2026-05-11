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

console.log(`[PWA VERIFY] OK: ${swPath}`)
