/**
 * Regenerate every raster brand asset from one definition.
 *
 * The mark exists three times over — as `LumenMark` in the icon set, as
 * `public/icon.svg`, and as the PNGs a launcher and an app store want. Drawing
 * the PNGs by hand is how those three drift apart, so they are drawn from the
 * geometry below instead.
 *
 *   npm run brand
 *
 * Keep GEOMETRY in step with LumenMark and public/icon.svg.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'

const INK = '#121214'
const PAPER = '#f3f2f0'
const TAU = Math.PI * 2

/** In a 24-unit box, matching the SVG. */
const GEOMETRY = { rot: -0.9, gap: 0.38, ring: 8.1, stroke: 3.3, dot: 3.0 }

/** Draws the mark into a `size`-square region at the current origin. */
function mark(ctx, size, colour) {
  const u = (n) => (n * size) / 24
  const { rot, gap, ring, stroke, dot } = GEOMETRY
  ctx.strokeStyle = colour
  ctx.fillStyle = colour
  ctx.lineCap = 'butt'
  ctx.lineWidth = u(stroke)
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath()
    ctx.arc(u(12), u(12), u(ring), (i / 3) * TAU + gap + rot, ((i + 1) / 3) * TAU - gap + rot)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(u(12), u(12), u(dot), 0, TAU)
  ctx.fill()
}

/** An app tile: ink ground, white glyph, glyph inside the maskable safe zone. */
function tile(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, size * 0.22)
  ctx.fill()
  const inset = size * 0.19
  ctx.save()
  ctx.translate(inset, inset)
  mark(ctx, size - inset * 2, '#ffffff')
  ctx.restore()
  return canvas
}

for (const size of [180, 192, 512]) {
  writeFileSync(`public/icon-${size}.png`, tile(size).toBuffer('image/png'))
}
console.log('icon-180, icon-192, icon-512')

/* ------------------------------------------------------------------ */
/* the social card                                                     */
/* ------------------------------------------------------------------ */

/**
 * 1200x630, from the generated constellation plate.
 *
 * The plate carries no type on purpose — headline and wordmark go on here, in
 * the real typeface, so the card matches the product rather than approximating
 * it. The crop keeps the plate's sparse left, which is where the type sits.
 */
const PLATE = 'docs/brand/constellation.jpg'

// Two faces, or every weight comes out bold.
for (const [path, family] of [
  ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'CardBold'],
  ['/System/Library/Fonts/Supplemental/Arial.ttf', 'CardText'],
  ['/System/Library/Fonts/Helvetica.ttc', 'CardText'],
]) {
  try {
    GlobalFonts.registerFromPath(path, family)
  } catch {
    // Fall through to whatever canvas already has.
  }
}

const W = 1200
const H = 630
const card = createCanvas(W, H)
const ctx = card.getContext('2d')
ctx.fillStyle = PAPER
ctx.fillRect(0, 0, W, H)

try {
  const plate = await loadImage(readFileSync(PLATE))
  // Cover the frame, anchored so the dense corner stays in the upper right.
  const scale = Math.max(W / plate.width, H / plate.height)
  const w = plate.width * scale
  const h = plate.height * scale
  ctx.drawImage(plate, W - w, (H - h) * 0.34, w, h)
} catch {
  console.warn(`no plate at ${PLATE} — card rendered on plain ground`)
}

// A soft wash so type on the left never fights the network behind it.
const wash = ctx.createLinearGradient(0, 0, W * 0.78, 0)
wash.addColorStop(0, 'rgba(243,242,240,1)')
wash.addColorStop(0.55, 'rgba(243,242,240,0.86)')
wash.addColorStop(1, 'rgba(243,242,240,0)')
ctx.fillStyle = wash
ctx.fillRect(0, 0, W, H)

const left = 84
ctx.save()
ctx.translate(left, 92)
ctx.fillStyle = INK
ctx.beginPath()
ctx.roundRect(0, 0, 58, 58, 16)
ctx.fill()
ctx.save()
ctx.translate(58 * 0.19, 58 * 0.19)
mark(ctx, 58 * 0.62, '#ffffff')
ctx.restore()
ctx.font = '700 31px CardBold'
ctx.fillStyle = INK
ctx.textBaseline = 'middle'
ctx.fillText('Lumen', 74, 31)
ctx.restore()

ctx.fillStyle = INK
ctx.textBaseline = 'alphabetic'
ctx.font = '700 62px CardBold'
for (const [i, line] of ['Your payments', 'should not become', 'a map of your life.'].entries()) {
  ctx.fillText(line, left, 300 + i * 74)
}

ctx.font = '400 24px CardText'
ctx.fillStyle = '#77767c'
ctx.fillText('The private account for Starknet · lumen-strk20.vercel.app', left, 556)

writeFileSync('public/og.png', card.toBuffer('image/png'))
console.log('og.png 1200x630')
