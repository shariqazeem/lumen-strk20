'use client'

/**
 * The silent guard — Lumen's privacy engine.
 *
 * The user never sees a score. For every action the app is about to perform,
 * the guard answers four questions internally:
 *
 *   1. Does this create a public record at all?
 *   2. Does this amount re-link me (round, reused, or matching a boundary
 *      crossing an observer can already see)?
 *   3. Does this publish a schedule (rigid cadence to one relationship)?
 *   4. Does this collapse the boundary between relationships (the same
 *      distinctive amount to two different people)?
 *
 * Where the answer is bad and the action is Lumen's own (a deposit, a
 * cash-out), the guard *rewrites* it — a nudged non-round amount, a suggested
 * wait — rather than lecturing. Where the amount is a contract with another
 * person (you typed "pay 150", so 150 must arrive), the guard only warns.
 *
 * All checks are pure and deterministic: same inputs, same review. The maths
 * is the deanonymization engine this codebase originally shipped as a product;
 * here it runs silently on the defender's side.
 */

import {
  AMOUNT_REUSE_WINDOW_MS,
  isAmountRecentlyUsed,
  isRoundAmount,
  mixSeed,
  mulberry32,
  recommendWindows,
  toTokenUnits,
  type RecentAmount,
  type TimeWindow,
} from '@/lib/engine'
import { coefficientOfVariation, PERIODICITY_CV_THRESHOLD } from '@/lib/deanon/heuristics'
import type { LedgerEntry } from '@/lib/history'
import { sameAddress, type TokenSymbol } from '@/lib/strk20/config'

export type CheckStatus = 'pass' | 'fixed' | 'warn'

export interface GuardCheck {
  id: string
  /** Short label shown in the protection pill when expanded. */
  label: string
  /** One human sentence. No jargon, no scores. */
  detail: string
  status: CheckStatus
}

export interface GuardReport {
  /**
   * protected — nothing links; tuned — the guard adjusted the action so
   * nothing links; attention — a linkage the guard cannot silently fix.
   */
  level: 'protected' | 'tuned' | 'attention'
  checks: GuardCheck[]
  /** Present when the guard rewrote the amount (deposit / cash-out only). */
  suggestedAmount?: bigint
  /** Present when acting later would break a timing correlation. */
  suggestedWindow?: TimeWindow
}

function levelOf(checks: readonly GuardCheck[]): GuardReport['level'] {
  if (checks.some((c) => c.status === 'warn')) return 'attention'
  if (checks.some((c) => c.status === 'fixed')) return 'tuned'
  return 'protected'
}

/* ------------------------------------------------------------------ */
/* amount hygiene                                                      */
/* ------------------------------------------------------------------ */

/** Ledger → the reuse-window shape the engine's predicate expects. */
function recentAmounts(ledger: readonly LedgerEntry[], token: TokenSymbol): RecentAmount[] {
  return ledger
    .filter((entry) => entry.asset === token)
    .map((entry) => ({ amount: entry.amount, timestamp: entry.timestamp }))
}

/**
 * Rewrite an amount so it is non-round, unused in the reuse window, and at
 * most the original (public boundary legs can only nudge DOWN — the user has
 * exactly this much on the table). Deterministic in the seed; bounded drift of
 * ~2% so the rewrite never surprises anyone.
 */
export function nudgeAmount(
  amount: bigint,
  decimals: number,
  seed: number,
  blocked: readonly RecentAmount[],
  now: number,
): bigint {
  if (amount <= 0n) return amount
  const grain = 10n ** BigInt(Math.max(0, decimals - 6))
  const rng = mulberry32(mixSeed(seed, Number(amount % 65_536n)))

  let candidate = amount
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bps = 3 + Math.floor(rng() * 190) // 0.03% – 1.93%
    const dust = BigInt(1 + Math.floor(rng() * 9)) * grain
    candidate = amount - (amount * BigInt(bps)) / 10_000n - dust
    if (candidate <= 0n) {
      candidate = amount - grain
      if (candidate <= 0n) return amount
    }
    const fine =
      !isRoundAmount(candidate, decimals) &&
      !isAmountRecentlyUsed(candidate, blocked, now, AMOUNT_REUSE_WINDOW_MS)
    if (fine) return candidate
  }
  return candidate
}

/* ------------------------------------------------------------------ */
/* reviews                                                             */
/* ------------------------------------------------------------------ */

export interface PayReviewInput {
  amount: bigint
  decimals: number
  token: TokenSymbol
  /** Normalized recipient address. */
  recipient: string
  ledger: readonly LedgerEntry[]
  now: number
}

