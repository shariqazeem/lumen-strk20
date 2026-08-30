// @vitest-environment node

/**
 * The guard rewrites a round amount so it does not stand out in the public
 * record. It is allowed to move the number; it is not allowed to move it
 * enough that a user notices they were paid less than they meant to send.
 *
 * The documented budget is ~2%. It was silently blown at Bitcoin scale: `grain`
 * came from the token's decimals (`10^(decimals-6)`), which is genuine dust at
 * 18 decimals and 1% of the payment at 8. A 10,000-sat link drifted 8.12%.
 *
 * Grain is relative to the amount now, so these bounds hold at every scale a
 * token can be denominated in — and this test is the thing that says so.
 */

import { describe, expect, it } from 'vitest'
import { guardSeed, nudgeAmount } from '../guard'

const ADDRESS = '0x05db1a4f8e0c7b6d3a2f9e1c4b7a0d3f6e9c2b5a8d1f4e7c0b3a6d9f2e5c8b10'
const NOW = 1_700_000_000_000

/** Every scale Lumen actually routes, smallest first. */
const CASES: ReadonlyArray<readonly [string, bigint, number]> = [
  ['strkBTC, 1k sats', 1_000n, 8],
  ['strkBTC, a 9,527-sat swap', 9_527n, 8],
  ['strkBTC, a round 10k sats', 10_000n, 8],
  ['strkBTC, 0.001 BTC', 100_000n, 8],
  ['strkBTC, 1 BTC', 100_000_000n, 8],
  ['USDC, $50', 50_000_000n, 6],
  ['STRK, 0.5', 500_000_000_000_000_000n, 18],
  ['STRK, 300', 300_000_000_000_000_000_000n, 18],
]

describe('nudgeAmount drift budget', () => {
  it('never moves an amount by more than 2%, at any scale', () => {
    for (const [label, amount, decimals] of CASES) {
      const nudged = nudgeAmount(amount, decimals, guardSeed(ADDRESS, NOW), [], NOW)
      const driftBps = Number(((amount - nudged) * 10_000n) / amount)
      expect(driftBps, `${label} drifted ${driftBps} bps`).toBeLessThanOrEqual(200)
    }
  })

  it('only ever nudges down, and never to zero', () => {
    // A public boundary leg can only reduce: the user has exactly this much on
    // the table, and an amount rounded *up* would fail after they signed.
    for (const [label, amount, decimals] of CASES) {
      const nudged = nudgeAmount(amount, decimals, guardSeed(ADDRESS, NOW), [], NOW)
      expect(nudged, label).toBeGreaterThan(0n)
      expect(nudged, label).toBeLessThanOrEqual(amount)
    }
  })

  it('is deterministic in the seed', () => {
    const seed = guardSeed(ADDRESS, NOW)
    const once = nudgeAmount(10_000n, 8, seed, [], NOW)
    const twice = nudgeAmount(10_000n, 8, seed, [], NOW)
    expect(once).toBe(twice)
  })

  it('leaves an amount too small to move alone', () => {
    // Below the point where a nudge means anything, returning the input beats
    // returning dust — and the caller surfaces that honestly rather than
    // pretending it was tuned.
    expect(nudgeAmount(1n, 8, guardSeed(ADDRESS, NOW), [], NOW)).toBe(1n)
    expect(nudgeAmount(0n, 8, guardSeed(ADDRESS, NOW), [], NOW)).toBe(0n)
  })
})
