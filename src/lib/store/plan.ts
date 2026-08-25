'use client'

/**
 * The execution store: wires live pool activity, the local ledger, spot
 * prices and the strategy engine together, and routes signed execution of the
 * engine's intents through the user's wallet.
 *
 * Routing on mainnet today:
 *
 *   - SWAP via AVNU        → AVNU private swap (wallet proves, relayer submits)
 *   - REBALANCE / COMPACT  → private transfer to self (note-to-note, no venue)
 *   - everything else      → refused: Vesu's anonymizer class is not declared
 *     on mainnet, and Ekubo's declared class has no wired executor instance,
 *     so offering those routes would fail only at signing time.
 *
 * The pure helpers (seed derivation, intent routing, observer labels) are
 * exported for tests; nothing network- or wallet-touching is testable and
 * nothing testable touches the network.
 */

import { create } from 'zustand'
import type { WalletAccountV6 } from 'starknet'
import {
  computeEffectivePrivacy,
  formatAmount,
  generatePlan,
  scoreFromState,
  type ActionIntent,
  type ActionType,
  type PlanResult,
  type ScoreBreakdown,
  type StrategyMode,
} from '@/lib/engine'
import {
  appendLedger,
  loadLedger,
  syntheticNotesFromBalances,
  toEngineHistory,
  type LedgerEntry,
} from '@/lib/history'
import {
  assertNeverUnshields,
  buildPrivateTransfer,
  explainWalletError,
} from '@/lib/strk20/actions'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import {
  emptyActivity,
  readPoolActivity,
  type PoolActivityResult,
} from '@/lib/strk20/pool-activity'
import { executeAvnuPrivateSwap, fetchSpotPricesUsd, fetchSwapQuote } from '@/lib/strk20/swap'

/* ------------------------------------------------------------------ */
/* pure helpers (exported for tests)                                   */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000

/**
 * Deterministic plan seed from account + UTC day.
 *
 * Stable within a day so re-generating a plan does not reshuffle amounts and
 * windows under the user's cursor, and different across accounts and days so
 * plans do not repeat. The address is folded through BigInt, so padded and
 * unpadded spellings of the same account derive the same seed; an unparseable
 * address contributes 0 and the seed still varies by day.
 */
export function derivePlanSeed(address: string, now: number): number {
  let base = 0
  try {
    base = Number(BigInt(address) % 1_000_000n)
  } catch {
    base = 0
  }
  return base + Math.floor(now / DAY_MS)
}

/** How an intent gets executed, or that it cannot be. */
export type IntentExecutionRoute = 'AVNU_SWAP' | 'POOL_TRANSFER' | 'UNAVAILABLE'

/**
 * Route an engine intent to an executable path. Pure so the routing table is
 * testable without a wallet: SWAP via AVNU swaps privately through AVNU's
 * executor; REBALANCE and COMPACT via POOL are a private transfer to self
 * (note-to-note); everything else — LEND via VESU, SWAP via EKUBO — has no
 * executable mainnet path today.
 */
export function classifyIntentRoute(
  intent: Pick<ActionIntent, 'type' | 'route'>,
): IntentExecutionRoute {
  if (intent.type === 'SWAP' && intent.route === 'AVNU') return 'AVNU_SWAP'
  if ((intent.type === 'REBALANCE' || intent.type === 'COMPACT') && intent.route === 'POOL') {
    return 'POOL_TRANSFER'
  }
  return 'UNAVAILABLE'
}

/**
 * What a chain observer sees for an AVNU private swap: the pool's executor
 * touching an AMM. Never the user.
 */
export const OBSERVER_AVNU_SWAP = 'executor → AMM'

/** What a chain observer sees for a private note-to-note transfer: nothing. */
export const OBSERVER_POOL_TRANSFER = '—'

export function observerLabelFor(kind: Exclude<IntentExecutionRoute, 'UNAVAILABLE'>): string {
  return kind === 'AVNU_SWAP' ? OBSERVER_AVNU_SWAP : OBSERVER_POOL_TRANSFER
}

/** Thrown for intents whose route has no executable mainnet path. */
export const ROUTE_UNAVAILABLE_MESSAGE = 'Route not available on mainnet'

export function ledgerRouteFor(
  kind: Exclude<IntentExecutionRoute, 'UNAVAILABLE'>,
): LedgerEntry['route'] {
  return kind === 'AVNU_SWAP' ? 'AVNU' : 'POOL'
}

export function ledgerTypeFor(
  kind: Exclude<IntentExecutionRoute, 'UNAVAILABLE'>,
  intentType: ActionType,
): LedgerEntry['type'] {
  if (kind === 'AVNU_SWAP') return 'SWAP'
  return intentType === 'COMPACT' ? 'COMPACT' : 'REBALANCE'
}

/* ------------------------------------------------------------------ */
/* the store                                                           */
/* ------------------------------------------------------------------ */

export interface PlanBalance {
  symbol: TokenSymbol
  raw: bigint
}

interface PlanState {
  /** Last pool read, kept even when `live` is false — the UI shows honesty states. */
  activity: PoolActivityResult | null
  activityLoading: boolean

  plan: PlanResult | null
  planning: boolean
  planError: string | null

