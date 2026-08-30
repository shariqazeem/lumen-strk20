'use client'

/**
 * Asking the chain whether an operation landed.
 *
 * A wallet's promise can go quiet after the transaction has already succeeded,
 * and a button that waits forever on it is the worst thing this product can
 * display. It has happened on four separate paths now, each time fixed only
 * for that path — so this is the shared answer instead.
 *
 * The rule is simple: **if an operation has a leg the public chain can see, it
 * can be confirmed without the wallet.** Most do.
 *
 * | operation | public leg |
 * |---|---|
 * | shield | ERC-20 into the pool |
 * | unshield / cash out | ERC-20 out of the pool, to the user |
 * | private swap | ERC-20 out of the pool, to AVNU's executor |
 * | claim-link mint | escrow entry written |
 * | claim / refund | escrow entry taken |
 * | stake | `Staked` emitted by LumenVault |
 *
 * The exception is the private transfer, which by design leaves nothing but a
 * fee. That one genuinely has to wait, and saying so is more honest than
 * inventing a signal for it.
 *
 * These probes match on token, amount and a window opened at submission — not
 * on something only this user could have produced, because a pool leg carries
 * no commitment of ours. That makes them strong evidence rather than proof,
 * and the amount guard's habit of rewriting round numbers works in their
 * favour. They are used only to resolve a wallet that has gone silent, never
 * to claim an operation nobody asked for.
 */

import { RpcProvider, hash } from 'starknet'
import { POOL_ADDRESS, RPC_URL, walletFelt } from './config'

let provider: RpcProvider | null = null
function rpc(): RpcProvider {
  provider ??= new RpcProvider({ nodeUrl: RPC_URL })
  return provider
}

const TRANSFER = hash.getSelectorFromName('Transfer')

/** Head of chain, so a scan starts where the submission did. */
export async function chainHead(): Promise<number> {
  try {
    return await rpc().getBlockNumber()
  } catch {
    return 0
  }
}

/**
 * Whether `amount` of `token` crossed the pool boundary since `sinceBlock`.
 *
 * `direction` is from the pool's point of view: `out` covers a withdraw leg —
 * an unshield, or the funding leg of a swap or an escrow mint — and `in`
 * covers a deposit.
 */
export async function poolLegLanded(input: {
  token: string
  amount: bigint
  direction: 'in' | 'out'
  sinceBlock: number
}): Promise<boolean> {
  if (input.amount <= 0n) return false
  // Starknet ERC-20s emit `Transfer` with `[selector, from, to]` as keys, so
  // one side is filterable server-side and the scan stays small.
  const pool = walletFelt(POOL_ADDRESS)
  const keys =
    input.direction === 'out' ? [[TRANSFER], [pool]] : [[TRANSFER], [], [pool]]
  try {
    const page = await rpc().getEvents({
      address: walletFelt(input.token),
      from_block: { block_number: Math.max(0, input.sinceBlock) },
      to_block: 'latest',
      keys,
      chunk_size: 100,
    })
    return (page?.events ?? []).some((event) => {
      try {
        const low = BigInt(event.data?.[0] ?? '0x0')
        const high = BigInt(event.data?.[1] ?? '0x0')
        return (low | (high << 128n)) === input.amount
      } catch {
        return false
      }
    })
  } catch {
    // A flaky read is not evidence that nothing happened; the caller retries.
    return false
  }
}
