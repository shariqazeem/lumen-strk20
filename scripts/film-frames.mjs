/**
 * Render the landing film to stills.
 *
 * A scroll-driven canvas is hard to review inside a browser and impossible to
 * review in a diff, so this draws the same frames the page draws and writes
 * them out as PNGs. Run it after touching `film-engine` and look at the
 * result — the tests pin the act structure, but only your eyes catch a
 * sentence sitting on top of its own evidence.
 *
 *   npm run film
 *   npm run film -- --out /tmp/frames --width 390 --height 780
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { buildGraph, paint } from '../src/components/landing/film-engine.ts'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const out = args.get('out') ?? 'film-frames'
const width = Number(args.get('width') ?? 1440)
const height = Number(args.get('height') ?? 900)

// The system font stands in for Inter; the frames are for composition, not
// for pixel-matching the shipped page.
for (const candidate of ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf']) {
  try {
    GlobalFonts.registerFromPath(candidate, 'Doc')
    break
  } catch {
    // Try the next one; canvas falls back to whatever it has.
  }
}

const MARKS = [0.02, 0.14, 0.24, 0.34, 0.44, 0.56, 0.62, 0.645, 0.66, 0.7, 0.78, 0.88, 0.97]

mkdirSync(out, { recursive: true })
const graph = buildGraph()
for (const p of MARKS) {
  const canvas = createCanvas(width, height)
  paint(canvas.getContext('2d'), width, height, p, 3000, graph, 'Doc')
  const name = `frame-${String(Math.round(p * 1000)).padStart(4, '0')}.png`
  writeFileSync(`${out}/${name}`, canvas.toBuffer('image/png'))
}
console.log(`${MARKS.length} frames at ${width}×${height} → ${out}/`)
