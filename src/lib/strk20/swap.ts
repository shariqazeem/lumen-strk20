'use client'

/**
 * AVNU private swaps — the one DeFi action that needs no Cairo of our own,
 * because AVNU deployed its executor behind the pool's `privacy_invoke`.
 *
 * How the trust boundary runs here, and why `assertNeverUnshields` does not
 * appear in this file: a private swap moves value INSIDE the pool — the sell
 * token must already be shielded, and the output settles straight back into a
 * fresh private note. The action list for that swap is assembled by the AVNU
 * SDK and then built, proved and submitted by the user's WALLET
 * (`createStrk20WalletProver` → `strk20PrepareInvoke`), and the wallet itself
 * refuses privacy-leaking action sets. Lumen's own `assertNeverUnshields`
 * therefore guards the action lists Lumen builds directly (transfers,
 * compactions), not the AVNU-built ones — those are covered by the wallet's
 * own refusal, which is the stronger guarantee because it sits behind the
 * signature prompt.
 *
 * No `paymasterApiKey` is ever passed from this module: that fee mode needs a
 * server-held secret, and Lumen is a browser dapp. The pool fee is instead
 * charged from private balance in the sell token (`feeMode.poolFeeToken`).
 */

import {
  BASE_URL,
  PRIVACY_POOL_ADDRESS,
  createStrk20WalletProver,
  executePrivateSwap,
  getPrices,
  getQuotes,
  type Quote,
} from '@avnu/avnu-sdk'
import type { WalletAccountV6 } from 'starknet'
import { POOL_ADDRESS, TOKENS, sameAddress, tokenByAddress, type TokenSymbol } from './config'

export type { Quote }

/** Default slippage for private swaps: 0.5%, expressed as a decimal fraction. */
export const DEFAULT_SWAP_SLIPPAGE = 0.005

export interface SwapQuoteParams {
  sellToken: TokenSymbol
  buyToken: TokenSymbol
  /** Raw amount in the sell token's smallest unit. */
  sellAmountWei: bigint
  /** The user's address; owner of the resulting note. */
  takerAddress: string
}

export interface SwapQuoteResult {
  quote: Quote
  /** Raw expected output in the buy token's smallest unit. */
  buyAmountWei: bigint
}

/**
 * Fetch the best AVNU quote for a shielded swap.
 *
 * Explicitly pinned to the mainnet API (`BASE_URL`) because Lumen targets
 * mainnet only. AVNU returns quotes best-first; we take the first and refuse
 * loudly when there is none, rather than letting an empty array surface later
 * as an undefined-quote crash at signing time.
 */
export async function fetchSwapQuote(params: SwapQuoteParams): Promise<SwapQuoteResult> {
  const { sellToken, buyToken, sellAmountWei, takerAddress } = params

  if (sellToken === buyToken) {
    throw new Error(`Cannot quote a swap from ${sellToken} to itself.`)
  }
  if (sellAmountWei <= 0n) {
    throw new Error('Swap amount must be greater than zero.')
  }

  const quotes = await getQuotes(
    {
      sellTokenAddress: TOKENS[sellToken].address,
      buyTokenAddress: TOKENS[buyToken].address,
      sellAmount: sellAmountWei,
      takerAddress,
    },
    { baseUrl: BASE_URL },
  )

  const quote = quotes[0]
  if (!quote) {
    throw new Error(
      `AVNU returned no route for ${sellToken} → ${buyToken} at this size. ` +
        `Try a different amount or pair.`,
    )
  }

  return { quote, buyAmountWei: quote.buyAmount }
}

export interface PrivateSwapParams {
  account: WalletAccountV6
  quote: Quote
  /** Decimal fraction; defaults to {@link DEFAULT_SWAP_SLIPPAGE}. */
  slippage?: number
}

/**
 * Execute a quoted swap privately: the wallet proves the STRK20 action set,
 * AVNU's relayer submits it, and the output lands in a fresh private note.
 * The sell token must already be shielded — this cannot shield for you.
 */
export async function executeAvnuPrivateSwap(
  params: PrivateSwapParams,
): Promise<{ transactionHash: string }> {
  const { account, quote, slippage = DEFAULT_SWAP_SLIPPAGE } = params

  // Lumen pins its own pool constant rather than silently trusting the SDK's,
  // and cross-checks the two at runtime: if an SDK update ever repoints
  // PRIVACY_POOL_ADDRESS, the mismatch must be visible, not absorbed.
  if (!sameAddress(POOL_ADDRESS, PRIVACY_POOL_ADDRESS)) {
    console.warn(
      `Lumen pool address ${POOL_ADDRESS} differs from the AVNU SDK's ` +
        `PRIVACY_POOL_ADDRESS ${PRIVACY_POOL_ADDRESS}; proceeding with Lumen's. ` +
        `Verify the SDK version before shipping.`,
    )
  }

  const prover = createStrk20WalletProver(account)

  return executePrivateSwap(
    {
      quote,
      slippage,
      takerAddress: account.address,
      poolAddress: POOL_ADDRESS,
      feeMode: { poolFeeToken: quote.sellTokenAddress },
      prover,
    },
    { baseUrl: BASE_URL },
  )
}

/**
 * Best-effort USD spot prices from AVNU's prices endpoint
 * (`POST /v3/tokens/prices` on the impulse host, via the SDK's `getPrices`).
 *
 * MUST degrade gracefully, and does: on any failure — network, schema, a
 * token the API does not know — it returns `{}` or simply omits the symbol.
 * That is correct behaviour, not a silent bug: the planner treats a missing
 * price as "no honest minimum output exists" and refuses the cross-asset swap
 * instead of emitting one with no slippage protection. Never throw from here.
 */
export async function fetchSpotPricesUsd(
  symbols: TokenSymbol[],
): Promise<Partial<Record<TokenSymbol, number>>> {
  const unique = [...new Set(symbols)]
  if (unique.length === 0) return {}

  try {
    const entries = await getPrices(unique.map((symbol) => TOKENS[symbol].address))

    const prices: Partial<Record<TokenSymbol, number>> = {}
    for (const entry of entries) {
      const token = tokenByAddress(entry.address)
      if (!token) continue
      const usd = entry.starknetMarket?.usd ?? entry.globalMarket?.usd
      if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
        prices[token.symbol] = usd
      }
    }
    return prices
  } catch {
    return {}
  }
}
