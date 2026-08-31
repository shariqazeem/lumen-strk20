// @vitest-environment node

/**
 * The judgement, pinned against the mainnet window it was calibrated on.
 *
 * Measured 31 Aug 2026 over 48 hours: STRK 400 public moves, USDC 146,
 * strkBTC 14, xstrkBTC 2, ETH 2, and 353 private notes — about 7.4 an hour.
 * Those are the numbers the thresholds were chosen against, so they are the
 * numbers the tests use. If a future reading makes these verdicts wrong, the
 * constants should move and this file should move with them.
 */

import { describe, expect, it } from 'vitest'
import { BLOCKS_PER_HOUR, notesPerHour, peersFor, type PoolPulse } from '../pool'
import { adviceFor, momentIsQuiet, readCrowd } from '../posture'

/** The real 48-hour reading, as recorded. */
const MAINNET: PoolPulse = {
  spanBlocks: BLOCKS_PER_HOUR * 48,
  notesCreated: 353,
  notesSpent: 271,
  registrations: 44,
  helperCalls: 140,
  byToken: {
    STRK: { deposits: 95, withdrawals: 305 },
    USDC: { deposits: 24, withdrawals: 122 },
    strkBTC: { deposits: 3, withdrawals: 11 },
    xstrkBTC: { deposits: 0, withdrawals: 2 },
    ETH: { deposits: 1, withdrawals: 1 },
  },
  // Real spacing, roughly: 353 notes over 48 hours is one every ~8 minutes,
  // arriving in bursts rather than on a clock.
  gapsMs: [120_000, 900_000, 60_000, 1_800_000, 240_000, 75_000],
  readAt: 1_700_000_000_000,
}

describe('reading the crowd', () => {
  it('counts an asset the way the pool reports it', () => {
    expect(peersFor(MAINNET, 'STRK')).toBe(400)
    expect(peersFor(MAINNET, 'strkBTC')).toBe(14)
    expect(peersFor(MAINNET, 'WBTC')).toBe(0)
  })

  it('calls STRK crowded', () => {
    expect(readCrowd(MAINNET, 'STRK').stance).toBe('crowded')
  })

  it('calls Bitcoin exposed, even though it is the headline asset', () => {
    // The product leads with Bitcoin. If this ever softens, the observatory
    // has stopped measuring and started advertising.
    const reading = readCrowd(MAINNET, 'strkBTC')
    expect(reading.stance).toBe('exposed')
    expect(reading.headline).toContain('Almost nobody else')
  })

  it('points at the deeper asset instead of just saying no', () => {
    const reading = readCrowd(MAINNET, 'strkBTC')
    expect(reading.deeper).toBe('STRK')
    expect(adviceFor(reading, 'strkBTC')).toContain('STRK')
  })

  it('does not suggest an alternative when the asset is already the deepest', () => {
    expect(readCrowd(MAINNET, 'STRK').deeper).toBeUndefined()
  })

  it('does not suggest one that is only marginally ahead', () => {
    // USDC at 146 against STRK at 400 is better, but not a different league —
    // telling someone to move assets for that is noise.
    const close: PoolPulse = {
      ...MAINNET,
      byToken: { STRK: { deposits: 60, withdrawals: 60 }, USDC: { deposits: 55, withdrawals: 55 } },
    }
    expect(readCrowd(close, 'USDC').deeper).toBeUndefined()
  })

  it('quotes the evidence so the verdict can be checked', () => {
    const reading = readCrowd(MAINNET, 'strkBTC')
    expect(reading.because).toContain('14 public strkBTC moves')
    expect(reading.because).toContain('400 for STRK')
  })

  it('reports a rate, not a raw count', () => {
    expect(notesPerHour(MAINNET)).toBeCloseTo(7.35, 1)
    expect(momentIsQuiet(MAINNET)).toBe(false)
  })
})

describe('an empty pool', () => {
  const dead: PoolPulse = {
    spanBlocks: BLOCKS_PER_HOUR * 48,
    notesCreated: 0,
    notesSpent: 0,
    registrations: 0,
    helperCalls: 0,
    byToken: {},
    gapsMs: [],
    readAt: 0,
  }

  it('is exposed in every asset, and says so without dividing by zero', () => {
    for (const symbol of ['STRK', 'strkBTC', 'USDC'] as const) {
      const reading = readCrowd(dead, symbol)
      expect(reading.stance).toBe('exposed')
      expect(reading.peers).toBe(0)
      expect(Number.isFinite(reading.perHour)).toBe(true)
    }
    expect(momentIsQuiet(dead)).toBe(true)
  })

  it('offers no alternative when there is no crowd anywhere', () => {
    expect(readCrowd(dead, 'strkBTC').deeper).toBeUndefined()
  })

  it('still gives advice rather than going silent', () => {
    expect(adviceFor(readCrowd(dead, 'strkBTC'), 'strkBTC').length).toBeGreaterThan(20)
  })
})

describe('the thin middle', () => {
  const thin: PoolPulse = {
    ...MAINNET,
    byToken: { USDC: { deposits: 15, withdrawals: 15 }, STRK: { deposits: 200, withdrawals: 200 } },
  }

  it('says it will still work', () => {
    const reading = readCrowd(thin, 'USDC')
    expect(reading.stance).toBe('thin')
    expect(adviceFor(reading, 'USDC')).toContain('still work')
  })
})
