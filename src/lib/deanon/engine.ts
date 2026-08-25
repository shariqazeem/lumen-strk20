import type { PoolActivity } from '@/lib/engine/types'
import { ALL_HEURISTICS } from './heuristics'
import type { Band, DeanonReport, Finding, HeuristicContext, ObservedEvent, Severity } from './types'

/**
 * The adversary.
 *
 * Runs every heuristic over a target's observable footprint and reports how
 * linkable they are. Deterministic: same events, same context, same report.
 */

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/** Severity multipliers for the aggregate. Critical findings dominate. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 1,
  high: 0.72,
  medium: 0.4,
  low: 0.18,
}

/**
 * Aggregate findings into 0..100.
 *
 * Uses a noisy-or rather than a sum: five weak signals should not add up to
 * certainty, and one critical signal should not be diluted by a pile of minor
 * ones. Each finding contributes its severity-weighted confidence as an
 * independent chance of linking the target, and the score is the probability
 * that at least one of them succeeds.
 */
export function aggregateLinkability(findings: Finding[]): number {
  if (findings.length === 0) return 0

  let survival = 1
  for (const finding of findings) {
    const strength = Math.min(1, Math.max(0, finding.confidence)) * SEVERITY_WEIGHT[finding.severity]
    survival *= 1 - strength
  }

  const score = (1 - survival) * 100
  return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10
}

export function bandFor(score: number): Band {
  if (score >= 70) return 'exposed'
  if (score >= 45) return 'weak'
  if (score >= 20) return 'guarded'
  return 'shielded'
}

function summarise(score: number, band: Band, findings: Finding[], observed: number): string {
  if (observed === 0) {
    return 'Nothing public to analyse yet — no deposits, withdrawals or recorded actions.'
  }
  if (findings.length === 0) {
    return `No linkable pattern found across ${observed} public events. Nothing here ties them together.`
  }

  const worst = findings[0]
  const counts = findings.length

  switch (band) {
    case 'exposed':
      return `Linkable. ${counts} finding${counts === 1 ? '' : 's'} across ${observed} public events, led by: ${worst.title.toLowerCase()}.`
    case 'weak':
      return `Partially linkable. ${counts} finding${counts === 1 ? '' : 's'} worth closing, starting with: ${worst.title.toLowerCase()}.`
    case 'guarded':
      return `Mostly unlinkable, with ${counts} residual signal${counts === 1 ? '' : 's'} an observer could still use.`
    default:
      return `Hard to link. ${counts} weak signal${counts === 1 ? '' : 's'} found, none of them decisive.`
  }
}

export function runDeanonymization(
  events: ObservedEvent[],
  context: HeuristicContext,
): DeanonReport {
  const findings: Finding[] = []

  for (const heuristic of ALL_HEURISTICS) {
    try {
      findings.push(...heuristic.run(events, context))
    } catch {
      // A heuristic that throws must not take the whole report with it —
      // a partial adversary is still useful, a crashed one is not.
    }
  }

  findings.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (bySeverity !== 0) return bySeverity
    if (b.confidence !== a.confidence) return b.confidence - a.confidence
    return a.id.localeCompare(b.id)
  })

  const linkabilityScore = aggregateLinkability(findings)
  const band = bandFor(linkabilityScore)

  return {
    linkabilityScore,
    band,
    findings,
    observedCount: events.length,
    summary: summarise(linkabilityScore, band, findings, events.length),
  }
}

/* ------------------------------------------------------------------ */
/*  Demo scenarios                                                     */
/* ------------------------------------------------------------------ */

/** A pool with healthy tiers, so thin-set findings don't skew the contrast. */
export const DEMO_POOL: PoolActivity = {
  tierCounts: { USDC: 2847, strkBTC: 1120, STRK: 964, '1e21': 412 },
  interArrivalsMs: [412_000, 88_000, 1_240_000, 305_000, 76_000, 903_000],
  totalNotes: 5343,
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * Two footprints that make the argument concrete.
 *
 * `naive` is a textbook-linkable user: a round 1,000 in, effectively the same
 * amount out twenty minutes later, on a weekly clock. `managed` is the same
 * capital handled by Lumen — non-round splits, no matching exit, irregular
 * spacing. Both run through the identical adversary; only the behaviour differs.
 */
export function demoScenarios(now: number): {
  naive: ObservedEvent[]
  managed: ObservedEvent[]
} {
  const usdc = (value: number) => BigInt(Math.round(value * 1e6))

  const naive: ObservedEvent[] = [
    {
      kind: 'deposit',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 21 * DAY,
      tier: 'USDC',
    },
    {
      kind: 'withdrawal',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 21 * DAY + 20 * 60_000,
      tier: 'USDC',
    },
    {
      kind: 'deposit',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 14 * DAY,
      tier: 'USDC',
    },
    {
      kind: 'withdrawal',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 14 * DAY + 18 * 60_000,
      tier: 'USDC',
    },
    {
      kind: 'deposit',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 7 * DAY,
      tier: 'USDC',
    },
    {
      kind: 'withdrawal',
      asset: 'USDC',
      amount: usdc(1000),
      amountKnown: true,
      timestamp: now - 7 * DAY + 22 * 60_000,
      tier: 'USDC',
    },
  ]

  const managed: ObservedEvent[] = [
    {
      kind: 'deposit',
      asset: 'USDC',
      amount: usdc(4182.44),
      amountKnown: true,
      timestamp: now - 19 * DAY - 5 * HOUR,
      tier: 'USDC',
    },
    // Everything after the deposit is an in-pool action: the amounts are
    // genuinely not recoverable, which is the pool working as designed.
    // Gaps of 3d, 9d and 2d, at unrelated hours — the de-periodised spacing
    // the planner produces. Evenly spaced actions would themselves be a
    // schedule, which the cadence heuristic correctly punishes.
    {
      kind: 'action',
      asset: 'strkBTC',
      amount: 0n,
      amountKnown: false,
      timestamp: now - 16 * DAY - 2 * HOUR,
      tier: 'private',
    },
    {
      kind: 'action',
      asset: 'strkBTC',
      amount: 0n,
      amountKnown: false,
      timestamp: now - 6 * DAY - 19 * HOUR,
      tier: 'private',
    },
    {
      kind: 'action',
      asset: 'USDC',
      amount: 0n,
      amountKnown: false,
      timestamp: now - 4 * DAY - 3 * HOUR,
      tier: 'private',
    },
  ]

  return { naive, managed }
}
