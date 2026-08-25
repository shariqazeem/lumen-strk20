/**
 * The Lumen strategy engine.
 *
 * `generatePlan` turns state (notes, history, pool activity, a strategy mode)
 * into an ordered list of signable intents, each with an exact amount, an
 * irregular execution window, a route, and one sentence saying why.
 *
 * Four constraints are load-bearing and are enforced here rather than trusted
 * to the caller:
 *
 *   1. There is no unshield path. Not "off by default" — the planner cannot
 *      express leaving the pool, `assertNoUnshield` re-checks every intent
 *      before it is returned, and the only routes it emits settle back into a
 *      private note.
 *   2. No exact amount used inside 48h is ever emitted again.
 *   3. Any action whose projected S_eff would fall below `privacyFloor` is
 *      omitted and reported in `PlanResult.refused`, so a refusal is visible
 *      to the caller instead of silently shrinking the plan.
 *   4. A denomination tier holding more than `maxNotesPerTier` notes is
 *      compacted *before* anything adds to it.
 *
 * Strategy modes differ in exactly one place: the two weights they put on
 * expected return versus expected privacy delta. Candidate campaigns are
 * evaluated identically for every mode; only the argmax changes.
 */

import { TOKEN_LIST, TOKENS, sameAddress } from '@/lib/strk20/config'
import {
  AMOUNT_REUSE_WINDOW_MS,
  isAmountRecentlyUsed,
  mixSeed,
  splitAmount,
  type RecentAmount,
} from './amount-splitter'
import {
  clamp01,
  clampScore,
  computeEffectivePrivacy,
  denominationTier,
  fromTokenUnits,
  gapsFrom,
  round1,
  scoreFromState,
  toTokenUnits,
} from './privacy-score'
import { recommendWindows, type TimeWindow } from './timing'
import type {
  ActionIntent,
  ActionRecord,
  ActionType,
  PoolActivity,
  PrivateNote,
  Route,
  ScoreBreakdown,
  StrategyMode,
  TokenSymbol,
} from './types'

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** Every action type the planner may emit. There is no unshield member. */
export const PLANNER_ACTION_TYPES: readonly ActionType[] = ['SWAP', 'LEND', 'REBALANCE', 'COMPACT']

/** Every route the planner may emit. All of them settle back into a note. */
export const IN_POOL_ROUTES: readonly Route[] = ['AVNU', 'VESU', 'EKUBO', 'POOL']

/** One point of S_eff is priced at this many bps when trading off return. */
export const PRIVACY_POINT_BPS = 100

export const DEFAULT_MAX_NOTES_PER_TIER = 4
export const DEFAULT_MAX_DELAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_MAX_ACTIONS = 12
/** Holding period the planner amortises lending yield over. */
export const DEFAULT_HORIZON_DAYS = 30
export const DEFAULT_SLIPPAGE_BPS = 50

/** Compactions are scheduled inside this shorter horizon so they land first. */
const COMPACTION_HORIZON_MS = 6 * 60 * 60 * 1000

/**
 * Shape used only to *rank* campaigns. It is deliberately mode-independent so
 * every mode ranks the same candidate set and the only difference between modes
 * is the weighting — which is what makes "YIELD_MAX never picks a worse-yielding
 * route than PRIVACY_FIRST" a property rather than a coincidence.
 */
const NOMINAL_DEPLOY_FRACTION = 0.4
const NOMINAL_TRANCHES = 4

/** Anything mentioning an exit is a bug, not a feature. */
const UNSHIELD_PATTERN = /\b(unshield|de-?shield|withdraw(al|n|s)?|redeem to public|exit to public)\b/i

/* ------------------------------------------------------------------ */
/* economics                                                           */
/* ------------------------------------------------------------------ */

export interface RouteEconomics {
  /**
   * For lending routes this is the supply APY in bps, amortised over
   * `horizonDays`. For swap routes it is the one-off routing edge in bps.
   */
  returnBps: number
  /** One-off execution cost in bps, before size-dependent price impact. */
  costBps: number
}

/**
 * Conservative defaults. A caller with live quotes should override these —
 * they are a ranking prior, not a promise about fills.
 */
