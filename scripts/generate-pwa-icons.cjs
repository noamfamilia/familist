/**
 * Writes solid-color maskable-safe PNGs for PWA (no extra deps).
 * Theme teal #2aa198 — matches manifest theme_color.
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const R = 0x2a
const G = 0xa1
const B = 0x98
const A = 0xff

function crc32Table() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xed_b8_83_20 ^ (c >>> 1)) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
}

const CRC_TABLE = crc32Table()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(typeStr, data) {
  const type = Buffer.from(typeStr, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crcIn = Buffer.concat([type, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcIn), 0)
  return Buffer.concat([len, type, data, crc])
}

function buildRgbaScanlines(width, height) {
  const rowBytes = 1 + width * 4
  const raw = Buffer.alloc(rowBytes * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      raw[o++] = R
      raw[o++] = G
      raw[o++] = B
      raw[o++] = A
    }
  }
  return raw
}

function encodePng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = buildRgbaScanlines(width, height)
  const idat = zlib.deflateSync(raw, { level: 9 })
  const parts = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]
  return Buffer.concat(parts)
}

const root = path.join(__dirname, '..')
const pub = path.join(root, 'public')
fs.mkdirSync(pub, { recursive: true })
for (const size of [192, 512]) {
  const out = path.join(pub, `icon-${size}.png`)
  fs.writeFileSync(out, encodePng(size, size))
  console.log(`[generate-pwa-icons] wrote ${out}`)
}
