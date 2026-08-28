/**
 * Live STRK20 protocol configuration — Starknet mainnet.
 *
 * Every address here is a real mainnet deployment. Nothing in Lumen points at
 * a mock, a devnet, or a simulated balance.
 */

import { constants } from 'starknet'

/** Lumen targets mainnet only. */
export const CHAIN_ID = constants.StarknetChainId.SN_MAIN

/**
 * The live STRK20 privacy pool.
 * Every private note Lumen ever holds lives inside this contract.
 */
export const POOL_ADDRESS =
  '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

/**
 * Anonymizer class hashes — helper classes exposing `privacy_invoke`, which
 * lets the pool call out to DeFi and credit the result back into an open note.
 *
 * These are CLASS hashes, not deployed instance addresses. A class must be
 * declared on mainnet before anything can be deployed from it, so `declared`
 * records what was actually found on-chain rather than what the docs claim.
 *
 * Verified by `starknet_getClassAt` against two independent RPC providers.
 */
export const ANONYMIZERS = {
  ekubo: {
    classHash: '0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7',
    // Declared on mainnet; its ABI confirms IEkuboSwapAnonymizer.privacy_invoke.
    declared: true,
  },
  vesu: {
    classHash: '0x3751128dc3ebd36215f982766f14aaca8f78793e4b0f42a73e49372a8e24aae',
    // NOT declared on mainnet — `starknet_getClassAt` returns "Class hash not
    // found" on both providers, padded and unpadded. The hash is not invented;
    // it is the one published in the starknet-privacy README, but that README
    // documents a release-candidate tag rather than a mainnet deployment.
    //
    // The private-lending route is therefore unavailable on mainnet today, and
    // the planner must not offer it until this flips. Shipping a lend action
    // against an undeclared class would fail only at signing time.
    declared: false,
  },
} as const

/** Routes that can actually be executed on mainnet right now. */
export const AVAILABLE_ANONYMIZERS = Object.entries(ANONYMIZERS)
  .filter(([, meta]) => meta.declared)
  .map(([name]) => name)

/**
 * RPC endpoint. Supplied by the operator via env and never committed.
 *
 * The fallback is a keyless public endpoint so the app degrades to read-only
 * rather than dying when no key is configured. It is rate-limited and not
 * suitable for production — set `NEXT_PUBLIC_STARKNET_RPC_URL` to your own
 * Alchemy endpoint. (Blast's public Starknet RPC was retired and now returns
 * an error to every call, so it is deliberately not used here.)
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? 'https://rpc.starknet.lava.build:443'

/**
 * Minimum Wallet API version that carries the STRK20 methods.
 * Feature-detect with `supportedWalletApi`, never by probing a data method —
 * probing `strk20Balances` triggers a consent prompt for data we have no
 * reason to read.
 */
export const REQUIRED_WALLET_API_VERSION = '0.10.3'

/**
 * A new note is not spendable immediately. The pool needs roughly this many
 * blocks before a freshly created note can be consumed, and the UI has to make
 * that wait legible rather than looking broken.
 */
export const NOTE_MATURITY_BLOCKS = 10

/**
 * The pool charges a flat fee per private operation, denominated in STRK.
 *
 * Read from `get_fee_amount()` on mainnet, where it is currently 6 STRK — not
 * the 4 quoted in the published docs. Always subtract the live value before
 * pre-filling a MAX amount: underestimating means the operation fails *after*
 * the user has already signed. Wallet flows sponsor gas but not this fee.
 *
 * This constant is a first-paint fallback only.
 */
export const FALLBACK_POOL_FEE_STRK = 6n * 10n ** 18n

export type TokenSymbol = 'STRK' | 'USDC' | 'ETH' | 'WBTC' | 'strkBTC'

export interface TokenConfig {
  symbol: TokenSymbol
  name: string
  address: string
  decimals: number
  /** Display grouping for the portfolio ring. */
  kind: 'stable' | 'native' | 'major'
}