export const DEFAULT_ROUTE_ECONOMICS: Record<Route, RouteEconomics> = {
  AVNU: { returnBps: 0, costBps: 25 },
  EKUBO: { returnBps: 8, costBps: 30 },
  VESU: { returnBps: 420, costBps: 12 },
  POOL: { returnBps: 0, costBps: 6 },
}

/** Routes whose `returnBps` is an annualised yield rather than a one-off edge. */
const ANNUALISED_ROUTES: readonly Route[] = ['VESU']

export interface ModeProfile {
  /** Weight on expected financial return. Always `1 - privacyWeight`. */
  returnWeight: number
  /** Weight on expected privacy delta. Always `1 - returnWeight`. */
  privacyWeight: number
  /**
   * Share of the source holding this mode is willing to deploy in one plan.
   * Orthogonal to the return/privacy trade-off: it is position sizing, not
   * preference.
   */
  deployFraction: number
}

/**
 * The only thing a strategy mode changes.
 * Tranche count and window spread are *derived* from `privacyWeight`, so there
 * is no second, hidden knob per mode.
 */
export const MODE_PROFILES: Record<StrategyMode, ModeProfile> = {
  PRIVACY_FIRST: { returnWeight: 0.1, privacyWeight: 0.9, deployFraction: 0.35 },
  STEALTH_DCA: { returnWeight: 0.35, privacyWeight: 0.65, deployFraction: 0.2 },
  WHALE_DISTRIBUTION: { returnWeight: 0.25, privacyWeight: 0.75, deployFraction: 0.8 },
  YIELD_MAX: { returnWeight: 0.8, privacyWeight: 0.2, deployFraction: 0.6 },
  BALANCED: { returnWeight: 0.5, privacyWeight: 0.5, deployFraction: 0.45 },
}

/**
 * Tranche count derived from the privacy weight alone: 2 tranches at pure
 * return-seeking, 10 at pure privacy-seeking.
 */
export function trancheCountFor(privacyWeight: number): number {
  return Math.max(2, Math.min(10, Math.round(2 + 8 * clamp01(privacyWeight))))
}

/* ------------------------------------------------------------------ */
/* input / output                                                      */
/* ------------------------------------------------------------------ */

export interface PlannerInput {
  mode: StrategyMode
  /** ms epoch. Passed in, never read from a clock, so plans are reproducible. */
  now: number
  /** Seed for every deterministic choice in the plan. */
  seed: number
  notes: readonly PrivateNote[]
  history: readonly ActionRecord[]
  pool: PoolActivity
  /** Projected S_eff must stay at or above this after every emitted action. */
  privacyFloor: number
  /** Asset to accumulate. Defaults to the deepest counter-asset of the source. */
  targetAsset?: TokenSymbol
  /** Compaction trigger. Defaults to 4. */
  maxNotesPerTier?: number
  /** Nothing is scheduled beyond `now + maxDelayMs`. Defaults to 24h. */
  maxDelayMs?: number
  /** Hard cap on emitted intents. Defaults to 12. */
  maxActions?: number
  routeEconomics?: Partial<Record<Route, Partial<RouteEconomics>>>
  /**
   * Reference prices (any consistent unit, e.g. USD per token). Required for
   * cross-asset swaps: without them there is no honest `minOutputAmount` and
   * the planner refuses the swap rather than emitting an unprotected one.
   */
  prices?: Partial<Record<TokenSymbol, number>>
  /** Slippage allowance folded into `minOutputAmount`. Defaults to 50 bps. */
  slippageBps?: number
  /** Holding period used to amortise annualised yields. Defaults to 30 days. */
  horizonDays?: number
}

/** An action the planner considered and deliberately did not emit. */
export interface RefusedAction {
  reason: string
  /** The S_eff this action would have left the wallet on. */
  wouldScore: number
  type: ActionType
  route: Route
  asset: TokenSymbol
  amount: bigint
}

/** The campaign the mode's weights selected, and why it won. */
export interface SelectedCampaign {
  type: ActionType
  route: Route
  sourceAsset: TokenSymbol
  targetAsset: TokenSymbol
  /** Expected return minus expected cost, in bps, over `horizonDays`. */
  netReturnBps: number
  /** Points of S_eff a nominal tranche of this campaign was projected to add. */
  privacyDeltaEstimate: number
  /** `returnWeight·netReturnBps + privacyWeight·privacyDelta·PRIVACY_POINT_BPS` */
  utility: number
}

