/**
 * The Lumen effective-privacy score.
 *
 * The published formula, unchanged from the README:
 *
 *   S_eff = 0.30·A_set
 *         + 0.25·H_amount
 *         + 0.20·H_time
 *         + 0.15·(100 − U_behavior)
 *         + 0.10·(100 − R_exit)
 *
 * Every dimension is a pure function of observable data — the user's notes,
 * the user's own action history, and the pool's background activity. Nothing
 * here reads a clock or a random source, so a score is always reproducible
 * from the state that produced it.
 */

import { TOKENS } from '@/lib/strk20/config'
import type {
  ActionRecord,
  PoolActivity,
  PrivateNote,
  ScoreBreakdown,
  TokenSymbol,
} from './types'

/* ------------------------------------------------------------------ */
/* numeric helpers                                                     */
/* ------------------------------------------------------------------ */

/** Clamp to [0,1]; non-finite input collapses to 0. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Clamp to [0,100]; non-finite input collapses to 0. */
export function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0
  return x < 0 ? 0 : x > 100 ? 100 : x
}

/** Round to one decimal place. */
export function round1(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 10) / 10
}

/**
 * Convert a wei-denominated bigint to whole token units as a double.
 * Split at the decimal point so the integer part keeps full precision for as
 * long as a double can hold it, instead of `Number(x) / 1e18` which loses the
 * low digits of large balances before the divide even happens.
 */
export function toTokenUnits(amount: bigint, decimals = 18): number {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const base = 10n ** BigInt(Math.max(0, Math.trunc(decimals)))
  const whole = Number(abs / base)
  const frac = Number(abs % base) / Number(base)
  const value = whole + frac
  return negative ? -value : value
}

/** Convert whole token units back to a wei-denominated bigint (truncating). */
export function fromTokenUnits(units: number, decimals = 18): bigint {
  if (!Number.isFinite(units) || units === 0) return 0n
  const base = 10n ** BigInt(Math.max(0, Math.trunc(decimals)))
  const negative = units < 0
  const abs = Math.abs(units)
  const whole = Math.floor(abs)
  const frac = abs - whole
  const value = BigInt(whole) * base + BigInt(Math.floor(frac * Number(base)))
  return negative ? -value : value
}

/**
 * The decade bucket an amount falls into, e.g. `1e3` for 4,100 USDC.
 * This is the unit an observer counts in: two notes in the same tier are
 * mutually plausible covers for each other, notes in different tiers are not.
 */
export function denominationTier(amount: bigint, decimals = 18): string {
  const units = toTokenUnits(amount < 0n ? -amount : amount, decimals)
  if (!(units > 0)) return 'dust'
  const exponent = Math.floor(Math.log10(units))
  if (!Number.isFinite(exponent)) return 'dust'
  const clamped = Math.max(-9, Math.min(15, exponent))
  return `1e${clamped}`
}

/** Consecutive differences of a timestamp series, in ms, sorted ascending. */
export function gapsFrom(timestamps: readonly number[]): number[] {
  const sorted = [...timestamps].filter(Number.isFinite).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i += 1) gaps.push(sorted[i] - sorted[i - 1])
  return gaps
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function standardDeviation(values: readonly number[], mu: number): number {
  if (values.length === 0) return 0
  let acc = 0
  for (const v of values) acc += (v - mu) * (v - mu)
  return Math.sqrt(acc / values.length)
}

function maxOf(values: readonly number[]): number {
  let m = Number.NEGATIVE_INFINITY
  for (const v of values) if (v > m) m = v
  return Number.isFinite(m) ? m : 0
}

/** Relative difference in [0,1]; two zeros are treated as *not* matching. */
function relativeDifference(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (!(scale > 0)) return 1
  return Math.abs(a - b) / scale
}

/* ------------------------------------------------------------------ */
/* the published formula                                               */
/* ------------------------------------------------------------------ */

/** The five published weights. They sum to 1. */
export const PRIVACY_WEIGHTS = {
  anonymitySet: 0.3,
  amountEntropy: 0.25,
  timingEntropy: 0.2,
  behavioralUniqueness: 0.15,
  exitCorrelationRisk: 0.1,
} as const

