'use client'

/**
 * Wallet connection and STRK20 capability detection.
 *
 * Lumen talks to the pool exclusively through the user's privacy-enabled
 * wallet. The wallet owns viewing keys, note discovery, proof generation and
 * submission; this module never asks for a key and never sees private state.
 */

import { createStore, type Store } from '@starknet-io/get-starknet-discovery'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import { RpcProvider, WalletAccountV6 } from 'starknet'
import type { STRK20_BALANCE_ENTRY } from '@starknet-io/types-js'
import { CHAIN_ID, REQUIRED_WALLET_API_VERSION, RPC_URL, TOKEN_LIST, tokenByAddress, type TokenSymbol } from './config'

let store: Store | null = null

/** Lazily created wallet-discovery store. Browser only. */
export function walletStore(): Store {
  if (!store) store = createStore()
  return store
}

export function listWallets(): WalletWithStarknetFeatures[] {
  return walletStore().getWallets()
}

export function subscribeToWallets(
  listener: (wallets: readonly WalletWithStarknetFeatures[]) => void,
): () => void {
  return walletStore().subscribe(listener)
}

/** Semver-ish comparison sufficient for wallet API version strings. */
function atLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const b = minimum.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left > right) return true
    if (left < right) return false
  }
  return true
}

/**
 * Whether a wallet advertises the STRK20 methods.
 *
 * Deliberately a version query, never a probe of `strk20Balances` — that is a
 * balance-reading method, so probing it makes the wallet prompt the user for
 * consent to data Lumen has no reason to see.
 */
export function supportsStrk20(wallet: WalletWithStarknetFeatures): boolean {
  const feature = wallet.features['starknet:walletApi'] as
    | { version?: string; supportedApiVersions?: string[] }
    | undefined
  if (!feature) return false

  const advertised = feature.supportedApiVersions ?? (feature.version ? [feature.version] : [])
  return advertised.some((version) => atLeast(version, REQUIRED_WALLET_API_VERSION))
}

export function provider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URL })
}

/** A wallet handed us an address we can actually spend from. */
function usableAddress(address: unknown): address is string {
  if (typeof address !== 'string' || !address.startsWith('0x')) return false
  try {
    return BigInt(address) > 0n
  } catch {
    return false
  }
}

/**
 * Wait for a wallet to finish authorising, up to `ms`.
 *
 * Wallets announce accounts through the wallet-standard `change` event. The
 * event is also allowed to fire for unrelated reasons, so the account list is
 * re-read each time rather than trusted from the payload.
 */
function waitForAccounts(wallet: WalletWithStarknetFeatures, ms: number): Promise<boolean> {
  if (wallet.accounts.length > 0) return Promise.resolve(true)

  return new Promise((resolve) => {
    let done = false
    const settle = (value: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      off?.()
      resolve(value)
    }

    const timer = setTimeout(() => settle(false), ms)
    const off = wallet.features['standard:events']?.on('change', () => {
      if (wallet.accounts.length > 0) settle(true)
    })

    // A wallet that never emits `change` still updates its account list, so
    // poll as a floor under the event.
    const poll = setInterval(() => {
      if (wallet.accounts.length > 0) {
        clearInterval(poll)
        settle(true)
      }
    }, 400)
    setTimeout(() => clearInterval(poll), ms)
  })
}

/**
 * Connect and upgrade to a `WalletAccountV6`, which carries the STRK20 methods.
 *
 * `WalletAccountV6.connect` reads `accounts[0]?.address` and does not complain
 * when there is no account — it hands back an account whose address is
 * `undefined`. Wallets hit that path routinely: several resolve `connect()`
 * the moment their approval window opens, before the user has approved
 * anything. Taking that result at face value is what made a first connect
 * appear to fail and a reload appear to fix it, since by then the wallet had
 * remembered the approval.
 *
 * So the result is checked, and if there is no address yet the wallet is given
 * time to finish before asking once more. `standard:connect` is idempotent for
 * an already-authorised wallet, so the second call costs nothing and does not
 * open a second window.
 *
 * The cast bridges two copies of the same interface. `get-starknet-discovery`
 * returns wallets typed by `@starknet-io/get-starknet-wallet-standard@6.0.3`,
 * while `starknet@10.4.0` bundles the identical package aliased as
 * `get-starknet-wallet-standard-v6@6.0.2` and types `connect` against that.
 * TypeScript treats them as distinct nominal types even though the runtime
 * shape is the same, so the two cannot meet without an assertion here.
 */
export async function connectWallet(
  wallet: WalletWithStarknetFeatures,
): Promise<WalletAccountV6> {
  const bridged = wallet as unknown as Parameters<typeof WalletAccountV6.connect>[1]

  const first = await WalletAccountV6.connect(provider(), bridged)
  if (usableAddress(first.address)) return first

  const approved = await waitForAccounts(wallet, APPROVAL_TIMEOUT_MS)
  if (approved) {
    const second = await WalletAccountV6.connect(provider(), bridged)
    if (usableAddress(second.address)) return second
  }

  throw new Error(
    `${wallet.name} did not share an account. Open the wallet, approve the connection, and try again.`,
  )
}

/** How long a wallet gets to finish its approval window. */
const APPROVAL_TIMEOUT_MS = 90_000

export interface ShieldedBalance {
  symbol: TokenSymbol
  address: string
  raw: bigint
  decimals: number
}

/**
 * Read shielded balances for the configured token list.
 *
 * This triggers a wallet consent prompt, so it is only ever called as a
 * deliberate balance-display action — never to feature-detect.
 *
 * `STRK20_BALANCE_ENTRY` is typed `{ token, balance }`, but starknet.js's own
 * JSDoc documents it as `{ token, amount }`. Read defensively rather than
 * trusting either, because the shape mismatch is silent and would render every
 * balance as zero.
 */
export async function readShieldedBalances(
  account: WalletAccountV6,
): Promise<ShieldedBalance[]> {
  const entries = (await account.strk20Balances(
    TOKEN_LIST.map((token) => token.address),
  )) as Array<STRK20_BALANCE_ENTRY & { amount?: string }>

  return entries.flatMap((entry) => {
    const token = tokenByAddress(entry.token)
    if (!token) return []

    const rawValue = entry.balance ?? entry.amount ?? '0x0'

    let raw: bigint
    try {
      raw = BigInt(rawValue)
    } catch {
      raw = 0n
    }

    return [{ symbol: token.symbol, address: token.address, raw, decimals: token.decimals }]
  })
}

/** Format a raw token amount for display without floating-point drift. */
export function formatUnits(raw: bigint, decimals: number, maxFractionDigits = 4): string {
  const negative = raw < 0n
  const value = negative ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const fraction = value % base

  const wholeText = whole.toLocaleString('en-US')
  if (fraction === 0n || maxFractionDigits === 0) {
    return `${negative ? '-' : ''}${wholeText}`
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, maxFractionDigits)
    .replace(/0+$/, '')

  return fractionText
    ? `${negative ? '-' : ''}${wholeText}.${fractionText}`
    : `${negative ? '-' : ''}${wholeText}`
}

/** Parse a user-entered decimal string into raw token units. */
export function parseUnits(input: string, decimals: number): bigint {
  const trimmed = input.trim()
  if (!trimmed) return 0n
  const [whole = '0', fraction = ''] = trimmed.split('.')
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(`${whole || '0'}${paddedFraction || ''}` || '0')
}

export { CHAIN_ID }