export interface PlanResult {
  intents: ActionIntent[]
  refused: RefusedAction[]
  /** S_eff of the current state, before any planned action. */
  baselineScore: number
  /** S_eff projected after every emitted intent has executed, in order. */
  projectedScore: number
  /** The breakdown behind `baselineScore`. */
  baselineBreakdown: ScoreBreakdown
  mode: StrategyMode
  /** Undefined when no campaign survived evaluation. */
  campaign?: SelectedCampaign
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Resolve a token from either its symbol or its mainnet address. */
export function resolveTokenSymbol(assetOrAddress: string): TokenSymbol | undefined {
  const bySymbol = TOKEN_LIST.find((t) => t.symbol === assetOrAddress)
  if (bySymbol) return bySymbol.symbol
  return TOKEN_LIST.find((t) => sameAddress(t.address, assetOrAddress))?.symbol
}

function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Format a wei amount as a grouped decimal string, e.g. `4,100.37`. */
export function formatAmount(amount: bigint, decimals: number, maxFraction = 2): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const base = 10n ** BigInt(Math.max(0, decimals))
  const whole = groupDigits((abs / base).toString())
  if (maxFraction <= 0) return `${negative ? '-' : ''}${whole}`
  const scaled = ((abs % base) * 10n ** BigInt(maxFraction)) / base
  const fraction = scaled.toString().padStart(maxFraction, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

/** Human duration, e.g. `3h 12m`, `41m`, `2d 4h`. */
export function describeDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}

function signed(x: number): string {
  const value = round1(x)
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`
}

function economicsFor(route: Route, overrides: PlannerInput['routeEconomics']): RouteEconomics {
  const base = DEFAULT_ROUTE_ECONOMICS[route]
  const override = overrides?.[route]
  return {
    returnBps: override?.returnBps ?? base.returnBps,
    costBps: override?.costBps ?? base.costBps,
  }
}

/**
 * Size-dependent price impact, in bps. A heuristic prior on notional depth —
 * a caller with a live quote should override `costBps` instead of relying on it.
 */
function priceImpactBps(notional: number): number {
  if (!(notional > 0)) return 0
  return Math.min(120, Math.round(Math.sqrt(notional / 1000) * 6))
}

function notionalOf(
  amount: bigint,
  asset: TokenSymbol,
  prices: PlannerInput['prices'],
): number {
  const units = toTokenUnits(amount, TOKENS[asset].decimals)
  const price = prices?.[asset]
  return price && price > 0 ? units * price : units
}

/**
 * The floor on what an intent must return. Same-asset actions keep their size
 * minus fees. Cross-asset swaps need reference prices — without them there is
 * no honest floor, so this returns null and the caller refuses the action
 * rather than emitting a swap with no slippage protection.
 */
function projectOutput(
  input: bigint,
  source: TokenSymbol,
  target: TokenSymbol,
  haircutBps: number,
  prices: PlannerInput['prices'],
): bigint | null {
  const keep = 10_000n - BigInt(Math.max(0, Math.min(9_999, Math.round(haircutBps))))
  if (source === target) return (input * keep) / 10_000n
  const from = prices?.[source]
  const to = prices?.[target]
  if (!from || !to || !(from > 0) || !(to > 0)) return null
  const units = toTokenUnits(input, TOKENS[source].decimals) * (from / to)
  return (fromTokenUnits(units, TOKENS[target].decimals) * keep) / 10_000n
}

/** Yield routes quote an APY; amortise it over the plan's holding period. */
function realisedReturnBps(route: Route, economics: RouteEconomics, horizonDays: number): number {
  if (!ANNUALISED_ROUTES.includes(route)) return economics.returnBps
  return (economics.returnBps * Math.max(0, horizonDays)) / 365
}

/* ------------------------------------------------------------------ */
/* projection                                                          */
/* ------------------------------------------------------------------ */

interface SimState {
  notes: PrivateNote[]
  history: ActionRecord[]
}

function noteKey(note: PrivateNote): string {
  return `${note.commitment}#${note.leafIndex}`
}

function nextLeafIndex(notes: readonly PrivateNote[]): number {
  let max = -1
  for (const n of notes) if (n.leafIndex > max) max = n.leafIndex
  return max + 1
}

/**
 * A note that only exists inside a projection. It is never signed and never
 * leaves the planner — the commitment is a label, not a real Poseidon hash.
 */
function projectedNote(
  base: readonly PrivateNote[],
  asset: TokenSymbol,
  amount: bigint,
  timestamp: number,
  tag: string,
): PrivateNote {
  return {
    commitment: `lumen:projected:${tag}`,
    asset,
    amount,
    leafIndex: nextLeafIndex(base),
    nullifier: `lumen:projected-nullifier:${tag}`,
    timestamp,
  }
}

/**
 * Apply an action to a state and return the new state, or null when the note
 * set cannot fund it. Notes are spent largest-first with a change note, which
 * is how the pool actually behaves.
 */
function applyAction(
  state: SimState,
  params: {
    type: ActionType
    route: Route
    sourceAsset: TokenSymbol
    targetAsset: TokenSymbol
    inputAmount: bigint
    outputAmount: bigint
    timestamp: number
    tag: string
    consume?: readonly PrivateNote[]
  },
): SimState | null {
  let kept: PrivateNote[]
  if (params.consume) {
    const doomed = new Set(params.consume.map(noteKey))
    kept = state.notes.filter((n) => !doomed.has(noteKey(n)))
  } else {
    const candidates = state.notes
      .filter((n) => n.asset === params.sourceAsset)
      .sort((a, b) => (a.amount === b.amount ? a.leafIndex - b.leafIndex : a.amount > b.amount ? -1 : 1))
    let collected = 0n
    const doomed = new Set<string>()
    for (const note of candidates) {
      doomed.add(noteKey(note))
      collected += note.amount
      if (collected >= params.inputAmount) break
    }
    if (collected < params.inputAmount) return null
    kept = state.notes.filter((n) => !doomed.has(noteKey(n)))
    const change = collected - params.inputAmount
    if (change > 0n) {
      kept.push(projectedNote(state.notes, params.sourceAsset, change, params.timestamp, `${params.tag}-change`))
    }
  }

  if (params.outputAmount > 0n) {
    kept.push(
      projectedNote(kept, params.targetAsset, params.outputAmount, params.timestamp, `${params.tag}-out`),
    )
  }

  return {
    notes: kept,
    history: [
      ...state.history,
      {
        timestamp: params.timestamp,
        asset: params.sourceAsset,
        amount: params.inputAmount,
        type: params.type,
        route: params.route,
      },
    ],
  }
}

/* ------------------------------------------------------------------ */
/* rationale writing                                                   */
/* ------------------------------------------------------------------ */

interface PriorCollision {
  count: number
  amount: bigint
}

/**
 * The most-repeated amount this wallet exposed on `asset` inside the reuse
 * window. This is the concrete fact a tranche rationale cites.
 */
function priorCollision(
  history: readonly ActionRecord[],
  asset: TokenSymbol,
  now: number,
  windowMs: number,
): PriorCollision | null {
  const counts = new Map<string, number>()
  for (const record of history) {
    if (record.asset !== asset) continue
    const age = now - record.timestamp
    if (age < 0 || age > windowMs) continue
    const key = record.amount.toString()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey: string | null = null
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && bestKey !== null && key < bestKey)) {
      bestKey = key
      bestCount = count
    }
  }
  if (bestKey === null || bestCount === 0) return null
  return { count: bestCount, amount: BigInt(bestKey) }
}

