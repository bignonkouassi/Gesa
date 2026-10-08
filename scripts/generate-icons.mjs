/**
 * Génère les icônes PWA (public/icon-192.png, public/icon-512.png)
 * sans aucune dépendance : encodeur PNG minimal (zlib natif) +
 * police bitmap 5×7 pour les lettres « MB ».
 * Usage : node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/* ----- CRC32 (table standard) ----- */
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/* ----- Police bitmap 5×7 ----- */
const FONT = {
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
}

/** Icône : carré arrondi émeraude + « MB » blanc en pixels */
function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4)
  const radius = Math.round(size * 0.18)
  const bg = [5, 150, 105] // #059669
  const fg = [255, 255, 255]

  const inRounded = (x, y) => {
    const dx = x < radius ? radius - x : x > size - 1 - radius ? x - (size - 1 - radius) : 0
    const dy = y < radius ? radius - y : y > size - 1 - radius ? y - (size - 1 - radius) : 0
    return dx * dx + dy * dy <= radius * radius
  }

  // Lettres centrées : 2 glyphes de 5×7 + 1 colonne d'espace = 11 colonnes
  const cell = Math.max(2, Math.floor(size / 16))
  const textW = 11 * cell
  const textH = 7 * cell
  const x0 = Math.floor((size - textW) / 2)
  const y0 = Math.floor((size - textH) / 2)
  const glyph = (ch, gx) => {
    const rows = FONT[ch]
    return (px2, py2) => {
      const col = px2 - gx
      const row = py2
      if (col < 0 || col > 4 || row < 0 || row > 6) return false
      return rows[row][col] === '1'
    }
  }
  const m = glyph('M', 0)
  const b = glyph('B', 6)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRounded(x, y)) {
        px[i + 3] = 0 // coins transparents
        continue
      }
      const tx = Math.floor((x - x0) / cell)
      const ty = Math.floor((y - y0) / cell)
      const on = x >= x0 && y >= y0 && (m(tx, ty) || b(tx, ty))
      const c = on ? fg : bg
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
      px[i + 3] = 255
    }
  }
  return px
}

function toPng(size, rgba) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    const ro = y * (1 + size * 4)
    raw[ro] = 0 // filtre « none »
    rgba.copy(raw, ro + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = join(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })
for (const size of [192, 512]) {
  const png = toPng(size, makeIcon(size))
  const file = join(outDir, `icon-${size}.png`)
  writeFileSync(file, png)
  console.log(`${file} — ${png.length} octets`)
}
