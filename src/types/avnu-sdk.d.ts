/**
 * Hand-written types for `@avnu/avnu-sdk@4.2.0`.
 *
 * The package ships no TypeScript declarations (`dist/index.d.ts` is listed in
 * its package.json but absent from the published tarball), so this file
 * declares the module. Every signature below was read out of
 * `node_modules/@avnu/avnu-sdk/dist/index.js` — the zod schemas, the mock
 * factories and the function bodies — not out of documentation.
 *
 * Scope is deliberately narrow: only the surface Lumen uses. Where the source
 * is ambiguous a field is typed `unknown` rather than guessed.
 */

declare module '@avnu/avnu-sdk' {
  import type { Call } from 'starknet'
  import type { STRK20_ACTION, STRK20_CALL_AND_PROOF } from '@starknet-io/types-js'

  /** Mainnet API root, `https://starknet.api.avnu.fi`. */
  export const BASE_URL: string

  /**
   * The mainnet STRK20 privacy pool as the SDK knows it. Verified identical to
   * Lumen's own `POOL_ADDRESS`; `swap.ts` re-checks that at runtime.
   */
  export const PRIVACY_POOL_ADDRESS: string

  /**
   * Per-request options. `getQuotes`/`fetchTokens` read `baseUrl`, the prices
   * endpoint reads `impulseBaseUrl`, the private-swap paymaster RPC reads
   * `paymasterBaseUrl`; all fall back to the mainnet constants.
   */
  export interface AvnuRequestOptions {
    baseUrl?: string
    impulseBaseUrl?: string
    paymasterBaseUrl?: string
    abortSignal?: AbortSignal
    /** When set, responses must carry a valid server signature. */
    avnuPublicKey?: string
  }

  /**
   * Query for `GET /swap/v3/quotes`. `sellAmount`/`buyAmount` are bigints and
   * are hex-encoded by the SDK; one of the two is required (the SDK throws
   * otherwise). The whole object is spread into the query string.
   */
  export interface QuoteRequest {
    sellTokenAddress: string
    buyTokenAddress: string
    sellAmount?: bigint
    buyAmount?: bigint
    takerAddress?: string
    /** Max number of quotes to return. */
    size?: number
    integratorFees?: bigint
  }

  /**
   * One AVNU quote, per `QuoteSchema` in the dist. The schema carries more
   * fields (fee, routes, gasFees, priceImpact, USD figures…); only the ones
   * Lumen reads are declared. `sellAmount`/`buyAmount` arrive as hex strings
   * and are transformed to bigint by the SDK's zod layer.
   */
  export interface Quote {
    quoteId: string
    sellTokenAddress: string
    sellAmount: bigint
    buyTokenAddress: string
    buyAmount: bigint
    /** Hex chain id; `executePrivateSwap` compares it against its `chainId` param. */
    chainId: string
  }

  /** Resolves with the parsed quote list, best route first. */
  export function getQuotes(
    request: QuoteRequest,
    options?: AvnuRequestOptions,
  ): Promise<Quote[]>

  /**
   * One entry from `POST /v3/tokens/prices` on the impulse host, per
   * `TokenPriceSchema`: either market block may be null for illiquid tokens.
   */
  export interface TokenPrice {
    address: string
    decimals: number
    globalMarket: { usd: number } | null
    starknetMarket: { usd: number } | null
  }

  /** Spot prices for a list of token addresses (impulse API). */
  export function getPrices(
    tokenAddresses: string[],
    options?: AvnuRequestOptions,
  ): Promise<TokenPrice[]>

  /**
   * Fee mode for the private-swap paymaster: the pool fee is charged from
   * private balance in `poolFeeToken`. Sent as `sponsored_private` on the RPC.
   * `tip` is forwarded verbatim when set (the SDK's own mock uses "normal").
   */
  export interface PrivateFeeMode {
    poolFeeToken: string
    tip?: string
  }