/* ------------------------------------------------------------------ */
/* guard                                                               */
/* ------------------------------------------------------------------ */

/**
 * Throw if any intent could move value out of the pool. Called on every plan
 * before it is returned. This is a tripwire, not the primary defence — the
 * primary defence is that `ActionType` and `Route` cannot express an exit.
 */
export function assertNoUnshield(intents: readonly ActionIntent[]): void {
  for (const intent of intents) {
    if (!PLANNER_ACTION_TYPES.includes(intent.type)) {
      throw new Error(
        `Lumen planner emitted action type "${intent.type}" on intent ${intent.id}; the planner has no unshield path.`,
      )
    }
    if (!IN_POOL_ROUTES.includes(intent.route)) {
      throw new Error(
        `Lumen planner emitted route "${intent.route}" on intent ${intent.id}; every route must settle back into a private note.`,
      )
    }
    if (UNSHIELD_PATTERN.test(intent.rationale)) {
      throw new Error(
        `Lumen planner justified intent ${intent.id} with an exit: ${intent.rationale}`,
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* the planner                                                         */
/* ------------------------------------------------------------------ */

interface Candidate {
  type: ActionType
  route: Route
  sourceAsset: TokenSymbol
  targetAsset: TokenSymbol
  netReturnBps: number
  privacyDelta: number
  utility: number
}

function totalBalance(notes: readonly PrivateNote[], asset: TokenSymbol): bigint {
  let sum = 0n
  for (const note of notes) if (note.asset === asset) sum += note.amount
  return sum
}

/** Largest holding by notional, ties broken by the canonical token order. */
function pickSourceAsset(
  notes: readonly PrivateNote[],
  prices: PlannerInput['prices'],
): TokenSymbol | null {
  let best: TokenSymbol | null = null
  let bestNotional = 0
  for (const token of TOKEN_LIST) {
    const balance = totalBalance(notes, token.symbol)
    if (balance <= 0n) continue
    const notional = notionalOf(balance, token.symbol, prices)
    if (notional > bestNotional) {
      bestNotional = notional
      best = token.symbol
    }
  }
  return best
}

/**
 * Build the plan.
 *
 * Deterministic: identical input always yields an identical `PlanResult`.
 * Returns a `PlanResult` rather than a bare array so that refusals — the
 * actions the privacy floor blocked — are visible instead of silently missing.
 */
export function generatePlan(input: PlannerInput): PlanResult {
  const profile = MODE_PROFILES[input.mode]
  const maxNotesPerTier = Math.max(1, input.maxNotesPerTier ?? DEFAULT_MAX_NOTES_PER_TIER)
  const maxDelayMs = Math.max(60_000, input.maxDelayMs ?? DEFAULT_MAX_DELAY_MS)
  const maxActions = Math.max(0, input.maxActions ?? DEFAULT_MAX_ACTIONS)
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  const floor = clampScore(input.privacyFloor)
  const now = input.now

  let state: SimState = { notes: [...input.notes], history: [...input.history] }
  const baselineBreakdown = scoreFromState(state.history, state.notes, input.pool)
  const baselineScore = computeEffectivePrivacy(baselineBreakdown)

  const intents: ActionIntent[] = []
  const refused: RefusedAction[] = []
  let currentScore = baselineScore
  let sequence = 0

  const nextId = (type: ActionType): string =>
    `lumen-${input.seed}-${String(sequence++).padStart(2, '0')}-${type.toLowerCase()}`

  /**
   * Amounts that must not be re-used: history inside the 48h window, plus the
   * amounts this plan itself commits to as it goes. Future-dated records count
   * as live — they are pending, not expired — matching `isAmountRecentlyUsed`.
   */
  const usedAmounts: RecentAmount[] = input.history
    .filter((r) => {
      const age = now - r.timestamp
      return age < 0 || age <= AMOUNT_REUSE_WINDOW_MS
    })
    .map((r) => ({ amount: r.amount, timestamp: r.timestamp }))

  const poolGaps = input.pool.interArrivalsMs
  const userGaps = gapsFrom(input.history.map((r) => r.timestamp))

  /* ---- 1. compaction, always first ---- */

  interface TierGroup {
    asset: TokenSymbol
    tier: string
    notes: PrivateNote[]
  }

  const groups = new Map<string, TierGroup>()
  for (const note of state.notes) {
    const tier = denominationTier(note.amount, TOKENS[note.asset].decimals)
    const key = `${note.asset}|${tier}`
    const existing = groups.get(key)
    if (existing) existing.notes.push(note)
    else groups.set(key, { asset: note.asset, tier, notes: [note] })
  }
  const overfull = [...groups.values()]
    .filter((g) => g.notes.length > maxNotesPerTier)
    .sort((a, b) => (a.asset === b.asset ? a.tier.localeCompare(b.tier) : a.asset.localeCompare(b.asset)))

  const compactionWindows = recommendWindows(overfull.length, {
    now,
    maxDelayMs: Math.min(maxDelayMs, COMPACTION_HORIZON_MS),
    seed: mixSeed(input.seed, 11),
    userGaps,
    poolGaps,
  })

  let compactionEnd = now
  for (let i = 0; i < overfull.length; i += 1) {
    if (intents.length >= maxActions) break
    const group = overfull[i]
    const window = compactionWindows[i]
    if (!window) break
    compactionEnd = Math.max(compactionEnd, window.end)

    const decimals = TOKENS[group.asset].decimals
    const merged = group.notes.reduce((a, n) => a + n.amount, 0n)
    const economics = economicsFor('POOL', input.routeEconomics)
    const costBps = economics.costBps
    const output = projectOutput(merged, group.asset, group.asset, costBps, input.prices)
    if (output === null || output <= 0n) continue

    const projectedState = applyAction(state, {
      type: 'COMPACT',
      route: 'POOL',
      sourceAsset: group.asset,
      targetAsset: group.asset,
      inputAmount: merged,
      outputAmount: output,
      timestamp: window.start,
      tag: `compact-${i}`,
      consume: group.notes,
    })
    if (!projectedState) continue

    const projectedScore = computeEffectivePrivacy(
      scoreFromState(projectedState.history, projectedState.notes, input.pool),
    )

    if (projectedScore < floor) {
      refused.push({
        reason: `Compacting ${group.notes.length} ${group.asset} notes in the ${group.tier} tier would leave effective privacy at ${projectedScore}, under the ${floor} floor.`,
        wouldScore: projectedScore,
        type: 'COMPACT',
        route: 'POOL',
        asset: group.asset,
        amount: merged,
      })
      continue
    }

    if (isAmountRecentlyUsed(merged, usedAmounts, now)) {
      refused.push({
        reason: `Compacting the ${group.tier} ${group.asset} tier would re-expose the exact amount ${formatAmount(merged, decimals)} ${group.asset}, already used inside 48h.`,
        wouldScore: projectedScore,
        type: 'COMPACT',
        route: 'POOL',
        asset: group.asset,
        amount: merged,
      })
      continue
    }

    const poolTierCount = input.pool.tierCounts[group.tier] ?? 0
    intents.push({
      id: nextId('COMPACT'),
      type: 'COMPACT',
      sourceAsset: group.asset,
      targetAsset: group.asset,
      inputAmount: merged,
      minOutputAmount: output,
      route: 'POOL',
      recommendedWindowStart: window.start,
      recommendedWindowEnd: window.end,
      expectedPrivacyDelta: round1(projectedScore - currentScore),
      expectedCostBps: costBps,
      rationale: `Merging ${group.notes.length} ${group.asset} notes worth ${formatAmount(merged, decimals)} ${group.asset} in the ${group.tier} tier into a single note inside the pool, because that tier is carrying ${group.notes.length} notes against a cap of ${maxNotesPerTier} while the pool only shows ${groupDigits(String(poolTierCount))} comparable notes there, so adding another position first would make this wallet's note count readable on-chain.`,
    })

    usedAmounts.push({ amount: merged, timestamp: window.start })
    state = projectedState
    currentScore = projectedScore
  }

  /* ---- 2. campaign selection: the only place the mode matters ---- */

  const sourceAsset = pickSourceAsset(state.notes, input.prices)
  if (!sourceAsset) {
    assertNoUnshield(intents)
    return finish(intents, refused, baselineScore, currentScore, baselineBreakdown, input.mode, undefined)
  }

  const targetAsset: TokenSymbol =
    input.targetAsset && input.targetAsset !== sourceAsset
      ? input.targetAsset
      : sourceAsset === 'USDC'
        ? 'STRK'
        : 'USDC'

  const sourceDecimals = TOKENS[sourceAsset].decimals
  const sourceBalance = totalBalance(state.notes, sourceAsset)

  const nominalTranche =
    (sourceBalance * BigInt(Math.round(NOMINAL_DEPLOY_FRACTION * 10_000))) /
    (10_000n * BigInt(NOMINAL_TRANCHES))

  interface CampaignSpec {
    type: ActionType
    route: Route
    target: TokenSymbol
  }
  const specs: readonly CampaignSpec[] = [
    { type: 'SWAP', route: 'AVNU', target: targetAsset },
    { type: 'SWAP', route: 'EKUBO', target: targetAsset },
    { type: 'LEND', route: 'VESU', target: sourceAsset },
  ]

  const candidates: Candidate[] = []
  for (const spec of specs) {
    const economics = economicsFor(spec.route, input.routeEconomics)
    const impact = priceImpactBps(notionalOf(nominalTranche, sourceAsset, input.prices))
    const costBps = economics.costBps + impact
    const output = projectOutput(nominalTranche, sourceAsset, spec.target, costBps + slippageBps, input.prices)
    if (output === null) {
      refused.push({
        reason: `${spec.type} ${sourceAsset}->${spec.target} via ${spec.route} needs a reference price for both assets; without one there is no honest minimum output and the planner will not emit an unprotected swap.`,
        wouldScore: currentScore,
        type: spec.type,
        route: spec.route,
        asset: sourceAsset,
        amount: nominalTranche,
      })
      continue
    }
    if (nominalTranche <= 0n) continue

    const probe = applyAction(state, {
      type: spec.type,
      route: spec.route,
      sourceAsset,
      targetAsset: spec.target,
      inputAmount: nominalTranche,
      outputAmount: output,
      timestamp: Math.max(now, compactionEnd) + 1,
      tag: `probe-${spec.route}`,
    })
    if (!probe) continue

    const probeScore = computeEffectivePrivacy(scoreFromState(probe.history, probe.notes, input.pool))
    const privacyDelta = probeScore - currentScore
    const netReturnBps = realisedReturnBps(spec.route, economics, horizonDays) - costBps
    candidates.push({
      type: spec.type,
      route: spec.route,
      sourceAsset,
      targetAsset: spec.target,
      netReturnBps,
      privacyDelta,
      utility:
        profile.returnWeight * netReturnBps +
        profile.privacyWeight * privacyDelta * PRIVACY_POINT_BPS,
    })
  }

  let chosen: Candidate | undefined
  for (const candidate of candidates) {
    if (!chosen || candidate.utility > chosen.utility) chosen = candidate
  }
  if (!chosen) {
    assertNoUnshield(intents)
    return finish(intents, refused, baselineScore, currentScore, baselineBreakdown, input.mode, undefined)
  }

  const campaign: SelectedCampaign = {
    type: chosen.type,
    route: chosen.route,
    sourceAsset: chosen.sourceAsset,
    targetAsset: chosen.targetAsset,
    netReturnBps: chosen.netReturnBps,
    privacyDeltaEstimate: round1(chosen.privacyDelta),
    utility: chosen.utility,
  }

  /* ---- 3. size and schedule the tranches ---- */

  const budget = maxActions - intents.length
  if (budget <= 0) {
    assertNoUnshield(intents)
    return finish(intents, refused, baselineScore, currentScore, baselineBreakdown, input.mode, campaign)
  }

  const trancheCount = Math.min(budget, trancheCountFor(profile.privacyWeight))
  const deployable =
    (sourceBalance * BigInt(Math.round(clamp01(profile.deployFraction) * 10_000))) / 10_000n
  if (deployable <= 0n) {
    assertNoUnshield(intents)
    return finish(intents, refused, baselineScore, currentScore, baselineBreakdown, input.mode, campaign)
  }

  const splits = splitAmount(deployable, {
    count: trancheCount,
    seed: mixSeed(input.seed, 23),
    decimals: sourceDecimals,
    recentAmounts: usedAmounts,
    now,
  })

  const trancheStart = Math.max(now, compactionEnd)
  const windows: TimeWindow[] = recommendWindows(splits.length, {
    now: trancheStart,
    maxDelayMs: Math.max(60_000, now + maxDelayMs - trancheStart),
    seed: mixSeed(input.seed, 37),
    userGaps,
    poolGaps,
  })

  const collision = priorCollision(input.history, sourceAsset, now, AMOUNT_REUSE_WINDOW_MS)
  const sourceTier = denominationTier(deployable, sourceDecimals)
  const sourceTierDepth = input.pool.tierCounts[sourceTier] ?? 0

  for (let i = 0; i < splits.length; i += 1) {
    const window = windows[i]
    if (!window) break
    const amount = splits[i]
    if (amount <= 0n) continue

    const economics = economicsFor(chosen.route, input.routeEconomics)
    const impact = priceImpactBps(notionalOf(amount, sourceAsset, input.prices))
    const costBps = economics.costBps + impact
    const output = projectOutput(amount, sourceAsset, chosen.targetAsset, costBps + slippageBps, input.prices)
    if (output === null || output <= 0n) continue

    if (isAmountRecentlyUsed(amount, usedAmounts, now)) {
      refused.push({
        reason: `Tranche ${i + 1} of ${splits.length} would re-use the exact amount ${formatAmount(amount, sourceDecimals)} ${sourceAsset}, which this wallet already exposed inside 48h.`,
        wouldScore: currentScore,
        type: chosen.type,
        route: chosen.route,
        asset: sourceAsset,
        amount,
      })
      continue
    }

    const projectedState = applyAction(state, {
      type: chosen.type,
      route: chosen.route,
      sourceAsset,
      targetAsset: chosen.targetAsset,
      inputAmount: amount,
      outputAmount: output,
      timestamp: window.start,
      tag: `tranche-${i}`,
    })
    if (!projectedState) {
      refused.push({
        reason: `Tranche ${i + 1} of ${splits.length} needs ${formatAmount(amount, sourceDecimals)} ${sourceAsset} but the remaining note set cannot fund it.`,
        wouldScore: currentScore,
        type: chosen.type,
        route: chosen.route,
        asset: sourceAsset,
        amount,
      })
      continue
    }

    const projectedScore = computeEffectivePrivacy(
      scoreFromState(projectedState.history, projectedState.notes, input.pool),
    )
    if (projectedScore < floor) {
      refused.push({
        reason: `Tranche ${i + 1} of ${splits.length} (${formatAmount(amount, sourceDecimals)} ${sourceAsset} via ${chosen.route}) would leave effective privacy at ${projectedScore}, under the ${floor} floor.`,
        wouldScore: projectedScore,
        type: chosen.type,
        route: chosen.route,
        asset: sourceAsset,
        amount,
      })
      continue
    }

    const delay = window.start - now
    const destination =
      chosen.type === 'LEND'
        ? `Supplying ${formatAmount(amount, sourceDecimals)} ${sourceAsset} to ${chosen.route} as private collateral`
        : `Routing ${formatAmount(amount, sourceDecimals)} ${sourceAsset} into ${chosen.targetAsset} through ${chosen.route}`
    const because = collision
      ? `${collision.count} prior ${formatAmount(collision.amount, sourceDecimals)} ${sourceAsset} action${collision.count === 1 ? '' : 's'} in the last 48h would otherwise fingerprint this wallet`
      : `a single ${formatAmount(deployable, sourceDecimals)} ${sourceAsset} move would sit almost alone in the ${sourceTier} tier, where the pool shows only ${groupDigits(String(sourceTierDepth))} comparable notes`

    intents.push({
      id: nextId(chosen.type),
      type: chosen.type,
      sourceAsset,
      targetAsset: chosen.targetAsset,
      inputAmount: amount,
      minOutputAmount: output,
      route: chosen.route,
      recommendedWindowStart: window.start,
      recommendedWindowEnd: window.end,
      expectedPrivacyDelta: round1(projectedScore - currentScore),
      expectedCostBps: costBps,
      rationale: `${destination} in tranche ${i + 1} of ${splits.length}, split to a non-round size because ${because}, and delayed an irregular ${describeDuration(delay)} into a ${describeDuration(window.end - window.start)} window so this wallet's execution rhythm does not repeat its previous ${userGaps.length} intervals; projected effective privacy ${signed(projectedScore - currentScore)} points at ${costBps} bps of cost.`,
    })

    usedAmounts.push({ amount, timestamp: window.start })
    state = projectedState
    currentScore = projectedScore
  }

  intents.sort(
    (a, b) =>
      a.recommendedWindowStart - b.recommendedWindowStart ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  assertNoUnshield(intents)
  return finish(intents, refused, baselineScore, currentScore, baselineBreakdown, input.mode, campaign)
}

function finish(
  intents: ActionIntent[],
  refused: RefusedAction[],
  baselineScore: number,
  projectedScore: number,
  baselineBreakdown: ScoreBreakdown,
  mode: StrategyMode,
  campaign: SelectedCampaign | undefined,
): PlanResult {
  return { intents, refused, baselineScore, projectedScore, baselineBreakdown, mode, campaign }
}