/**
 * Apply the published S_eff formula to a breakdown.
 *
 * `behavioralUniqueness` and `exitCorrelationRisk` arrive RAW (higher = worse)
 * and are inverted here, which is the only place in the codebase that knows
 * about that inversion. Result is clamped to [0,100] and rounded to 1 decimal.
 */
export function computeEffectivePrivacy(breakdown: ScoreBreakdown): number {
  const total =
    PRIVACY_WEIGHTS.anonymitySet * clampScore(breakdown.anonymitySet) +
    PRIVACY_WEIGHTS.amountEntropy * clampScore(breakdown.amountEntropy) +
    PRIVACY_WEIGHTS.timingEntropy * clampScore(breakdown.timingEntropy) +
    PRIVACY_WEIGHTS.behavioralUniqueness * (100 - clampScore(breakdown.behavioralUniqueness)) +
    PRIVACY_WEIGHTS.exitCorrelationRisk * (100 - clampScore(breakdown.exitCorrelationRisk))
  return round1(clampScore(total))
}

/* ------------------------------------------------------------------ */
/* A_set — anonymity set                                               */
/* ------------------------------------------------------------------ */

/**
 * `min(100, (ln(nTier) / ln(nMax)) · 100)`.
 *
 * Logarithmic because the marginal privacy of the 900th cover note is far
 * smaller than that of the 9th. Returns 0 — never NaN or Infinity — when the
 * tier holds at most one note (you are the only member of your own set) or
 * when the pool's deepest tier holds at most one note.
 */
export function anonymitySetScore(nTier: number, nMax: number): number {
  if (!Number.isFinite(nTier) || !Number.isFinite(nMax)) return 0
  if (nTier <= 1 || nMax <= 1) return 0
  const ratio = Math.log(nTier) / Math.log(nMax)
  if (!Number.isFinite(ratio)) return 0
  return clampScore(ratio * 100)
}

/* ------------------------------------------------------------------ */
/* H_amount — amount entropy                                           */
/* ------------------------------------------------------------------ */

/**
 * Human-round magnitudes and how hard each one fingerprints you.
 * A wallet that moves exactly 1,000 USDC is announcing that a human typed it.
 */
const ROUND_MULTIPLES: ReadonlyArray<readonly [number, number]> = [
  [1000, 1],
  [100, 0.8],
  [50, 0.65],
  [10, 0.5],
]

/** Fraction by which a fully round split set is discounted. */
export const ROUNDNESS_MAX_PENALTY = 0.6

/** How round a token-unit amount looks to a human observer, in [0,1]. */
function roundnessPenalty(units: number): number {
  const u = Math.abs(units)
  if (!(u > 0) || !Number.isFinite(u)) return 0
  for (const [multiple, weight] of ROUND_MULTIPLES) {
    if (u < multiple) continue
    const remainder = u % multiple
    const tolerance = multiple * 1e-9
    if (remainder <= tolerance || multiple - remainder <= tolerance) return weight
  }
  return 0
}

/**
 * `100 · (1 − exp(−σ/μ))` over the splits in token units, discounted for
 * human-round values.
 *
 * The coefficient of variation is the right primitive here: an observer who
 * sees five notes of wildly different sizes cannot pair them up, while five
 * near-identical notes are trivially one wallet. Fewer than two splits, or a
 * mean of zero, scores 0 — a single note has no internal entropy to measure.
 *
 * `decimals` defaults to 18; pass the asset's real decimals so the round-number
 * detector is comparing against *token* units and not wei.
 */
export function amountEntropyScore(splits: readonly bigint[], decimals = 18): number {
  if (splits.length < 2) return 0
  const units = splits.map((s) => toTokenUnits(s, decimals))
  const mu = mean(units)
  if (!(mu > 0)) return 0
  const sigma = standardDeviation(units, mu)
  const cv = sigma / mu
  if (!Number.isFinite(cv)) return 0
  const base = 100 * (1 - Math.exp(-cv))
  const roundness = mean(units.map(roundnessPenalty))
  return clampScore(base * (1 - ROUNDNESS_MAX_PENALTY * clamp01(roundness)))
}

