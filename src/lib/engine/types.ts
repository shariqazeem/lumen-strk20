/**
 * Shared vocabulary for the Lumen privacy & strategy engine.
 *
 * Everything here is plain data. The engine is a pure function of these
 * structures: no clocks, no randomness, no network. That is deliberate — the
 * same inputs must always produce the same plan so a user can audit why an
 * action was recommended, and so a regression is a failing test rather than a
 * surprise on mainnet.
 *
 * Note the deliberate absence of any `WITHDRAW` / `UNSHIELD` member on
 * `ActionType`: capital that enters the pool stays in the pool for the whole
 * strategy lifecycle. There is no type in this file that can express leaving.
 */

import type { TokenSymbol } from '@/lib/strk20/config'

export type { TokenSymbol }

/** A single spendable note held inside the STRK20 pool. */
export interface PrivateNote {
  commitment: string
  asset: TokenSymbol
  amount: bigint
  leafIndex: number
  nullifier: string
  /** ms epoch */
  timestamp: number
}

/**
 * How the planner trades expected return against expected privacy.
 * The mode is *only* a weighting; the machinery underneath is identical.
 */
export type StrategyMode =
  | 'PRIVACY_FIRST'
  | 'STEALTH_DCA'
  | 'WHALE_DISTRIBUTION'
  | 'YIELD_MAX'
  | 'BALANCED'

/** Every action the planner can express. None of them leave the pool. */
export type ActionType = 'SWAP' | 'LEND' | 'REBALANCE' | 'COMPACT'

/** Every venue the planner can express. All of them settle back into a note. */
export type Route = 'AVNU' | 'VESU' | 'EKUBO' | 'POOL'

/** One concrete, signable recommendation with its full justification. */
export interface ActionIntent {
  id: string
  type: ActionType
  sourceAsset: TokenSymbol
  targetAsset: TokenSymbol
  inputAmount: bigint
  minOutputAmount: bigint
  route: Route
  /** ms epoch */
  recommendedWindowStart: number
  /** ms epoch */
  recommendedWindowEnd: number
  /** Signed, in points of S_eff. Negative means this action costs privacy. */
  expectedPrivacyDelta: number
  expectedCostBps: number
  /** One human sentence explaining WHY this action, this size, this window. */
  rationale: string
}

/**
 * The five measured dimensions behind the effective privacy score.
 *
 * Two of them are stored RAW, where a higher number is WORSE:
 * `behavioralUniqueness` and `exitCorrelationRisk`. The published formula in
 * `computeEffectivePrivacy` is what inverts them. Keeping them raw here means
 * a UI can show "your uniqueness is 71/100" without double-negating.
 */
export interface ScoreBreakdown {
  /** 0-100, higher is better. */
  anonymitySet: number
  /** 0-100, higher is better. */
  amountEntropy: number
  /** 0-100, higher is better. */
  timingEntropy: number
  /** 0-100, RAW uniqueness — higher = MORE unique = WORSE. */
  behavioralUniqueness: number
  /** 0-100, RAW risk — higher = WORSE. */
  exitCorrelationRisk: number
}

/** Observed pool-wide background activity the user is trying to blend into. */
export interface PoolActivity {
  /** Observed note counts per denomination tier, most recent ~1000 blocks. */
  tierCounts: Record<string, number>
  /** Inter-arrival gaps (ms) of recent pool-wide operations. */
  interArrivalsMs: number[]
  totalNotes: number
}

/** One thing this wallet already did, as an observer could bucket it. */
export interface ActionRecord {
  /** ms epoch */
  timestamp: number
  asset: TokenSymbol
  amount: bigint
  type: ActionType
  route: Route
}