/**
 * Mainnet tokens Lumen offers.
 *
 * Every address below was confirmed on-chain by calling `name`, `symbol` and
 * `decimals` against two independent RPC providers.
 *
 * The pool itself has no token allowlist — its ABI has no such function, and
 * 35 different ERC-20s have been shielded through it. This list is therefore a
 * product choice about what Lumen routes, not a protocol limit.
 */
export const TOKENS: Record<TokenSymbol, TokenConfig> = {
  STRK: {
    symbol: 'STRK',
    name: 'Starknet Token',
    address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    decimals: 18,
    kind: 'native',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USDC',
    // Native Circle USDC.
    //
    // NOT 0x053c9125…68a8 — that is the bridged USDC.e, and the migration to
    // native is effectively complete. The difference is decisive inside the
    // pool: native shows ~19,600 shielded events against bridged's 80, so
    // routing here would land value in a venue with essentially no anonymity
    // set and almost no liquidity to swap against.
    address: '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
    decimals: 6,
    kind: 'stable',
  },
  strkBTC: {
    symbol: 'strkBTC',
    name: 'strkBTC',
    // Backed 1:1 by BTC and the third most-shielded asset in the pool, ahead
    // of ETH. Distinct from xstrkBTC (staked) and from the several unrelated
    // contracts that also use a BTC-like symbol with 18 decimals.
    address: '0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135',
    decimals: 8,
    kind: 'major',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ether',
    address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    decimals: 18,
    kind: 'major',
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    address: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
    decimals: 8,
    kind: 'major',
  },
}

export const TOKEN_LIST = Object.values(TOKENS)

/** Felt-safe address comparison. Padded and unpadded hex name the same token. */
export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

/** Look a token up by address, tolerating padding differences. */
export function tokenByAddress(address: string): TokenConfig | undefined {
  return TOKEN_LIST.find((t) => sameAddress(t.address, address))
}

/** Voyager link for any mainnet transaction. */
export function explorerTx(hash: string): string {
  return `https://voyager.online/tx/${hash}`
}

export function explorerContract(address: string): string {
  return `https://voyager.online/contract/${address}`
}

/**
 * Which asset a composer should open on.
 *
 * strkBTC is the flagship — the first asset built on STRK20, backed 1:1 by BTC
 * locked on the Bitcoin base layer — so it leads whenever there is any of it.
 * But opening on an asset the account does not hold means opening on a screen
 * that cannot send, so a real balance always wins over the flagship, and the
 * flagship only wins over an empty account.
 */
export function preferredToken(
  balances: readonly { symbol: TokenSymbol; raw: bigint }[],
): TokenSymbol {
  const held = balances.filter((balance) => balance.raw > 0n)
  if (held.length === 0) return FLAGSHIP
  const flagship = held.find((balance) => balance.symbol === FLAGSHIP)
  if (flagship) return FLAGSHIP
  // Otherwise whatever they actually have most of, by list order as a
  // tiebreak — never a token with a zero balance.
  return held[0].symbol
}

/** The asset Lumen leads with. */
export const FLAGSHIP: TokenSymbol = 'strkBTC'

/**
 * A felt as the Wallet API expects to receive it: `0x` followed by the
 * shortest hex that represents it, with no leading zeros.
 *
 * This is what `num.toHex` produces and what the official starter kit hands
 * the wallet. Zero-padding the same value to 64 digits is the same felt and a
 * different string, and it is rejected with `INVALID_REQUEST_PAYLOAD` — an
 * error that names no field. Verified against a wallet on mainnet: identical
 * action arrays pass minimal and fail padded.
 *
 * Wallet placeholders (`${openNoteIds[0]}`, `${poolAddress}`) are substituted
 * during assembly and must be passed through untouched, so anything that is
 * not parseable as a number is returned as-is.
 */
export function walletFelt(value: string): string {
  try {
    return `0x${BigInt(value).toString(16)}`
  } catch {
    return value
  }
}
