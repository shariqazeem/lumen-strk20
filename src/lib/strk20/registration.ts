'use client'

/**
 * Is this account able to receive a private transfer yet?
 *
 * The pool's own rule, from the STRK20 docs: *"An account must register in the
 * pool (set a viewing key) before it can hold or receive private balances;
 * both sender and recipient must be registered before private transfers
 * between them."*
 *
 * That is a real product boundary, not an edge case. Sending to someone who
 * has never touched the pool cannot work, and finding out at the wallet prompt
 * is the worst possible moment. The pool exposes `get_public_key(user_addr)`,
 * which is zero for an account that has never registered — so the answer is
 * readable before anyone signs anything.
 *
 * And the answer has somewhere good to go: a claim link needs no registration
 * at all, because the escrow holds the money behind a hash until whoever opens
 * it arrives. "They cannot receive this" becomes "send them a link instead",
 * which is the same sentence the whole product is built on.
 *
 * Read-only, on a public RPC, about an address the user typed. Nothing here
 * touches a key or asks the wallet for anything.
 */

import { POOL_ADDRESS } from './config'
import { rpcFetch } from './rpc'

/** `get_public_key` — the pool's registration record for an account. */
const GET_PUBLIC_KEY = '0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b'

/** Starknet JSON-RPC: the node looked for the contract and there was none. */
const CONTRACT_NOT_FOUND = 20

export type Registration = 'registered' | 'unregistered' | 'unknown'

/**
 * `unknown` is deliberate and is not an error: if the RPC cannot be reached,
 * the honest answer is that we do not know, and the caller must not turn that
 * into a claim in either direction.
 */
export async function readRegistration(address: string): Promise<Registration> {
  let normalised: string
  try {
    if (BigInt(address) <= 0n) return 'unknown'
    normalised = address
  } catch {
    return 'unknown'
  }

  try {
    const body = await rpcFetch<string[]>('starknet_call', [
      {
        contract_address: POOL_ADDRESS,
        entry_point_selector: GET_PUBLIC_KEY,
        calldata: [normalised],
      },
      'latest',
    ])
    if (body.error || !Array.isArray(body.result)) return 'unknown'
    const key = body.result[0]
    if (typeof key !== 'string') return 'unknown'
    return BigInt(key) === 0n ? 'unregistered' : 'registered'
  } catch {
    return 'unknown'
  }
}

/**
 * Has this account contract actually been deployed?
 *
 * A Starknet account address exists before its contract does — it is derived
 * from the public key, and the deployment happens on first use. An undeployed
 * account can *receive* an ERC-20 perfectly well but cannot *send* anything,
 * which is a confusing failure for someone whose wallet shows a balance and a
 * green tick.
 *
 * It matters most on the public claim path, which is aimed squarely at people
 * whose wallet is minutes old.
 */
export async function isAccountDeployed(address: string): Promise<boolean | null> {
  try {
    const body = await rpcFetch<string>('starknet_getClassHashAt', ['latest', address])
    if (typeof body.result === 'string') return BigInt(body.result) !== 0n
    // Only one error means "not deployed": the node looked and found nothing.
    // Every other error — and no answer at all — is ignorance, and saying
    // "not deployed" from ignorance is how a retired endpoint turns into a
    // confident wrong answer on the claim page.
    return body.error?.code === CONTRACT_NOT_FOUND ? false : null
  } catch {
    // Unknown, and the caller must not turn that into a claim either way.
    return null
  }
}
