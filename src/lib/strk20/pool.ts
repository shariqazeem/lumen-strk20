'use client'

/**
 * Direct reads from the STRK20 pool contract.
 */

import { RpcProvider, hash } from 'starknet'
import { rpc } from './rpc'
import { FALLBACK_POOL_FEE_STRK, POOL_ADDRESS, RPC_URL } from './config'

/**
 * The flat fee the pool charges per private operation, in STRK wei.
 *
 * Always read this rather than trusting a constant. Mainnet currently returns
 * 6 STRK while the published docs say 4 — and the failure mode is nasty:
 * a MAX amount computed from the low figure is accepted by the UI, signed by
 * the user, and only then rejected by the pool.
 *
 * Falls back to the last known value rather than throwing, so a flaky RPC
 * degrades the MAX button instead of breaking the whole shield form.
 */
export async function readPoolFee(rpcUrl: string = RPC_URL): Promise<{
  fee: bigint
  live: boolean
}> {
  try {
    const provider = rpcUrl === RPC_URL ? rpc() : new RpcProvider({ nodeUrl: rpcUrl })
    const result = await provider.callContract({
      contractAddress: POOL_ADDRESS,
      entrypoint: 'get_fee_amount',
      calldata: [],
    })

    const word = Array.isArray(result) ? result[0] : undefined
    if (!word) return { fee: FALLBACK_POOL_FEE_STRK, live: false }

    return { fee: BigInt(word), live: true }
  } catch {
    return { fee: FALLBACK_POOL_FEE_STRK, live: false }
  }
}

/** Precomputed for callers that want to compare against a raw event key. */
export const GET_FEE_AMOUNT_SELECTOR = hash.getSelectorFromName('get_fee_amount')