/* ------------------------------------------------------------------ */
/* H_time — timing entropy                                             */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Log-spaced bucket edges for inter-arrival gaps. Fixed rather than derived so
 * that a user histogram and the pool histogram are always directly comparable.
 * 8 edges => 9 buckets.
 */
export const TIMING_BUCKET_EDGES_MS: readonly number[] = [
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  HOUR,
  4 * HOUR,
  12 * HOUR,
  DAY,
  3 * DAY,
]

const TIMING_BUCKET_COUNT = TIMING_BUCKET_EDGES_MS.length + 1

function bucketGaps(gaps: readonly number[]): number[] {
  const counts = new Array<number>(TIMING_BUCKET_COUNT).fill(0)
  for (const gap of gaps) {
    let index = 0
    while (index < TIMING_BUCKET_EDGES_MS.length && gap >= TIMING_BUCKET_EDGES_MS[index]) index += 1
    counts[index] += 1
  }
  return counts
}

function toDistribution(counts: readonly number[]): number[] {
  let total = 0
  for (const c of counts) total += c
  if (total <= 0) return counts.map(() => 0)
  return counts.map((c) => c / total)
}

/** Shannon entropy in nats. */
function shannonNats(counts: readonly number[]): number {
  const p = toDistribution(counts)
  let h = 0
  for (const pi of p) if (pi > 0) h -= pi * Math.log(pi)
  return h
}

/** Jensen-Shannon divergence in bits, which is bounded to [0,1]. */
function jensenShannon(p: readonly number[], q: readonly number[]): number {
  const n = Math.max(p.length, q.length)
  let d = 0
  for (let i = 0; i < n; i += 1) {
    const pi = p[i] ?? 0
    const qi = q[i] ?? 0
    const mi = 0.5 * (pi + qi)
    if (pi > 0 && mi > 0) d += 0.5 * pi * Math.log2(pi / mi)
    if (qi > 0 && mi > 0) d += 0.5 * qi * Math.log2(qi / mi)
  }
  return clamp01(d)
}

/**
 * How unpredictable this wallet's execution rhythm is, 0-100.
 *
 * Three signals, combined: the normalized Shannon entropy of the user's gaps
 * bucketed on a log scale, the coefficient of variation of those gaps (a clock
 * that fires every 6 hours has zero entropy *and* zero variation, and must
 * score near the floor), and how closely the user's gap distribution resembles
 * the pool's background rhythm — matching the crowd is what blending in means.
 *
 * Fewer than two usable gaps returns a neutral 50: there is genuinely no
 * evidence either way, and pretending otherwise would move the headline score
 * on the strength of a single observation.
 */
export function timingEntropyScore(
  userGaps: readonly number[],
  poolGaps: readonly number[],
): number {
  const gaps = userGaps.filter((g) => Number.isFinite(g) && g > 0)
  if (gaps.length < 2) return 50

  const userCounts = bucketGaps(gaps)
  const normalizer = Math.log(Math.min(TIMING_BUCKET_COUNT, gaps.length))
  const histogramEntropy = normalizer > 0 ? shannonNats(userCounts) / normalizer : 0

  const mu = mean(gaps)
  const cv = mu > 0 ? standardDeviation(gaps, mu) / mu : 0
  const irregularity = 1 - Math.exp(-cv)

  const own = 0.6 * clamp01(histogramEntropy) + 0.4 * clamp01(irregularity)

  const background = poolGaps.filter((g) => Number.isFinite(g) && g > 0)
  if (background.length < 2) return clampScore(100 * own)

  const blend = 1 - jensenShannon(toDistribution(userCounts), toDistribution(bucketGaps(background)))
  return clampScore(100 * (0.7 * own + 0.3 * clamp01(blend)))
}

/* ------------------------------------------------------------------ */
/* U_behavior — behavioral uniqueness (RAW: higher is worse)           */
/* ------------------------------------------------------------------ */

/** Weights inside the uniqueness composite. */
const UNIQUENESS_WEIGHTS = { repeat: 0.45, clock: 0.3, rarity: 0.25 } as const

