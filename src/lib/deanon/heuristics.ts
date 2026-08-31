import { TOKENS } from '@/lib/strk20/config'
import type { Finding, Heuristic, HeuristicContext, ObservedEvent, Severity } from './types'

/**
 * The heuristics, each pure and independently testable.
 *
 * None of these break a proof. They read the two public legs of a shielded
 * flow — the deposit and the withdrawal — and decide statistically that they
 * belong to the same person. That is how deployed pools actually leak.
 */

/* ------------------------------------------------------------------ */
/*  Tunables — named and documented, never bare numbers in the logic   */
/* ------------------------------------------------------------------ */

/** Two amounts within this relative distance are treated as "the same number". */
export const AMOUNT_MATCH_TOLERANCE = 0.01

/** A deposit and a later action inside this window are temporally linked. */
export const TIMING_WINDOW_MS = 60 * 60 * 1000

/** Below this many peers, a denomination tier does not hide anyone. */
/**
 * The smallest set that counts as a crowd.
 *
 * Was 5, which is the floor data-publishing uses for "not immediately
 * identifying" — far too weak for a payments pool, where an analyst can simply
 * enumerate the set. A 1-in-14 prior is a strong lead, not anonymity.
 *
 * Calibrated 31 Aug 2026 against measured mainnet depth over 48 hours: STRK
 * 398 public moves, USDC 139, strkBTC 14, xstrkBTC 2. A floor of 5 called
 * strkBTC healthy. It is not.
 *
 * Deliberately equal to `THIN_MOVES` in `observatory/posture.ts`. The two
 * models are shown on the same screen, and a product whose adversary says
 * "fine" while its observatory says "you are alone" is not measuring — it is
 * arguing with itself. A test pins them together.
 */
export const MIN_ANON_SET = 20

/** Gaps this consistent read as a schedule rather than as human irregularity. */
export const PERIODICITY_CV_THRESHOLD = 0.35

/** Cadence needs at least this many gaps before variance means anything. */
export const MIN_GAPS_FOR_CADENCE = 3

/** The mainnet pool fee, so `out ≈ in − fee` can be checked. */
export const POOL_FEE_STRK = 6

/**
 * How many exits a single entry is checked against as a group.
 *
 * Splitting one exit into several defeats pairwise amount matching and does
 * nothing at all against the sum — which is the attack an analyst reaches for
 * next, and the one Lumen's own splitter creates. Four legs is where the
 * combinatorics stop being cheap and the false-positive risk starts to bite.
 */
export const MAX_SPLIT_LEGS = 4

/** Exits considered per entry, most recent first. Bounds the search. */
export const MAX_SPLIT_CANDIDATES = 12

/** A split spread wider than this is not obviously one movement of money. */
export const SPLIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Relative difference of two positive numbers, 0 when identical. */
export function relativeDelta(a: number, b: number): number {
  const largest = Math.max(Math.abs(a), Math.abs(b))
  if (largest === 0) return 0
  return Math.abs(a - b) / largest
}

export function nearlyEqual(a: number, b: number, tolerance = AMOUNT_MATCH_TOLERANCE): boolean {
  return relativeDelta(a, b) <= tolerance
}

/** Convert raw units to token units for human-scale comparisons. */
export function toTokenUnits(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw)
  const base = 10n ** BigInt(decimals)
  const whole = raw / base
  const fraction = raw % base
  return Number(whole) + Number(fraction) / Number(base)
}

/**
 * How "round" a number looks to a human, 0..1.
 *
 * Round amounts are dangerous because humans pick them, so choosing one drops
 * you into the small subset of users who also did — collapsing a large
 * anonymity set into a tiny one.
 */
export function roundnessScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  for (const [magnitude, score] of [
    [10_000, 1],
    [1_000, 0.9],
    [100, 0.7],
    [50, 0.5],
    [10, 0.35],
  ] as const) {
    // A tiny epsilon so 999.9999 from a float path still reads as 1000.
    const remainder = value % magnitude
    if (remainder < 1e-6 || magnitude - remainder < 1e-6) return score
  }
  return 0
}

/** Coefficient of variation — low means regular, which means schedule. */
export function coefficientOfVariation(gaps: number[]): number {
  if (gaps.length < 2) return Number.POSITIVE_INFINITY
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  if (mean === 0) return Number.POSITIVE_INFINITY
  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length
  return Math.sqrt(variance) / mean
}

function decimalsFor(event: ObservedEvent): number {
  return TOKENS[event.asset]?.decimals ?? 18
}