  /** The pool-fee leg the paymaster quotes before a private swap. */
  export interface PrivateSwapFee {
    token: string
    recipient: string
    amount: bigint
  }

  /**
   * Everything the prover needs to assemble the four STRK20 actions of a
   * private swap: withdraw input to the executor, withdraw the fee, open the
   * output note, invoke the executor.
   */
  export interface PrivateSwapPlan {
    sellTokenAddress: string
    sellAmount: bigint
    buyTokenAddress: string
    executorAddress: string
    /** Executor calls returned by AVNU's build endpoint. */
    executorCalls: Call[]
    fee: PrivateSwapFee
    takerAddress: string
  }

  /** A proven, submittable call in the paymaster's camelCase shape. */
  export interface PrivateSwapCallAndProof {
    call: {
      contractAddress: string
      entrypoint: string
      calldata: string[]
    }
    proof: {
      data: string
      proofFacts: string[]
    }
  }

  export interface Strk20Prover {
    buildAndProve(plan: PrivateSwapPlan): Promise<PrivateSwapCallAndProof>
  }

  /**
   * The only thing the prover uses from the account is
   * `strk20PrepareInvoke` — a `WalletAccountV6` satisfies this structurally.
   * The wallet builds and proves the action set; keys never leave it.
   */
  export interface Strk20ProverAccount {
    strk20PrepareInvoke(
      actions: STRK20_ACTION[],
      simulate?: boolean,
    ): Promise<STRK20_CALL_AND_PROOF>
  }

  /** Wrap a privacy-enabled wallet account as the prover `executePrivateSwap` needs. */
  export function createStrk20WalletProver(account: Strk20ProverAccount): Strk20Prover

  export interface ExecutePrivateSwapParams {
    quote: Quote
    /** Owner of the output note. Required — it becomes the open-note recipient. */
    takerAddress: string
    poolAddress: string
    feeMode: PrivateFeeMode
    prover: Strk20Prover
    /** Decimal fraction, e.g. 0.005 for 0.5%. Forwarded to the build endpoint. */
    slippage?: number
    /**
     * Only needed for fee modes that require a paymaster key. Server-side
     * secret — never supply it from browser code.
     */
    paymasterApiKey?: string
    /** When set, must equal `quote.chainId` or the SDK throws. */
    chainId?: string
  }

  /**
   * Quote → paymaster fee → executor calls → wallet proof → relayed
   * submission. Resolves with the relayer's transaction hash.
   *
   * Declared for completeness; Lumen does not call it. Its `toRpcFeeMode`
   * hardcodes `mode: "sponsored_private"` whatever `feeMode` says, and that
   * mode requires a paymaster API key a browser cannot hold. `swap.ts` uses
   * `quoteToCalls` below and submits through the wallet instead.
   */
  export function executePrivateSwap(
    params: ExecutePrivateSwapParams,
    options?: AvnuRequestOptions,
  ): Promise<{ transactionHash: string }>

  /** Body for `POST /swap/v3/build`. */
  export interface QuoteToCallsRequest {
    quoteId: string
    takerAddress?: string
    /** Decimal fraction, e.g. 0.005 for 0.5%. */
    slippage?: number
    /** Sent as `includeApprove`. */
    executeApprove?: boolean
    /** Ask for the private route; adds `executorAddress` to the response. */
    private?: boolean
  }

  export interface QuoteToCallsResult {
    /** The calls the executor should run — an approve and the swap itself. */
    calls: Call[]
    /**
     * The anonymizer AVNU deployed behind the pool's `privacy_invoke`. Returned
     * only for `private: true`; absent means the pair has no private route.
     */
    executorAddress?: string
  }

  /**
   * Turn a quote into executor calls. A public endpoint: no API key, no
   * credits, no paymaster — which is the whole reason Lumen calls this rather
   * than `executePrivateSwap`.
   */
  export function quoteToCalls(
    request: QuoteToCallsRequest,
    options?: AvnuRequestOptions,
  ): Promise<QuoteToCallsResult>
}
