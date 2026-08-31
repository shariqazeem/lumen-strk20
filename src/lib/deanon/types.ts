import type { TokenSymbol } from '@/lib/strk20/config'
import type { PoolActivity, StrategyMode } from '@/lib/engine/types'

/**
 * The adversary's vocabulary.
 *
 * A privacy pool hides the *link* between a deposit and a withdrawal — not the
 * legs themselves. Both are public, with amounts and addresses in the clear.
 * Every heuristic here re-forges that link statistically, without touching the
 * cryptography, which is how pool users actually get deanonymized.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type HeuristicId =
  | 'amount-correlation'
  | 'round-number'
  | 'timing-correlation'
  | 'split-sum-match'
  | 'anonymity-set-thin'
  | 'repeated-amount'
  | 'cadence-periodicity'
  | 'exit-amount-match'

/** A single public, observable fact about the target. */
export interface ObservedEvent {
  /** `deposit` and `withdrawal` are the public legs; `action` comes from the local ledger. */
  kind: 'deposit' | 'withdrawal' | 'action'
  asset: TokenSymbol
  /** Raw units. Zero when the amount is not recoverable. */
  amount: bigint
  /** False for in-pool actions, whose amounts are genuinely hidden. */
  amountKnown: boolean
  /** ms epoch */
  timestamp: number
  /** Denomination tier, or `'private'` when the amount is unknown. */
  tier: string
  txHash?: string
}

/** One way the target is linkable, with the remedy that closes it. */
export interface Finding {
  id: string
  heuristic: HeuristicId
  title: string
  severity: Severity
  /** 0..1 — how strongly this heuristic links the target. */
  confidence: number
  /** Plain English, citing the actual numbers involved. */
  explanation: string
  /** Concrete data points a reviewer can check. */
  evidence: string[]
  /** The remedy, mapped to something the planner can act on. */
  fix: { label: string; mode?: StrategyMode; action: string }
}

export type Band = 'exposed' | 'weak' | 'guarded' | 'shielded'

export interface DeanonReport {
  /** 0..100. Higher is worse: 100 means fully linkable. */
  linkabilityScore: number
  band: Band
  /** Most dangerous first. */
  findings: Finding[]
  /** How many public events the adversary had to work with. */
  observedCount: number
  summary: string
}

export interface HeuristicContext {
  /** ms epoch. Passed in so every heuristic stays pure and testable. */
  now: number
  pool: PoolActivity
}

export interface Heuristic {
  id: HeuristicId
  run: (events: ObservedEvent[], context: HeuristicContext) => Finding[]
}