function behaviorKey(record: ActionRecord): string {
  const decimals = TOKENS[record.asset].decimals
  return `${record.asset}|${record.route}|${denominationTier(record.amount, decimals)}`
}

/**
 * How distinguishable this wallet's habits are, 0-100 RAW — higher is WORSE.
 *
 * Rises on three habits an adversary actually clusters on: repeating the same
 * (asset, route, amount-tier) triple, always acting inside the same three-hour
 * slice of the day (UTC), and living in denomination tiers the pool barely
 * uses. Empty history scores 0, because a wallet that has done nothing has no
 * behaviour to be unique about.
 */
export function behavioralUniquenessScore(
  history: readonly ActionRecord[],
  pool: PoolActivity,
): number {
  const n = history.length
  if (n === 0) return 0
  const spread = Math.max(1, n - 1)

  const tripleCounts = new Map<string, number>()
  for (const record of history) {
    const key = behaviorKey(record)
    tripleCounts.set(key, (tripleCounts.get(key) ?? 0) + 1)
  }
  const maxTriple = maxOf([...tripleCounts.values()])
  const repeat = (maxTriple - 1) / spread

  const hours = new Array<number>(24).fill(0)
  for (const record of history) {
    const hour = new Date(record.timestamp).getUTCHours()
    if (Number.isFinite(hour)) hours[hour] += 1
  }
  let maxWindow = 0
  for (let h = 0; h < 24; h += 1) {
    const window = hours[(h + 23) % 24] + hours[h] + hours[(h + 1) % 24]
    if (window > maxWindow) maxWindow = window
  }
  const clock = (maxWindow - 1) / spread

  const tierValues = Object.values(pool.tierCounts)
  let rarity = 0.5
  if (pool.totalNotes > 0 && tierValues.length > 0) {
    const deepest = Math.max(2, maxOf(tierValues))
    let acc = 0
    for (const record of history) {
      const tier = denominationTier(record.amount, TOKENS[record.asset].decimals)
      const count = pool.tierCounts[tier] ?? 0
      acc += count <= 1 ? 1 : clamp01(1 - Math.log(count) / Math.log(deepest))
    }
    rarity = acc / n
  }

  return clampScore(
    100 *
      (UNIQUENESS_WEIGHTS.repeat * clamp01(repeat) +
        UNIQUENESS_WEIGHTS.clock * clamp01(clock) +
        UNIQUENESS_WEIGHTS.rarity * clamp01(rarity)),
  )
}

/* ------------------------------------------------------------------ */
/* R_exit — exit correlation risk (RAW: higher is worse)               */
/* ------------------------------------------------------------------ */

/** Two amounts within this relative distance are treated as the same value. */
export const AMOUNT_MATCH_TOLERANCE = 0.03
/** How far back an amount match still links two actions. */
export const EXIT_MATCH_WINDOW_MS = 48 * HOUR
/** Actions closer together than this are assumed to be one logical operation. */
export const CHAIN_WINDOW_MS = 10 * MINUTE
/** Window in which a same-size, different-asset hop reads as value relaying. */
export const RELAY_WINDOW_MS = HOUR
/** Tolerance for the relay heuristic, looser than a plain amount match. */
export const RELAY_TOLERANCE = 0.05

/**
 * How linkable this wallet's actions are to each other, 0-100 RAW — higher is
 * WORSE.
 *
 * Three classic chain-analysis heuristics: a value that goes out matching a
 * value that recently came in (graded by how close the match is), actions that
 * chain inside a few minutes so they are obviously one operation, and a
 * same-size hop into a different asset inside an hour, which reads as value
 * being relayed rather than held. Empty history scores 0.
 */
