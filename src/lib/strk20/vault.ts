'use client'

/**
 * LumenVault rails — private Bitcoin staking.
 *
 * strkBTC is Starknet's shielded Bitcoin and Endur's xstrkBTC is its
 * liquid-staked form. Both are shieldable, but the step between them is not:
 * staking today means unshielding, depositing in public, and re-shielding.
 *
 * STRK20 publishes an extension point for exactly this — withdraw to a helper,
 * call its `privacy_invoke`, credit what it returns into an open note, all in
 * one atomic private operation. `LumenVault` is that helper pointed at Endur,
 * and this module builds the three actions the wallet needs.
 */

import { rpc } from './rpc'
import type { STRK20_ACTION } from '@starknet-io/types-js'
import { walletFelt, TOKENS } from './config'
import { openNoteRef } from './actions'

/** Deployed LumenVault instance; empty until the mainnet deploy lands. */
const RAW_VAULT_ADDRESS = process.env.NEXT_PUBLIC_LUMEN_VAULT_ADDRESS ?? ''

export const VAULT_ADDRESS = RAW_VAULT_ADDRESS ? walletFelt(RAW_VAULT_ADDRESS) : ''

/** The asset staked, and the receipt credited back. Pinned in the contract too. */
export const STAKE_ASSET = 'strkBTC' as const
export const STAKE_RECEIPT = 'xstrkBTC' as const

export function stakingEnabled(): boolean {
  return VAULT_ADDRESS.length > 0
}

const hex = (value: bigint) => `0x${value.toString(16)}`

/**
 * Stake shielded strkBTC into Endur without unshielding it.
 *
 * Three actions, and the order is the one the pool documents:
 *
 *   1. `withdraw` the strkBTC to the helper — not an unshield: the helper
 *      returns everything to the pool inside the same transaction, which is
 *      what `assertNeverUnshields` is asked to confirm at the call site.
 *   2. `transfer` with amount `OPEN` creates the note the shares land in. It
 *      is opened in **xstrkBTC**, the receipt token, not in strkBTC.
 *   3. `invoke` the helper, handing it that note.
 *
 * Calldata is deserialized straight into `privacy_invoke(note_id, min_shares)`,
 * so its order matches that signature exactly.
 *
 * `minShares` is a floor, not a promise: an ERC-4626 exchange rate moves
 * between quoting and execution, and a caller that quoted a rate should be able
 * to refuse a worse fill rather than discover it afterwards. Zero opts out.
 */
export function buildPrivateStake(input: {
  amount: bigint
  /** The user's own address — owner of the resulting shielded note. */
  recipient: string
  minShares: bigint
}): STRK20_ACTION[] {
  if (!stakingEnabled()) throw new Error('Private staking is not enabled on this deployment yet.')
  if (input.amount <= 0n) throw new Error('Stake an amount above zero.')

  return [
    {
      type: 'withdraw',
      token: walletFelt(TOKENS[STAKE_ASSET].address),
      amount: hex(input.amount),
      recipient: VAULT_ADDRESS,
    },
    {
      type: 'transfer',
      token: walletFelt(TOKENS[STAKE_RECEIPT].address),
      amount: 'OPEN',
      recipient: walletFelt(input.recipient),
    },
    {
      type: 'invoke',
      contract: VAULT_ADDRESS,
      calldata: [openNoteRef(0), hex(input.minShares < 0n ? 0n : input.minShares)],
    },
  ]
}

/**
 * Shares `assets` would mint at the current rate.
 *
 * Read through the helper rather than straight from Endur, so the number the
 * UI shows and the number the transaction produces come down the same path. A
 * preview that disagrees with execution makes every floor either useless or a
 * guaranteed revert.
 *
 * Returns `null` when the read fails — a rate is a nicety, and a staking screen
 * that cannot render because an RPC blinked is not.
 */
export async function previewStake(assets: bigint): Promise<bigint | null> {
  if (!stakingEnabled() || assets <= 0n) return null
  try {
    const result = await rpc().callContract({
      contractAddress: VAULT_ADDRESS,
      entrypoint: 'preview_stake',
      calldata: [hex(assets)],
    })
    const first = result?.[0]
    return first === undefined ? null : BigInt(first)
  } catch {
    return null
  }
}

/**
 * The floor to send with a stake, from a quoted preview.
 *
 * Expressed in basis points of slippage so the caller states a tolerance rather
 * than doing arithmetic. Endur's rate drifts upward as rewards accrue, so this
 * mostly guards against a read that was already stale, not against a market.
 */
export function floorFromPreview(previewed: bigint, slippageBps = 50n): bigint {
  if (previewed <= 0n) return 0n
  const floor = (previewed * (10_000n - slippageBps)) / 10_000n
  return floor > 0n ? floor : 0n
}

/**
 * Whether a stake of exactly `assets` landed since `sinceBlock`.
 *
 * `LumenVault` emits `Staked` on every successful deposit, so a stake — unlike
 * a private transfer — has an outcome the chain can be asked about. That is
 * what lets the UI stop believing the wallet: the first stake on mainnet
 * succeeded while the button sat on "Waiting for your wallet…" forever.
 *
 * This matches on amount within a short window rather than on something only
 * this user could have produced, because a stake carries no commitment of
 * ours. It is strong evidence rather than proof — and the guard's habit of
 * rewriting round amounts works in its favour, since two identical non-round
 * stakes seconds apart is not a case that occurs. Used only to resolve a
 * wallet that has gone quiet, never to claim a stake that was not requested.
 */
export async function stakeLanded(assets: bigint, sinceBlock: number): Promise<boolean> {
  if (!stakingEnabled() || assets <= 0n) return false
  try {
    const events = await rpc().getEvents({
      address: VAULT_ADDRESS,
      from_block: { block_number: Math.max(0, sinceBlock) },
      to_block: 'latest',
      chunk_size: 100,
    })
    return (events?.events ?? []).some((event) => {
      const first = event.data?.[0]
      try {
        return first !== undefined && BigInt(first) === assets
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

/** Current head, so a settlement scan starts where the submission did. */
export async function currentBlock(): Promise<number> {
  try {
    return await rpc().getBlockNumber()
  } catch {
    return 0
  }
}