/**
 * Review a private payment. The transfer itself has no public leg — no
 * sender, recipient or amount ever appears on-chain — so the checks here are
 * about the *relationship* layer: schedules and cross-boundary amount reuse,
 * the sequence-level provenance signals that survive perfect cryptography.
 */
export function reviewPay(input: PayReviewInput): GuardReport {
  const checks: GuardCheck[] = []

  checks.push({
    id: 'public-record',
    label: 'No public record',
    detail: 'This payment publishes nothing — no sender, no recipient, no amount.',
    status: 'pass',
  })

  // Cross-relationship reuse: the same distinctive amount to two different
  // people inside the reuse window lets the two recipients (or one observer
  // of both) tie your boundaries together.
  const distinctive = !isRoundAmount(input.amount, input.decimals)
  const crossReuse = input.ledger.some(
    (entry) =>
      entry.type === 'TRANSFER' &&
      entry.asset === input.token &&
      entry.amount === input.amount &&
      input.now - entry.timestamp <= AMOUNT_REUSE_WINDOW_MS &&
      entry.counterparty !== undefined &&
      !sameAddress(entry.counterparty, input.recipient),
  )
  if (crossReuse && distinctive) {
    checks.push({
      id: 'boundary',
      label: 'Relationship boundary',
      detail:
        'You sent this exact amount to someone else recently. A distinctive amount shared across relationships can tie them together — consider changing it slightly.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'boundary',
      label: 'Relationship boundary',
      detail: 'Nothing about this payment connects it to your other relationships.',
      status: 'pass',
    })
  }

  // Cadence: rigid rhythm to one person reads as a schedule. Rent is allowed
  // to be rhythmic — this is a gentle note, not a refusal.
  const gaps: number[] = []
  const toSame = input.ledger
    .filter(
      (entry) =>
        entry.type === 'TRANSFER' &&
        entry.counterparty !== undefined &&
        sameAddress(entry.counterparty, input.recipient),
    )
    .map((entry) => entry.timestamp)
    .sort((a, b) => a - b)
  const stamps = [...toSame, input.now]
  for (let i = 1; i < stamps.length; i += 1) gaps.push(stamps[i] - stamps[i - 1])

  if (gaps.length >= 3 && coefficientOfVariation(gaps) < PERIODICITY_CV_THRESHOLD) {
    checks.push({
      id: 'rhythm',
      label: 'No published schedule',
      detail:
        'Payments to this person land on a very regular rhythm. Shifting this one by a few hours keeps the pattern from becoming a signature.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'rhythm',
      label: 'No published schedule',
      detail: 'Your timing here has no rhythm an observer could latch onto.',
      status: 'pass',
    })
  }

  return { level: levelOf(checks), checks }
}

export interface ShieldReviewInput {
  amount: bigint
  decimals: number
  token: TokenSymbol
  /** Seed derived from the account, so rewrites are stable per user per day. */
  seed: number
  ledger: readonly LedgerEntry[]
  now: number
}

/**
 * Review a deposit. This is the public leg — the amount and the depositor are
 * visible to everyone forever — so amount hygiene is enforced by rewriting,
 * not by warning: round or repeated amounts are what re-link a deposit to a
 * later move.
 */
export function reviewShield(input: ShieldReviewInput): GuardReport {
  const checks: GuardCheck[] = []
  const recent = recentAmounts(input.ledger, input.token)

  const round = isRoundAmount(input.amount, input.decimals)
  const reused = isAmountRecentlyUsed(input.amount, recent, input.now, AMOUNT_REUSE_WINDOW_MS)

  let suggestedAmount: bigint | undefined
  if (round || reused) {
    suggestedAmount = nudgeAmount(input.amount, input.decimals, input.seed, recent, input.now)
    if (suggestedAmount === input.amount) suggestedAmount = undefined
  }

  if (suggestedAmount !== undefined) {
    const reason = round
      ? 'Round numbers stand out in public records.'
      : 'You used this exact amount recently.'
    checks.push({
      id: 'amount',
      label: 'Amount blends in',
      detail: `${reason} Lumen adjusted it slightly so this deposit looks like everyone else's.`,
      status: 'fixed',
    })
  } else if (round || reused) {
    // The nudge failed (amount too small to move). Surface it honestly.
    checks.push({
      id: 'amount',
      label: 'Amount blends in',
      detail:
        'This amount is distinctive and too small to adjust. It will be visible in the public deposit record.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'amount',
      label: 'Amount blends in',
      detail: 'This amount is non-round and fresh — it does not stand out in the deposit record.',
      status: 'pass',
    })
  }

  checks.push({
    id: 'separation',
    label: 'Separate from spending',
    detail:
      'Adding money is a standalone step. Nothing ties this deposit to anything you do privately afterwards.',
    status: 'pass',
  })

  const report: GuardReport = { level: levelOf(checks), checks }
  if (suggestedAmount !== undefined) report.suggestedAmount = suggestedAmount
  return report
}

