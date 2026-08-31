// @vitest-environment node

/**
 * The heuristic most likely to indict this product's own advice.
 *
 * Lumen's fix for a matching amount is "break it with an uneven split". An
 * uneven split whose parts still total the entry has moved the leak, not
 * removed it — value conserves, so addition is where an analyst goes after
 * pairwise matching fails. `amount-correlation` and `exit-amount-match` are
 * both strictly one-deposit-against-one-exit and see none of it.
 */

import { describe, expect, it } from 'vitest'
import type { ObservedEvent } from '../types'
import {
  AMOUNT_MATCH_TOLERANCE,
  MAX_SPLIT_LEGS,
  gatherSumMatch,
  splitSumMatch,
} from '../heuristics'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const ONE = 10n ** 18n

const dep = (units: number, at = NOW): ObservedEvent => ({
  kind: 'deposit',
  asset: 'STRK',
  amount: BigInt(Math.round(units)) * ONE,
  amountKnown: true,
  timestamp: at,
  tier: 'STRK',
})

const out = (units: number, at: number): ObservedEvent => ({
  kind: 'withdrawal',
  asset: 'STRK',
  amount: BigInt(Math.round(units)) * ONE,
  amountKnown: true,
  timestamp: at,
  tier: 'STRK',
})

describe('splitSumMatch', () => {
  it('catches an uneven three-way split that still totals the entry', () => {
    // Exactly what the product's own "split it" advice produces.
    const findings = splitSumMatch([
      dep(1000),
      out(413, NOW + HOUR),
      out(297, NOW + 9 * HOUR),
      out(290, NOW + 40 * HOUR),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.title).toContain('3 withdrawals')
    expect(findings[0]!.evidence.join(' ')).toContain('413')
  })

  it('nets the pool fee off each leg, because a planner would', () => {
    // 1000 in, three exits, three 6 STRK fees: 982 out.
    const findings = splitSumMatch([
      dep(1000),
      out(400, NOW + HOUR),
      out(300, NOW + 2 * HOUR),
      out(282, NOW + 3 * HOUR),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.explanation).toContain('pool fees are netted off')
  })

  it('says nothing when the parts do not reconstruct anything', () => {
    expect(
      splitSumMatch([dep(1000), out(120, NOW + HOUR), out(75, NOW + 5 * HOUR)]),
    ).toHaveLength(0)
  })

  it('ignores exits that precede the deposit', () => {
    expect(
      splitSumMatch([dep(1000, NOW), out(600, NOW - HOUR), out(400, NOW - 2 * HOUR)]),
    ).toHaveLength(0)
  })

  it('does not cross assets', () => {
    const usdc: ObservedEvent = { ...out(1000, NOW + HOUR), asset: 'USDC', tier: 'USDC' }
    expect(splitSumMatch([dep(1000), usdc])).toHaveLength(0)
  })

  it('ignores a split spread beyond the window', () => {
    const YEAR = 365 * 24 * HOUR
    expect(
      splitSumMatch([dep(1000), out(600, NOW + YEAR), out(400, NOW + YEAR + HOUR)]),
    ).toHaveLength(0)
  })

  it('reports one finding per deposit, not one per subset that fits', () => {
    // Several combinations reconstruct 1000 here; only the tightest is worth
    // saying, or a single deposit floods the whole report.
    const findings = splitSumMatch([
      dep(1000),
      out(500, NOW + HOUR),
      out(500, NOW + 2 * HOUR),
      out(250, NOW + 3 * HOUR),
      out(250, NOW + 4 * HOUR),
    ])
    expect(findings).toHaveLength(1)
  })

  it('tightens as legs are added, so a loose four-way is not a hit', () => {
    // Off by ~0.6%: inside the pairwise tolerance, outside a four-leg one.
    const drift = 1000 * (AMOUNT_MATCH_TOLERANCE * 0.6)
    const findings = splitSumMatch([
      dep(1000),
      out(250, NOW + HOUR),
      out(250, NOW + 2 * HOUR),
      out(250, NOW + 3 * HOUR),
      out(250 + drift, NOW + 4 * HOUR),
    ])
    for (const finding of findings) {
      expect(finding.title).not.toContain(`${MAX_SPLIT_LEGS} withdrawals`)
    }
  })

  it('needs at least two legs — a single exit is the pairwise case', () => {
    expect(splitSumMatch([dep(1000), out(1000, NOW + HOUR)])).toHaveLength(0)
  })

  it('skips amounts an observer cannot read', () => {
    const hidden: ObservedEvent = {
      kind: 'withdrawal',
      asset: 'STRK',
      amount: 0n,
      amountKnown: false,
      timestamp: NOW + HOUR,
      tier: 'private',
    }
    expect(splitSumMatch([dep(1000), hidden, out(1000, NOW + 2 * HOUR)])).toHaveLength(0)
  })
})

describe('gatherSumMatch — the mirror', () => {
  it('catches money arriving in pieces and leaving in one movement', () => {
    // The shape of being paid: several claims land over weeks, then one exit.
    // That exit ties every arrival to a single destination — the position a
    // person using claim links to get paid walks straight into.
    const findings = gatherSumMatch([
      dep(120, NOW - 300 * HOUR),
      dep(340, NOW - 200 * HOUR),
      dep(415, NOW - 100 * HOUR),
      out(875, NOW),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.title).toBe('One withdrawal empties 3 deposits')
    expect(findings[0]!.explanation).toContain('one address it came out to')
  })

  it('adds the pool fees rather than subtracting them, going this way', () => {
    // Three deposits of 100 cost three fees to get in, so 282 comes out.
    const findings = gatherSumMatch([
      dep(100, NOW - 3 * HOUR),
      dep(100, NOW - 2 * HOUR),
      dep(100, NOW - HOUR),
      out(282, NOW),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.explanation).toContain('pool fees')
  })

  it('requires the deposits to precede the exit', () => {
    expect(
      gatherSumMatch([out(1000, NOW), dep(600, NOW + HOUR), dep(400, NOW + 2 * HOUR)]),
    ).toHaveLength(0)
  })

  it('stays quiet when the arrivals do not account for the exit', () => {
    expect(
      gatherSumMatch([dep(100, NOW - 2 * HOUR), dep(100, NOW - HOUR), out(750, NOW)]),
    ).toHaveLength(0)
  })

  it('does not fire on the split shape, and vice versa', () => {
    // One in, three out is a split, not a gather. The two must not both claim
    // the same history or every report doubles.
    const split = [dep(1000, NOW - 5 * HOUR), out(400, NOW - 3 * HOUR), out(300, NOW - 2 * HOUR), out(300, NOW - HOUR)]
    expect(gatherSumMatch(split)).toHaveLength(0)
    expect(splitSumMatch(split)).toHaveLength(1)
  })
})