function units(event: ObservedEvent): number {
  return toTokenUnits(event.amount, decimalsFor(event))
}

function fmt(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function timeOf(timestamp: number): string {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 16)
}

function severityFrom(confidence: number): Severity {
  if (confidence >= 0.85) return 'critical'
  if (confidence >= 0.6) return 'high'
  if (confidence >= 0.35) return 'medium'
  return 'low'
}

function known(events: ObservedEvent[]): ObservedEvent[] {
  return events.filter((event) => event.amountKnown && event.amount > 0n)
}

function byTime(events: ObservedEvent[]): ObservedEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp)
}

/* ------------------------------------------------------------------ */
/*  1 · Amount correlation — the canonical attack                      */
/* ------------------------------------------------------------------ */

export function amountCorrelation(events: ObservedEvent[]): Finding[] {
  const findings: Finding[] = []
  const deposits = known(events).filter((event) => event.kind === 'deposit')
  const exits = known(events).filter((event) => event.kind === 'withdrawal')

  for (const deposit of deposits) {
    for (const exit of exits) {
      if (exit.timestamp <= deposit.timestamp) continue
      if (exit.asset !== deposit.asset) continue

      const delta = relativeDelta(units(deposit), units(exit))
      if (delta > AMOUNT_MATCH_TOLERANCE) continue

      // An exact match is near-certain; the confidence falls off across the
      // tolerance band rather than cliff-edging at it.
      const confidence = Math.min(1, 1 - delta / AMOUNT_MATCH_TOLERANCE + 0.02)

      findings.push({
        id: `amount-correlation:${deposit.timestamp}:${exit.timestamp}`,
        heuristic: 'amount-correlation',
        title: 'A withdrawal matches a deposit amount',
        severity: severityFrom(confidence),
        confidence,
        explanation:
          `${fmt(units(deposit))} ${deposit.asset} entered the pool and ` +
          `${fmt(units(exit))} ${exit.asset} left it — ${(delta * 100).toFixed(2)}% apart. ` +
          'Both legs are public, so an observer can pair them on the amount alone. ' +
          'No proof was broken; the number did the work.',
        evidence: [
          `in  ${fmt(units(deposit))} ${deposit.asset} at ${timeOf(deposit.timestamp)}`,
          `out ${fmt(units(exit))} ${exit.asset} at ${timeOf(exit.timestamp)}`,
          `relative difference ${(delta * 100).toFixed(3)}%`,
        ],
        fix: {
          label: 'Split exits so no single amount echoes an entry',
          mode: 'PRIVACY_FIRST',
          action: 'split-amounts',
        },
      })
    }
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  2 · Round numbers                                                  */
/* ------------------------------------------------------------------ */

export function roundNumber(events: ObservedEvent[]): Finding[] {
  const findings: Finding[] = []

  for (const event of known(events)) {
    const value = units(event)
    const roundness = roundnessScore(value)
    if (roundness < 0.35) continue

    findings.push({
      id: `round-number:${event.timestamp}:${event.amount.toString()}`,
      heuristic: 'round-number',
      title: `Round amount: ${fmt(value)} ${event.asset}`,
      severity: severityFrom(roundness * 0.8),
      confidence: roundness * 0.8,
      explanation:
        `${fmt(value)} is a number a human chose. Amounts are public on this leg, so ` +
        'picking a round one places you in the small group of users who also picked ' +
        'round ones — which is a far smaller crowd than the pool as a whole.',
      evidence: [
        `${fmt(value)} ${event.asset} at ${timeOf(event.timestamp)}`,
        `roundness ${(roundness * 100).toFixed(0)}%`,
      ],
      fix: {
        label: 'Use non-round amounts that sum to the same total',
        mode: 'PRIVACY_FIRST',
        action: 'split-amounts',
      },
    })
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  3 · Timing correlation                                             */
/* ------------------------------------------------------------------ */

export function timingCorrelation(events: ObservedEvent[]): Finding[] {
  const findings: Finding[] = []
  const ordered = byTime(events)

  for (let i = 0; i < ordered.length; i += 1) {
    const deposit = ordered[i]
    if (deposit.kind !== 'deposit') continue

    for (let j = i + 1; j < ordered.length; j += 1) {
      const next = ordered[j]
      const gap = next.timestamp - deposit.timestamp
      if (gap <= 0) continue
      if (gap > TIMING_WINDOW_MS) break

      // Immediate is near-certain; confidence decays across the window.
      const confidence = Math.min(0.95, 0.95 * (1 - gap / TIMING_WINDOW_MS))
      if (confidence < 0.15) continue

      findings.push({
        id: `timing-correlation:${deposit.timestamp}:${next.timestamp}`,
        heuristic: 'timing-correlation',
        title: 'Pool activity follows the deposit too closely',
        severity: severityFrom(confidence),
        confidence,
        explanation:
          `A deposit at ${timeOf(deposit.timestamp)} was followed ${Math.round(gap / 60000)} ` +
          'minutes later by another pool interaction. Even with different amounts, a narrow ' +
          'window links the two: few other users acted in that slice of time.',
        evidence: [
          `deposit at ${timeOf(deposit.timestamp)}`,
          `next activity at ${timeOf(next.timestamp)}`,
          `gap ${Math.round(gap / 60000)} min (window ${TIMING_WINDOW_MS / 60000} min)`,
        ],
        fix: {
          label: 'Wait for a wider, irregular execution window',
          mode: 'PRIVACY_FIRST',
          action: 'delay-window',
        },
      })
      break // one finding per deposit is enough; the closest is the strongest
    }
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  4 · Thin anonymity set                                             */
/* ------------------------------------------------------------------ */

export function anonymitySetThin(
  events: ObservedEvent[],
  context: HeuristicContext,
): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()

  for (const event of events) {
    if (event.tier === 'private' || seen.has(event.tier)) continue
    seen.add(event.tier)

    const peers = context.pool.tierCounts[event.tier] ?? 0
    if (peers >= MIN_ANON_SET) continue

    // A set of one is certainty; confidence falls as peers approach the floor.
    const confidence = Math.min(0.95, 1 - peers / MIN_ANON_SET)

    findings.push({
      id: `anonymity-set-thin:${event.tier}`,
      heuristic: 'anonymity-set-thin',
      title: `Only ${peers} other action${peers === 1 ? '' : 's'} in this tier`,
      severity: severityFrom(confidence),
      confidence,
      explanation:
        `Activity in the ${event.tier} tier has ${peers} peer${peers === 1 ? '' : 's'} in the ` +
        'measured window. The cryptography is working, but there is no crowd to disappear ' +
        'into — anonymity is a property of the set, and this set is nearly empty.',
      evidence: [
        `tier ${event.tier}`,
        `${peers} peer actions observed`,
        `healthy floor is ${MIN_ANON_SET}`,
      ],
      fix: {
        label: 'Wait for the tier to fill, or move to a busier denomination',
        mode: 'PRIVACY_FIRST',
        action: 'retier',
      },
    })
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  5 · Repeated amounts                                               */
/* ------------------------------------------------------------------ */

export function repeatedAmount(events: ObservedEvent[]): Finding[] {
  const buckets = new Map<string, ObservedEvent[]>()

  for (const event of known(events)) {
    const key = `${event.asset}:${units(event).toFixed(6)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(event)
    else buckets.set(key, [event])
  }

  const findings: Finding[] = []

  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue

    const confidence = Math.min(0.9, 0.4 + 0.2 * (bucket.length - 1))
    const first = bucket[0]

    findings.push({
      id: `repeated-amount:${key}`,
      heuristic: 'repeated-amount',
      title: `The same amount used ${bucket.length} times`,
      severity: severityFrom(confidence),
      confidence,
      explanation:
        `${fmt(units(first))} ${first.asset} appears ${bucket.length} times. Reusing an exact ` +
        'amount clusters those actions together: an observer who cannot link any single pair ' +
        'can still see that one person is behind all of them.',
      evidence: bucket
        .slice(0, 4)
        .map((event) => `${fmt(units(event))} ${event.asset} at ${timeOf(event.timestamp)}`),
      fix: {
        label: 'Never reuse an amount — the engine enforces a 48h ban',
        mode: 'PRIVACY_FIRST',
        action: 'split-amounts',
      },
    })
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  6 · Cadence and periodicity                                        */
/* ------------------------------------------------------------------ */

export function cadencePeriodicity(events: ObservedEvent[]): Finding[] {
  const ordered = byTime(events)
  if (ordered.length < MIN_GAPS_FOR_CADENCE + 1) return []

  const gaps: number[] = []
  for (let i = 1; i < ordered.length; i += 1) {
    gaps.push(ordered[i].timestamp - ordered[i - 1].timestamp)
  }

  const findings: Finding[] = []
  const cv = coefficientOfVariation(gaps)

  if (cv <= PERIODICITY_CV_THRESHOLD) {
    const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    const confidence = Math.min(0.95, 1 - cv / PERIODICITY_CV_THRESHOLD)

    findings.push({
      id: 'cadence-periodicity:gaps',
      heuristic: 'cadence-periodicity',
      title: 'Actions arrive on a schedule',
      severity: severityFrom(confidence),
      confidence,
      explanation:
        `${gaps.length + 1} actions are spaced about every ${Math.round(meanGap / 3_600_000)} ` +
        `hours, varying by only ${(cv * 100).toFixed(0)}%. This is the failure that survives ` +
        'perfect cryptography: every transaction is private, and the schedule still identifies ' +
        'you.',
      evidence: [
        `${gaps.length + 1} actions observed`,
        `mean gap ${Math.round(meanGap / 3_600_000)}h`,
        `variation ${(cv * 100).toFixed(0)}% (schedule below ${PERIODICITY_CV_THRESHOLD * 100}%)`,
      ],
      fix: {
        label: 'De-periodise the plan — irregular windows, not a rhythm',
        mode: 'STEALTH_DCA',
        action: 'deperiodise',
      },
    })
  }

  // Same hour of day, every time, is its own tell even when gaps vary.
  const hours = ordered.map((event) => new Date(event.timestamp).getUTCHours())
  const hourCounts = new Map<number, number>()
  for (const hour of hours) hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
  const [topHour, topCount] = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]

  if (topCount >= MIN_GAPS_FOR_CADENCE && topCount / hours.length >= 0.6) {
    const confidence = Math.min(0.85, topCount / hours.length)
    findings.push({
      id: `cadence-periodicity:hour-${topHour}`,
      heuristic: 'cadence-periodicity',
      title: `Most activity lands in the ${String(topHour).padStart(2, '0')}:00 hour`,
      severity: severityFrom(confidence),
      confidence,
      explanation:
        `${topCount} of ${hours.length} actions occur in the same hour of day. Time zone and ` +
        'routine are behavioural fingerprints that no amount of proving strength hides.',
      evidence: [
        `${topCount}/${hours.length} actions in hour ${String(topHour).padStart(2, '0')}:00 UTC`,
      ],
      fix: {
        label: 'Spread execution across the clock',
        mode: 'STEALTH_DCA',
        action: 'deperiodise',
      },
    })
  }

  return findings
}

/* ------------------------------------------------------------------ */
/*  7 · Exit reconstructs entry minus the known fee                    */
/* ------------------------------------------------------------------ */

/**
 * Several exits that add up to one entry.
 *
 * `amount-correlation` and `exit-amount-match` are both pairwise: one deposit
 * against one withdrawal. Splitting an exit into three defeats them completely
 * — and defeats nothing at all against addition, which is where a competent
 * analyst goes next. Value has to conserve, so the sum is still there.
 *
 * This is deliberately the heuristic most likely to indict Lumen's own advice.
 * The product's fix for a matching amount is "break it with an uneven split",
 * and an uneven split whose parts still total the entry has moved the leak
 * rather than removed it. An adversary that cannot see the thing its own
 * product does is not an adversary.
 *
 * The tolerance tightens as legs are added, because more legs mean more
 * combinations tried and therefore more chance of hitting a sum by accident.
 * Only the tightest match per entry is reported, so one deposit cannot flood
 * the report with every subset that happens to fit.
 */
export function splitSumMatch(events: ObservedEvent[]): Finding[] {
  const findings: Finding[] = []
  const deposits = known(events).filter((event) => event.kind === 'deposit')
  const exits = known(events).filter((event) => event.kind === 'withdrawal')

  for (const deposit of deposits) {
    const inUnits = units(deposit)
    if (inUnits <= 0) continue

    const candidates = exits
      .filter(
        (exit) =>
          exit.asset === deposit.asset &&
          exit.timestamp > deposit.timestamp &&
          exit.timestamp - deposit.timestamp <= SPLIT_WINDOW_MS,
      )
      .slice(0, MAX_SPLIT_CANDIDATES)

    let best: { legs: ObservedEvent[]; delta: number; fee: number } | null = null

    const walk = (start: number, picked: ObservedEvent[], sum: number) => {
      if (picked.length >= 2) {
        // The pool charges its flat fee once per operation, so a k-way exit
        // costs k fees. Both the gross and net readings are checked, because
        // a planner that nets the fee off is not disguising anything.
        for (const fee of [0, POOL_FEE_STRK * picked.length]) {
          const target = inUnits - fee
          if (target <= 0) continue
          const delta = relativeDelta(sum, target)
          if (delta > AMOUNT_MATCH_TOLERANCE / picked.length) continue
          if (!best || delta < best.delta) best = { legs: [...picked], delta, fee }
        }
      }
      if (picked.length >= MAX_SPLIT_LEGS) return
      for (let i = start; i < candidates.length; i += 1) {
        const next = candidates[i]
        if (!next) continue
        walk(i + 1, [...picked, next], sum + units(next))
      }
    }
    walk(0, [], 0)

    if (!best) continue
    const match = best as { legs: ObservedEvent[]; delta: number; fee: number }
    const legs = match.legs.length
    // More legs adding to the same total is stronger evidence of one movement,
    // but it was also found among more combinations. The tightened tolerance
    // already paid for that, so confidence stays deliberately moderate.
    const confidence = Math.min(0.9, 0.55 + 0.08 * legs)
    const total = match.legs.reduce((sum, leg) => sum + units(leg), 0)

    findings.push({
      id: `split-sum-match:${deposit.timestamp}:${legs}`,
      heuristic: 'split-sum-match',
      title: `${legs} withdrawals add up to one deposit`,
      severity: severityFrom(confidence),
      confidence,
      explanation:
        `${legs} separate exits totalling ${fmt(total)} ${deposit.asset} reconstruct a ` +
        `${fmt(inUnits)} ${deposit.asset} deposit` +
        (match.fee > 0 ? `, once ${legs} pool fees are netted off` : '') +
        '. Splitting breaks a one-to-one amount match and leaves the sum untouched — value ' +
        'conserves, so addition is the next thing anyone looks at.',
      evidence: [
        `in  ${fmt(inUnits)} ${deposit.asset}`,
        `out ${match.legs.map((leg) => fmt(units(leg))).join(' + ')}`,
        `= ${fmt(total)}${match.fee > 0 ? ` (fees ${match.fee})` : ''}`,
        `within ${(match.delta * 100).toFixed(2)}%`,
      ],
      fix: {
        label: 'Leave part of it in, or split across assets rather than only across amounts',
        mode: 'PRIVACY_FIRST',
        action: 'split-amounts',
      },
    })
  }

  return findings
}

export function exitAmountMatch(events: ObservedEvent[]): Finding[] {
  const findings: Finding[] = []
  const deposits = known(events).filter((event) => event.kind === 'deposit')
  const exits = known(events).filter((event) => event.kind === 'withdrawal')

  for (const deposit of deposits) {
    for (const exit of exits) {
      if (exit.timestamp <= deposit.timestamp || exit.asset !== deposit.asset) continue

      const inUnits = units(deposit)
      const outUnits = units(exit)
      // Already covered by amount-correlation when they simply match.
      if (nearlyEqual(inUnits, outUnits)) continue

      const expected = inUnits - POOL_FEE_STRK
      if (expected <= 0) continue
      if (!nearlyEqual(expected, outUnits)) continue

      const confidence = 0.8
      findings.push({
        id: `exit-amount-match:${deposit.timestamp}:${exit.timestamp}`,
        heuristic: 'exit-amount-match',
        title: 'A withdrawal reconstructs a deposit minus the pool fee',
        severity: severityFrom(confidence),
        confidence,
        explanation:
          `${fmt(outUnits)} out is ${fmt(inUnits)} in minus the ${POOL_FEE_STRK} STRK pool fee. ` +
          'The fee is a published constant, so subtracting it is trivial — netting the fee off ' +
          'does not disguise the amount, it just adds one subtraction to the attack.',
        evidence: [
          `in  ${fmt(inUnits)} ${deposit.asset}`,
          `out ${fmt(outUnits)} ${exit.asset}`,
          `in − ${POOL_FEE_STRK} = ${fmt(expected)}`,
        ],
        fix: {
          label: 'Break the arithmetic link with an uneven split',
          mode: 'PRIVACY_FIRST',
          action: 'split-amounts',
        },
      })
    }
  }

  return findings
}

/* ------------------------------------------------------------------ */

export const ALL_HEURISTICS: Heuristic[] = [
  { id: 'amount-correlation', run: (events) => amountCorrelation(events) },
  { id: 'exit-amount-match', run: (events) => exitAmountMatch(events) },
  { id: 'split-sum-match', run: (events) => splitSumMatch(events) },
  { id: 'round-number', run: (events) => roundNumber(events) },
  { id: 'timing-correlation', run: (events) => timingCorrelation(events) },
  { id: 'anonymity-set-thin', run: (events, context) => anonymitySetThin(events, context) },
  { id: 'repeated-amount', run: (events) => repeatedAmount(events) },
  { id: 'cadence-periodicity', run: (events) => cadencePeriodicity(events) },
]
