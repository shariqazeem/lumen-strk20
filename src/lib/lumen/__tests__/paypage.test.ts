// @vitest-environment node

/**
 * The pay-page codec carries a receiving address and (for requests) an exact
 * amount through chat apps and bios. It must round-trip losslessly, stay
 * URL-safe, and refuse anything malformed rather than render a page that
 * pays the wrong person.
 */

import { describe, expect, it } from 'vitest'
import { decodePayPage, encodePayPage, slugify } from '../paypage'
import { encodePage } from '../codec'

const ADDRESS = '0x0421b1fca8f3a4b2e9a1c6d80e3f1972d54ab8c0de91f2a34b56c78d90e1f234'

describe('slugify', () => {
  it('makes clean path segments from human names', () => {
    expect(slugify('Shariq Shaukat')).toBe('shariq-shaukat')
    expect(slugify('  Amara! 🌊 ')).toBe('amara')
    expect(slugify('***')).toBe('me')
  })
})

describe('round-trips', () => {
  it('standing page with presets', () => {
    const payload = {
      v: 1 as const,
      n: 'Shariq',
      a: ADDRESS,
      p: [5, 20, 50],
    }
    const url = encodePayPage('https://lumen-strk20.vercel.app', payload)
    expect(url.startsWith('https://lumen-strk20.vercel.app/pay/shariq#')).toBe(true)
    const fragment = url.split('#')[1]
    expect(/^[A-Za-z0-9_-]+$/.test(fragment)).toBe(true)
    expect(decodePayPage(`#${fragment}`)).toEqual(payload)
  })

  it('still reads a link minted while pages carried an emoji', () => {
    const legacy = encodePage({ name: 'Shariq', address: ADDRESS, emoji: '🌊' })
    // The field is skipped on the way in, not choked on.
    expect(decodePayPage(`#${legacy}`)).toEqual({ v: 1, n: 'Shariq', a: ADDRESS })
  })

  it('request link with a locked token amount and note', () => {
    const payload = {
      v: 1 as const,
      n: 'Shariq',
      a: ADDRESS,
      r: { t: 'USDC' as const, a: '149884201' },
      m: 'Design work — invoice 12',
    }
    const url = encodePayPage('https://x.test', payload)
    expect(decodePayPage(`#${url.split('#')[1]}`)).toEqual(payload)
  })
})

describe('rejection', () => {
  const encode = (raw: unknown) =>
    `#${Buffer.from(JSON.stringify(raw)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`

  it('refuses garbage, bad versions, and zero addresses', () => {
    expect(decodePayPage('#!!!')).toBeNull()
    expect(decodePayPage(encode({ v: 2, n: 'x', a: ADDRESS }))).toBeNull()
    expect(decodePayPage(encode({ v: 1, n: 'x', a: '0x0' }))).toBeNull()
    expect(decodePayPage(encode({ v: 1, n: '', a: ADDRESS }))).toBeNull()
  })

  it('refuses a request lock with an unknown token or zero amount', () => {
    expect(decodePayPage(encode({ v: 1, n: 'x', a: ADDRESS, r: { t: 'DOGE', a: '1' } }))).toBeNull()
    expect(decodePayPage(encode({ v: 1, n: 'x', a: ADDRESS, r: { t: 'USDC', a: '0' } }))).toBeNull()
  })

  it('drops junk presets instead of rejecting the page', () => {
    const decoded = decodePayPage(encode({ v: 1, n: 'x', a: ADDRESS, p: [5, -1, 'x', 20] }))
    expect(decoded?.p).toEqual([5, 20])
  })
})