  breakdown: ScoreBreakdown | null
  score: number | null
  prices: Partial<Record<TokenSymbol, number>>

  /** Intent id currently being executed, or null. */
  executing: string | null
  lastTxHash: string | null

  /** Last balances handed to refreshScore/generate, reused after execution. */
  balancesSnapshot: PlanBalance[]

  loadActivity: () => Promise<void>
  refreshScore: (address: string, balances: PlanBalance[]) => void
  generate: (params: {
    address: string
    balances: PlanBalance[]
    mode: StrategyMode
    privacyFloor: number
    targetAsset?: TokenSymbol
  }) => Promise<void>
  executeIntent: (params: {
    account: WalletAccountV6
    address: string
    intent: ActionIntent
  }) => Promise<{ txHash: string } | null>
}

export const usePlan = create<PlanState>((set, get) => ({
  activity: null,
  activityLoading: false,

  plan: null,
  planning: false,
  planError: null,

  breakdown: null,
  score: null,
  prices: {},

  executing: null,
  lastTxHash: null,

  balancesSnapshot: [],

  async loadActivity() {
    set({ activityLoading: true })
    try {
      // readPoolActivity never throws by contract — it degrades to
      // `live: false` — but the loading flag must not be able to stick.
      const activity = await readPoolActivity()
      set({ activity, activityLoading: false })
    } catch {
      set({ activityLoading: false })
    }
  },

  refreshScore(address, balances) {
    const history = toEngineHistory(loadLedger(address))
    const notes = syntheticNotesFromBalances(balances, Date.now())
    const pool = get().activity?.activity ?? emptyActivity()
    const breakdown = scoreFromState(history, notes, pool)
    set({
      breakdown,
      score: computeEffectivePrivacy(breakdown),
      balancesSnapshot: [...balances],
    })
  },

  async generate({ address, balances, mode, privacyFloor, targetAsset }) {
    set({ planning: true, planError: null })
    try {
      if (!get().activity) await get().loadActivity()
      const activity = get().activity

      // Best-effort: {} on failure, in which case the planner refuses
      // cross-asset swaps rather than emitting unprotected ones.
      const prices = await fetchSpotPricesUsd(TOKEN_LIST.map((token) => token.symbol))

      const now = Date.now()
      const history = toEngineHistory(loadLedger(address))
      const notes = syntheticNotesFromBalances(balances, now)

      const plan = generatePlan({
        mode,
        now,
        seed: derivePlanSeed(address, now),
        notes,
        history,
        pool: activity?.activity ?? emptyActivity(),
        privacyFloor,
        targetAsset,
        prices,
      })

      set({
        plan,
        planning: false,
        prices,
        breakdown: plan.baselineBreakdown,
        score: plan.baselineScore,
        balancesSnapshot: [...balances],
      })
    } catch (error) {
      set({
        planning: false,
        planError:
          error instanceof Error ? error.message : 'Could not generate a plan.',
      })
    }
  },

  async executeIntent({ account, address, intent }) {
    if (get().executing) return null

    const kind = classifyIntentRoute(intent)
    set({ executing: intent.id, planError: null })

    try {
      if (kind === 'UNAVAILABLE') {
        throw new Error(ROUTE_UNAVAILABLE_MESSAGE)
      }

      let txHash: string
      if (kind === 'AVNU_SWAP') {
        // Re-quote at execution time — planner quotes are reference-price
        // projections, and AVNU quotes expire.
        const { quote, buyAmountWei } = await fetchSwapQuote({
          sellToken: intent.sourceAsset,
          buyToken: intent.targetAsset,
          sellAmountWei: intent.inputAmount,
          takerAddress: address,
        })
        if (buyAmountWei < intent.minOutputAmount) {
          const decimals = TOKENS[intent.targetAsset].decimals
          throw new Error(
            `Live quote returns ${formatAmount(buyAmountWei, decimals)} ${intent.targetAsset}, ` +
              `under the plan's protected minimum of ` +
              `${formatAmount(intent.minOutputAmount, decimals)} ${intent.targetAsset}. ` +
              `The market moved — regenerate the plan.`,
          )
        }
        const result = await executeAvnuPrivateSwap({ account, quote })
        txHash = result.transactionHash
      } else {
        // Note-to-note churn: a private transfer to self. No contract call,
        // no event, no public leg. The tripwire runs before signing on every
        // action list Lumen builds itself.
        const actions = buildPrivateTransfer(
          TOKENS[intent.sourceAsset].address,
          intent.inputAmount,
          address,
        )
        assertNeverUnshields(actions, { contracts: [] })
        const result = await account.strk20InvokeTransaction(actions)
        txHash = result.transaction_hash
      }

      appendLedger(address, {
        timestamp: Date.now(),
        type: ledgerTypeFor(kind, intent.type),
        asset: intent.sourceAsset,
        amount: intent.inputAmount,
        route: ledgerRouteFor(kind),
        txHash,
        observer: observerLabelFor(kind),
      })

      set({ lastTxHash: txHash, executing: null })
      get().refreshScore(address, get().balancesSnapshot)
      return { txHash }
    } catch (error) {
      set({ executing: null, planError: explainWalletError(error) })
      return null
    }
  },
}))
