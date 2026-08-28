// @vitest-environment node

/**
 * The token list's *order* is wire format.
 *
 * `codec.ts` writes a token as a one-byte index into `TOKEN_LIST`, which is
 * `Object.values(TOKENS)` — so the declaration order in `config.ts` is what a
 * minted link carries. Insert a token anywhere but the end, or reorder the
 * object, and every link already in the wild silently resolves to the wrong
 * asset. Not an error: the wrong asset.
 *
 * So the order is pinned here. Appending is fine and this test will not
 * complain about it; changing the first five positions will.
 */

import { describe, expect, it } from 'vitest'
import { preferredToken, TOKEN_LIST } from '../config'
import { decodePage, encodePage } from '@/lib/lumen/codec'

/** Frozen 2026-08-28. Append below the last entry; never reorder above it. */
const PINNED = ['STRK', 'USDC', 'strkBTC', 'ETH', 'WBTC'] as const

describe('token wire order', () => {
  it('has not been reordered', () => {
    expect(TOKEN_LIST.slice(0, PINNED.length).map((t) => t.symbol)).toEqual([...PINNED])
  })

  it('only ever grows at the end', () => {
    expect(TOKEN_LIST.length).toBeGreaterThanOrEqual(PINNED.length)
  })

  it('round-trips every token through a link at its pinned index', () => {
    const address = '0x04d1f2b7e5c8a396f0b2d4e6810a3c5f7920bd4e6182a3c5d7e9f0b1c2d3e4f5'
    for (const token of TOKEN_LIST) {
      const fragment = encodePage({
        name: 'Shariq',
        address,
        request: { token: token.symbol, amount: 100_000n },
      })
      expect(decodePage(fragment)?.request?.token).toBe(token.symbol)
    }
  })
})

describe('preferredToken', () => {
  it('leads with the flagship on an empty account', () => {
    expect(preferredToken([])).toBe('strkBTC')
  })

  it('leads with the flagship when there is any of it', () => {
    expect(
      preferredToken([
        { symbol: 'USDC', raw: 500_000_000n },
        { symbol: 'strkBTC', raw: 1_000n },
      ]),
    ).toBe('strkBTC')
  })

  it('never opens on an asset the account cannot spend', () => {
    // Opening on the flagship with none of it is a screen that cannot send.
    expect(
      preferredToken([
        { symbol: 'strkBTC', raw: 0n },
        { symbol: 'USDC', raw: 500_000_000n },
      ]),
    ).toBe('USDC')
  })
})
