// @vitest-environment node

/**
 * The codec carries an address, a secret and an amount through chat apps. It
 * must round-trip exactly, stay URL-safe, refuse malformed input rather than
 * produce a plausible-but-wrong payload, and stay materially shorter than the
 * JSON form it replaced — shareability is the whole reason it exists.
 */

import { describe, expect, it } from 'vitest'
import { decodeClaim, decodePage, encodeClaim, encodePage } from '../codec'

const ADDRESS = '0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048'
const SECRET = `0x${'a3'.repeat(31)}`

const urlSafe = (s: string) => /^[A-Za-z0-9_-]+$/.test(s)

describe('claim links', () => {
  it('round-trips every field', () => {
    const payload = {
      secret: SECRET,
      token: 'USDC' as const,
      amount: 52_880_000n,
      from: 'Shariq',
      note: 'Coffee money',
    }
    const encoded = encodeClaim(payload)
    expect(urlSafe(encoded)).toBe(true)
    const back = decodeClaim(encoded)
    expect(BigInt(back!.secret)).toBe(BigInt(payload.secret))
    expect({ ...back, secret: '' }).toEqual({ ...payload, secret: '' })
  })

  it('round-trips without the optional fields', () => {
    const payload = { secret: SECRET, token: 'STRK' as const, amount: 1n }
    const back = decodeClaim(encodeClaim(payload))
    expect(BigInt(back!.secret)).toBe(BigInt(payload.secret))
    expect(back!.amount).toBe(1n)
  })

  it('survives an 18-decimal amount', () => {
    const payload = { secret: SECRET, token: 'STRK' as const, amount: 1_203_814_000_000_000_000_000n }
    expect(decodeClaim(encodeClaim(payload))?.amount).toBe(payload.amount)
  })

  it('keeps unicode in names and notes intact', () => {
    const payload = {
      secret: SECRET,
      token: 'USDC' as const,
      amount: 5n,
      from: 'Amara 🌊',
      note: 'Coffee ☕️ — thanks!',
    }
    const back = decodeClaim(encodeClaim(payload))
    expect(back?.from).toBe('Amara 🌊')
    expect(back?.note).toBe('Coffee ☕️ — thanks!')
  })

  it('is much shorter than the JSON form it replaced', () => {
    const encoded = encodeClaim({
      secret: SECRET,
      token: 'USDC',
      amount: 52_880_000n,
      from: 'Shariq',
      note: 'Coffee money',
    })
    expect(encoded.length).toBeLessThan(100)
  })

  it('refuses garbage instead of guessing', () => {
    expect(decodeClaim('!!!!')).toBeNull()
    expect(decodeClaim('')).toBeNull()
    expect(decodeClaim('AAAA')).toBeNull()
  })
})

describe('pay pages', () => {
  it('round-trips a standing page with presets', () => {
    const payload = { name: 'Shariq', address: ADDRESS, emoji: '🫐', presets: [5, 20, 50] }
    const encoded = encodePage(payload)
    expect(urlSafe(encoded)).toBe(true)
    const back = decodePage(encoded)
    // Felts come back canonically zero-padded; compare them by value.
    expect(BigInt(back!.address)).toBe(BigInt(payload.address))
    expect({ ...back, address: '' }).toEqual({ ...payload, address: '' })
  })

  it('round-trips a locked request', () => {
    const payload = {
      name: 'Shariq',
      address: ADDRESS,
      request: { token: 'USDC' as const, amount: 800_000_000n },
      note: 'Design sprint',
    }
    const back = decodePage(encodePage(payload))
    expect(BigInt(back!.address)).toBe(BigInt(payload.address))
    expect({ ...back, address: '' }).toEqual({ ...payload, address: '' })
  })

  it('preserves the address exactly', () => {
    const back = decodePage(encodePage({ name: 'x', address: ADDRESS }))
    expect(BigInt(back!.address)).toBe(BigInt(ADDRESS))
    expect(back!.address).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('stays well under the old JSON length', () => {
    const encoded = encodePage({ name: 'Shariq', address: ADDRESS, emoji: '🫐', presets: [5] })
    expect(encoded.length).toBeLessThan(80)
  })

  it('refuses a zero address or an empty name', () => {
    expect(decodePage(encodePage({ name: 'x', address: '0x0' }))).toBeNull()
    expect(decodePage('####')).toBeNull()
  })
})
