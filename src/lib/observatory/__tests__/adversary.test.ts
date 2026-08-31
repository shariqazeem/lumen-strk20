// @vitest-environment node

/**
 * The adversary, pointed at the real chain.
 *
 * The bug this replaces was silent and confident: pool activity was bucketed by
 * `keys[1]`, which on `Deposit(user*, token*, amount)` is the depositor, not
 * the token. `tierCounts` came back as nineteen hex-keyed buckets of ~1, so
 * `anonymitySetThin` looked up `tierCounts['strkBTC']`, found nothing, and
 * reported "you are alone" for every asset on every run.
 *
 * The test that matters is the last one in the first block: with real depth,
 * the verdict has to *differ* between a crowded asset and a thin one. A model
 * that says the same thing regardless of the chain is not measuring anything.
 */

import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '@/lib/history'
import { BLOCKS_PER_HOUR, type PoolPulse } from '../pool'
import { observedFrom, poolActivityFrom, standingFootprint } from '../adversary'

/** The 48-hour mainnet reading of 31 Aug 2026. */
const PULSE: PoolPulse = {
  spanBlocks: BLOCKS_PER_HOUR * 48,
  notesCreated: 348,
  notesSpent: 268,
  registrations: 44,
  helperCalls: 140,
  byToken: {
    STRK: { deposits: 95, withdrawals: 303 },
    USDC: { deposits: 22, withdrawals: 117 },
    strkBTC: { deposits: 3, withdrawals: 11 },
    xstrkBTC: { deposits: 0, withdrawals: 2 },
  },
  gapsMs: [120_000, 900_000, 60_000, 1_800_000, 240_000],
  readAt: 1_700_000_000_000,
}

const NOW = 1_700_000_000_000
const DAY = 86_400_000

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: Math.random().toString(36).slice(2),
  timestamp: NOW - DAY,
  type: 'SHIELD',
  asset: 'STRK',
  amount: 1_000_000_000_000_000_000_000n,
  route: 'DIRECT',
  observer: 'deposit · public',
  ...over,
})

describe('pool measurements in the adversary’s vocabulary', () => {
  it('keys tiers by token symbol, which is what the heuristic looks up', () => {
    const activity = poolActivityFrom(PULSE)
    expect(activity.tierCounts).toEqual({ STRK: 398, USDC: 139, strkBTC: 14, xstrkBTC: 2 })
  })

  it('drops assets with no activity rather than reporting a zero tier', () => {
    expect(poolActivityFrom(PULSE).tierCounts).not.toHaveProperty('ETH')
  })

  it('carries the pool’s real timing and note count', () => {
    const activity = poolActivityFrom(PULSE)
    expect(activity.interArrivalsMs).toEqual(PULSE.gapsMs)
    expect(activity.totalNotes).toBe(348)
  })

  it('reaches a different verdict for a crowded asset than a thin one', () => {
    // The whole point. Identical behaviour, different asset, different answer —
    // which the previous reader could never produce.
    const shape = { timestamp: NOW - DAY, amount: 500_000_000_000_000_000_000n }
    const crowded = standingFootprint({
      ledger: [entry({ ...shape, asset: 'STRK' })],
      pulse: PULSE,
      now: NOW,
    })
    const thin = standingFootprint({
      ledger: [entry({ ...shape, asset: 'strkBTC', amount: 10_000n })],
      pulse: PULSE,
      now: NOW,
    })
    const thinSet = (f: typeof crowded) =>
      f!.result.findings.some((x) => x.heuristic === 'anonymity-set-thin')

    expect(thinSet(thin)).toBe(true)
    expect(thinSet(crowded)).toBe(false)
  })
})