export interface CashOutReviewInput {
  amount: bigint
  decimals: number
  token: TokenSymbol
  seed: number
  ledger: readonly LedgerEntry[]
  now: number
}

/** Tolerance for "these two public amounts are the same money", as a ratio. */
const EXIT_MATCH_TOLERANCE = 0.03

/**
 * Review a cash-out — the single most linkable thing a pool user can do, and
 * the heuristic that has undone mixer users for a decade: a withdrawal whose
 * amount mirrors a recent deposit collapses the anonymity set to one.
 */
export function reviewCashOut(input: CashOutReviewInput): GuardReport {
  const checks: GuardCheck[] = []
  const units = toTokenUnits(input.amount, input.decimals)

  // Exit ↔ entry amount correlation against every shield in the window.
  const matchedShield = input.ledger.find((entry) => {
    if (entry.type !== 'SHIELD' || entry.asset !== input.token) return false
    if (input.now - entry.timestamp > AMOUNT_REUSE_WINDOW_MS) return false
    const shieldUnits = toTokenUnits(entry.amount, input.decimals)
    if (shieldUnits <= 0) return false
    return Math.abs(shieldUnits - units) / shieldUnits <= EXIT_MATCH_TOLERANCE
  })

  let suggestedAmount: bigint | undefined
  if (matchedShield) {
    const recent = recentAmounts(input.ledger, input.token)
    const candidate = nudgeAmount(input.amount, input.decimals, input.seed, recent, input.now)
    if (candidate !== input.amount) suggestedAmount = candidate
    checks.push({
      id: 'exit-match',
      label: 'Entry and exit unlinked',
      detail:
        'This is almost exactly what you deposited recently. Matching amounts on the way in and out is the classic way private money gets traced — change the amount, or leave it inside longer.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'exit-match',
      label: 'Entry and exit unlinked',
      detail: 'This amount does not mirror any recent deposit.',
      status: 'pass',
    })
  }

  if (isRoundAmount(input.amount, input.decimals)) {
    checks.push({
      id: 'amount',
      label: 'Amount blends in',
      detail:
        'Round withdrawals stand out in the public record. A slightly uneven amount is harder to pick out.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'amount',
      label: 'Amount blends in',
      detail: 'The amount is non-round and does not stand out.',
      status: 'pass',
    })
  }

  // Timing: leaving moments after your last pool action stitches the two
  // events together. Suggest an irregular window from the engine.
  const lastAction = input.ledger.length > 0 ? input.ledger[0].timestamp : undefined
  const RECENT_MS = 45 * 60 * 1000
  let suggestedWindow: TimeWindow | undefined
  if (lastAction !== undefined && input.now - lastAction < RECENT_MS) {
    const windows = recommendWindows(1, {
      now: input.now,
      maxDelayMs: 6 * 60 * 60 * 1000,
      seed: input.seed,
      userGaps: [],
      poolGaps: [],
    })
    suggestedWindow = windows[0]
    checks.push({
      id: 'timing',
      label: 'Timing is quiet',
      detail:
        'You were just active. Cashing out immediately after ties the two moments together — waiting a few hours breaks the thread.',
      status: 'warn',
    })
  } else {
    checks.push({
      id: 'timing',
      label: 'Timing is quiet',
      detail: 'Enough time has passed since your last move.',
      status: 'pass',
    })
  }

  const report: GuardReport = { level: levelOf(checks), checks }
  if (suggestedAmount !== undefined) report.suggestedAmount = suggestedAmount
  if (suggestedWindow !== undefined) report.suggestedWindow = suggestedWindow
  return report
}

/**
 * Stable per-account seed, rotated daily. Rewrites are reproducible within a
 * day (auditable) without becoming a permanent per-user fingerprint.
 */
export function guardSeed(address: string, now: number): number {
  let base = 0
  try {
    base = Number(BigInt(address) % 2_147_483_647n)
  } catch {
    for (let i = 0; i < address.length; i += 1) base = (base * 33 + address.charCodeAt(i)) >>> 0
  }
  const day = Math.floor(now / 86_400_000)
  return mixSeed(base, day)
}
