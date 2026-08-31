'use client'

/**
 * Point the adversary at the real chain.
 *
 * `lib/deanon` is a working model of how privacy-pool users actually get
 * deanonymized — seven heuristics that re-forge the link between a deposit and
 * a withdrawal statistically, without touching the cryptography. It has always
 * been the sharpest thing in this codebase and it has always run on invented
 * data: `DEMO_POOL` is a fixture, and the one live reader that existed bucketed
 * pool activity by `keys[1]`, which on a `Deposit(user*, token*, amount)` is
 * the depositor's address, not the token. It produced nineteen buckets of ~1
 * keyed by hex felts, so `anonymitySetThin` looked up `tierCounts['strkBTC']`,
 * found nothing, and returned "you are alone" every time regardless of the
 * chain. Confidently, and always.
 *
 * This module is the bridge. Real ledger in, real pool measurements in, the
 * same adversary, and a verdict that is now about the world rather than a
 * fixture.
 *
 * Two properties worth keeping:
 *
 * - **It runs against you, not for you.** The output is what an analyst could
 *   infer, so a flattering answer is a broken one.
 * - **It reasons over the sequence, not the transaction.** The guard checks the
 *   thing you are about to sign. This asks what your history already says, which
 *   is where privacy is actually lost — over weeks, across counterparties.
 */

import type { LedgerEntry } from '@/lib/history'
import type { PoolActivity } from '@/lib/engine/types'
import type { DeanonReport, ObservedEvent } from '@/lib/deanon/types'
import { runDeanonymization } from '@/lib/deanon/engine'
import { TOKENS } from '@/lib/strk20/config'
import { peersFor, type PoolPulse } from './pool'

/**
 * The observatory's measurements in the adversary's vocabulary.
 *
 * `tierCounts` is keyed by **token symbol**, because that is what
 * `anonymitySetThin` looks up and what the pool actually lets you observe: a
 * shielded strkBTC note hides among other strkBTC actions, and the count of
 * those is public even though their sizes are not.
 */
export function poolActivityFrom(pulse: PoolPulse): PoolActivity {
  const tierCounts: Record<string, number> = {}
  for (const symbol of Object.keys(pulse.byToken) as Array<keyof typeof pulse.byToken>) {
    const peers = peersFor(pulse, symbol)
    if (peers > 0) tierCounts[symbol] = peers
  }
  return {
    tierCounts,
    interArrivalsMs: pulse.gapsMs,
    totalNotes: pulse.notesCreated,
  }
}

/**
 * The user's own ledger as an observer would bucket it.
 *
 * Only the boundary legs carry amounts an observer can read. A `TRANSFER` or a
 * `SWAP` happens inside the pool, so its amount is genuinely hidden — recorded
 * here with `amountKnown: false` and the `private` tier, which the amount
 * heuristics skip. Marking those as known would invent a leak that does not
 * exist, and the whole point of this engine is that it does not flatter.
 */
export function observedFrom(ledger: readonly LedgerEntry[]): ObservedEvent[] {
  return ledger.map((entry) => {
    const isPublicLeg =
      entry.type === 'SHIELD' ||
      entry.type === 'UNSHIELD' ||
      entry.type === 'LINK' ||
      entry.type === 'CLAIM' ||
      entry.type === 'STAKE'

    const kind: ObservedEvent['kind'] =
      entry.type === 'SHIELD' ? 'deposit' : entry.type === 'UNSHIELD' ? 'withdrawal' : 'action'

    return {
      kind,
      asset: entry.asset,
      amount: isPublicLeg ? entry.amount : 0n,
      amountKnown: isPublicLeg,
      timestamp: entry.timestamp,
      // The tier an observer would bucket this into. For a public leg that is
      // the asset; for anything inside the pool there is nothing to bucket.
      tier: isPublicLeg ? entry.asset : 'private',
      ...(entry.txHash ? { txHash: entry.txHash } : {}),
    }
  })
}

export interface StandingFootprint {
  result: DeanonReport
  /** How much of the verdict rests on measured pool depth rather than shape. */
  poolIsLive: boolean
  /** Public legs the adversary had to work with. Zero means it saw nothing. */
  publicLegs: number
}

/**
 * What an analyst could infer about this wallet right now.
 *
 * Returns `null` when there is nothing to say — no history, or no pool reading.
 * A footprint computed from an empty ledger is not a clean bill of health, it
 * is an absence of evidence, and the product must not render one as the other.
 */
export function standingFootprint(input: {
  ledger: readonly LedgerEntry[]
  pulse: PoolPulse | null
  now: number
}): StandingFootprint | null {
  const events = observedFrom(input.ledger)
  if (events.length === 0) return null

  const publicLegs = events.filter((event) => event.amountKnown).length
  const pool: PoolActivity = input.pulse
    ? poolActivityFrom(input.pulse)
    : { tierCounts: {}, interArrivalsMs: [], totalNotes: 0 }

  return {
    result: runDeanonymization(events, { now: input.now, pool }),
    poolIsLive: input.pulse !== null,
    publicLegs,
  }
}

/**
 * One sentence for the surface, in the product's voice.
 *
 * Names the strongest finding rather than the score, because a number is not
 * something anyone can act on and "your last three exits were the same size"
 * is.
 */
export function footprintHeadline(footprint: StandingFootprint): string {
  const { result, publicLegs } = footprint
  if (publicLegs === 0) {
    return 'Nothing you have done has a public leg yet — there is no footprint to read.'
  }
  const worst = result.findings[0]
  if (!worst) {
    return `${publicLegs} public ${publicLegs === 1 ? 'moment' : 'moments'}, and none of them line up.`
  }
  return worst.title
}

/** The unit the amounts in a finding are expressed in, for display. */
export function decimalsFor(asset: keyof typeof TOKENS): number {
  return TOKENS[asset].decimals
}