describe('the ledger as an observer would bucket it', () => {
  it('treats boundary legs as readable and in-pool moves as not', () => {
    const observed = observedFrom([
      entry({ type: 'SHIELD' }),
      entry({ type: 'UNSHIELD' }),
      entry({ type: 'TRANSFER' }),
      entry({ type: 'SWAP' }),
      entry({ type: 'STAKE' }),
    ])
    expect(observed.map((e) => e.amountKnown)).toEqual([true, true, false, false, true])
    // An in-pool amount is genuinely hidden. Claiming otherwise would invent a
    // leak, and this engine exists precisely because it does not flatter.
    expect(observed[2]!.amount).toBe(0n)
    expect(observed[2]!.tier).toBe('private')
  })

  it('maps deposits and withdrawals to the legs the adversary knows', () => {
    const observed = observedFrom([entry({ type: 'SHIELD' }), entry({ type: 'UNSHIELD' })])
    expect(observed.map((e) => e.kind)).toEqual(['deposit', 'withdrawal'])
  })
})

describe('the standing footprint', () => {
  it('says nothing when there is no history', () => {
    expect(standingFootprint({ ledger: [], pulse: PULSE, now: NOW })).toBeNull()
  })

  it('reports that the pool reading is missing rather than pretending', () => {
    const footprint = standingFootprint({ ledger: [entry()], pulse: null, now: NOW })
    expect(footprint?.poolIsLive).toBe(false)
  })

  it('finds the matching-exit pattern a real user would create', () => {
    // A textbook leak: a round amount in, effectively the same amount out
    // twenty minutes later.
    const footprint = standingFootprint({
      ledger: [
        entry({ type: 'SHIELD', timestamp: NOW - DAY, amount: 1_000_000_000_000_000_000_000n }),
        entry({
          type: 'UNSHIELD',
          timestamp: NOW - DAY + 20 * 60_000,
          amount: 999_000_000_000_000_000_000n,
        }),
      ],
      pulse: PULSE,
      now: NOW,
    })
    expect(footprint!.result.findings.length).toBeGreaterThan(0)
    expect(footprint!.result.linkabilityScore).toBeGreaterThan(0)
    expect(footprint!.publicLegs).toBe(2)
  })

  it('counts only the legs an observer could actually read', () => {
    const footprint = standingFootprint({
      ledger: [entry({ type: 'TRANSFER' }), entry({ type: 'TRANSFER' }), entry({ type: 'SHIELD' })],
      pulse: PULSE,
      now: NOW,
    })
    expect(footprint!.publicLegs).toBe(1)
  })
})

describe('the two models agree', () => {
  it('uses one definition of a thin crowd', async () => {
    // The observatory and the adversary are rendered on the same screen. If
    // these drift, the product tells the user two different things about the
    // same number, and the one who notices stops believing both.
    const { MIN_ANON_SET } = await import('@/lib/deanon/heuristics')
    const { THIN_MOVES } = await import('../posture')
    expect(MIN_ANON_SET).toBe(THIN_MOVES)
  })
})

describe('classification an observer would recognise', () => {
  it('files a link mint and a stake as exits, because that is what they are', () => {
    // Both move money out of the pool to a helper, publicly, amount in the
    // clear. Filing them as generic actions hid them from every exit
    // heuristic — the engine understated the user, which is the one direction
    // it must never be wrong in.
    const observed = observedFrom([
      entry({ type: 'LINK' }),
      entry({ type: 'STAKE' }),
      entry({ type: 'CLAIM' }),
      entry({ type: 'SWAP' }),
    ])
    expect(observed.map((e) => e.kind)).toEqual(['withdrawal', 'withdrawal', 'deposit', 'action'])
  })

  it('finds the matched pair a mint and its reclaim create', () => {
    // A reclaim returns exactly what is in the entry, so the two public legs
    // carry the same number. Unavoidable, and worth being told about.
    const amount = 2_000_000_000_000_000_000n
    const footprint = standingFootprint({
      ledger: [
        entry({ type: 'LINK', amount, timestamp: NOW - 2 * DAY }),
        entry({ type: 'CLAIM', amount, timestamp: NOW - DAY }),
      ],
      pulse: PULSE,
      now: NOW,
    })
    expect(footprint!.result.findings.length).toBeGreaterThan(0)
  })
})
