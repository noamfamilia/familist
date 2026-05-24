/**
 * Resize + compress UI assets in public/ to ~2× display size.
 * Run: npm run optimize:assets
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pub = path.join(__dirname, '..', 'public')

/** @type {Array<{ file: string; width?: number; height?: number; fit?: keyof sharp.FitEnum }>} */
const TARGETS = [
  { file: 'logo.png', width: 416 },
  { file: 'logo_dark_trans.png', width: 416 },
  { file: 'profile.png', width: 192, height: 192, fit: 'inside' },
  { file: 'profile_dark_trans.png', width: 192, height: 192, fit: 'inside' },
  { file: 'share.png', width: 200 },
  { file: 'share_dark_trans.png', width: 200 },
]

const REMOVE_UNUSED = ['logo_dark.png', 'profile_dark.png', 'share_dark.png', 'denote.jpg']

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

async function optimizeOne({ file, width, height, fit = 'inside' }) {
  const filePath = path.join(pub, file)
  if (!fs.existsSync(filePath)) {
    console.warn(`[optimize-public-images] skip missing ${file}`)
    return
  }

  const before = fs.statSync(filePath).size
  const tmpPath = `${filePath}.opt.tmp`

  let pipeline = sharp(filePath)
  if (width || height) {
    pipeline = pipeline.resize({
      width,
      height,
      fit,
      withoutEnlargement: true,
    })
  }

  await pipeline
    .png({
      compressionLevel: 9,
      effort: 10,
      palette: false,
    })
    .toFile(tmpPath)

  fs.renameSync(tmpPath, filePath)
  const after = fs.statSync(filePath).size
  const meta = await sharp(filePath).metadata()
  console.log(
    `[optimize-public-images] ${file}: ${kb(before)} → ${kb(after)} (${meta.width}×${meta.height})`,
  )
}

async function optimizeOgImage() {
  const pngPath = path.join(pub, 'og-image.png')
  const jpgPath = path.join(pub, 'og-image.jpg')
  if (!fs.existsSync(pngPath)) return

  const before = fs.statSync(pngPath).size
  const tmpPath = `${jpgPath}.opt.tmp`
  await sharp(pngPath)
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(tmpPath)
  fs.renameSync(tmpPath, jpgPath)
  fs.unlinkSync(pngPath)
  const after = fs.statSync(jpgPath).size
  console.log(`[optimize-public-images] og-image.jpg: ${kb(before)} png → ${kb(after)} jpeg`)
}

async function main() {
  for (const target of TARGETS) {
    await optimizeOne(target)
  }

  await optimizeOgImage()

  for (const file of REMOVE_UNUSED) {
    const filePath = path.join(pub, file)
    if (!fs.existsSync(filePath)) continue
    const size = fs.statSync(filePath).size
    fs.unlinkSync(filePath)
    console.log(`[optimize-public-images] removed unused ${file} (${kb(size)})`)
  }
}

main().catch((err) => {
  console.error('[optimize-public-images] failed:', err)
  process.exit(1)
})