export function exitCorrelationScore(history: readonly ActionRecord[]): number {
  const n = history.length
  if (n === 0) return 0

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp)
  const units = sorted.map((r) => toTokenUnits(r.amount, TOKENS[r.asset].decimals))

  let matchAcc = 0
  for (let j = 0; j < n; j += 1) {
    let best = 0
    for (let i = 0; i < j; i += 1) {
      if (sorted[j].timestamp - sorted[i].timestamp > EXIT_MATCH_WINDOW_MS) continue
      const rel = relativeDifference(units[i], units[j])
      if (rel <= AMOUNT_MATCH_TOLERANCE) {
        const closeness = 1 - rel / AMOUNT_MATCH_TOLERANCE
        if (closeness > best) best = closeness
      }
    }
    matchAcc += best
  }
  const matchFraction = matchAcc / n

  let chainAcc = 0
  let relayAcc = 0
  for (let i = 1; i < n; i += 1) {
    const gap = sorted[i].timestamp - sorted[i - 1].timestamp
    if (gap >= 0 && gap < CHAIN_WINDOW_MS) chainAcc += 1 - gap / CHAIN_WINDOW_MS
    if (gap < 0 || gap > RELAY_WINDOW_MS) continue
    if (sorted[i].asset === sorted[i - 1].asset) continue
    if (relativeDifference(units[i - 1], units[i]) <= RELAY_TOLERANCE) relayAcc += 1
  }
  const chainFraction = n > 1 ? chainAcc / (n - 1) : 0
  const relayFraction = n > 1 ? relayAcc / (n - 1) : 0

  return clampScore(
    100 * clamp01(0.5 * matchFraction + 0.3 * chainFraction + 0.2 * relayFraction),
  )
}

/* ------------------------------------------------------------------ */
/* composition                                                         */
/* ------------------------------------------------------------------ */

/**
 * Anonymity across the whole note set, weighted 60/40 toward the *weakest*
 * note. An adversary does not attack your average note, they attack the one
 * that sits alone in its tier.
 */
function anonymitySetDimension(notes: readonly PrivateNote[], pool: PoolActivity): number {
  if (notes.length === 0) return 0
  const deepest = maxOf(Object.values(pool.tierCounts))
  let weakest = 100
  let acc = 0
  for (const note of notes) {
    const decimals = TOKENS[note.asset].decimals
    const tier = denominationTier(note.amount, decimals)
    const score = anonymitySetScore(pool.tierCounts[tier] ?? 0, deepest)
    if (score < weakest) weakest = score
    acc += score
  }
  return clampScore(0.6 * weakest + 0.4 * (acc / notes.length))
}

/**
 * Amount entropy across a multi-asset note set: scored per asset (so a 6-decimal
 * USDC note is never compared against an 18-decimal STRK note) then averaged by
 * note count.
 */
function amountEntropyDimension(notes: readonly PrivateNote[]): number {
  if (notes.length < 2) return 0
  const byAsset = new Map<TokenSymbol, bigint[]>()
  for (const note of notes) {
    const bucket = byAsset.get(note.asset)
    if (bucket) bucket.push(note.amount)
    else byAsset.set(note.asset, [note.amount])
  }
  let acc = 0
  let weight = 0
  for (const [asset, amounts] of byAsset) {
    if (amounts.length < 2) continue
    acc += amountEntropyScore(amounts, TOKENS[asset].decimals) * amounts.length
    weight += amounts.length
  }
  return weight > 0 ? clampScore(acc / weight) : 0
}

/**
 * Compose all five dimensions from raw engine state.
 * Feed the result to `computeEffectivePrivacy` for the headline number.
 */
export function scoreFromState(
  history: readonly ActionRecord[],
  notes: readonly PrivateNote[],
  pool: PoolActivity,
): ScoreBreakdown {
  return {
    anonymitySet: anonymitySetDimension(notes, pool),
    amountEntropy: amountEntropyDimension(notes),
    timingEntropy: timingEntropyScore(
      gapsFrom(history.map((h) => h.timestamp)),
      pool.interArrivalsMs,
    ),
    behavioralUniqueness: behavioralUniquenessScore(history, pool),
    exitCorrelationRisk: exitCorrelationScore(history),
  }
}

/** Convenience: state in, single number out. */
export function effectivePrivacyFromState(
  history: readonly ActionRecord[],
  notes: readonly PrivateNote[],
  pool: PoolActivity,
): number {
  return computeEffectivePrivacy(scoreFromState(history, notes, pool))
}
