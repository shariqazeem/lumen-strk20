'use client'

/**
 * Live pool activity, read from mainnet.
 *
 * The anonymity-set and timing terms of the privacy score are only meaningful
 * if they are measured against what the pool is actually doing. Inventing this
 * data would make the score a decoration, so it is read from chain events and
 * the UI reports plainly when it could not be.
 */

import { RpcProvider } from 'starknet'
import { rpc } from './rpc'
import type { PoolActivity } from '@/lib/engine/types'
import { POOL_ADDRESS, RPC_URL, tokenByAddress } from './config'

/** Blocks to look back. Roughly the window the score's A_set term assumes. */
export const ACTIVITY_WINDOW_BLOCKS = 1000

export interface PoolActivityResult {
  activity: PoolActivity
  /** False when the RPC could not be reached — the caller must not pretend otherwise. */
  live: boolean
  fromBlock: number
  toBlock: number
  eventCount: number
  error?: string
}

/** An empty, explicitly non-live activity set. Scores computed from this are zero. */
export function emptyActivity(): PoolActivity {
  return { tierCounts: {}, interArrivalsMs: [], totalNotes: 0 }
}

/**
 * Bucket a raw amount into a log-scaled denomination tier.
 *
 * Only usable for amounts Lumen already knows locally — the user's own notes
 * and planned splits. It cannot be applied to other users' pool activity,
 * because those amounts are never published; see `readPoolActivity`.
 */
export function denominationTier(raw: bigint): string {
  if (raw <= 0n) return 'zero'
  return `1e${raw.toString().length - 1}`
}

/**
 * Read recent pool events and summarise them for the engine.
 *
 * Deliberately does not throw: a missing or rate-limited RPC must degrade to
 * `live: false` so the UI can say "not measured" instead of showing a
 * confident number computed from nothing.
 */
export async function readPoolActivity(
  rpcUrl: string = RPC_URL,
): Promise<PoolActivityResult> {
  const provider = rpcUrl === RPC_URL ? rpc() : new RpcProvider({ nodeUrl: rpcUrl })

  try {
    const latest = await provider.getBlockLatestAccepted()
    const toBlock = latest.block_number
    const fromBlock = Math.max(0, toBlock - ACTIVITY_WINDOW_BLOCKS)

    const tierCounts: Record<string, number> = {}
    let eventCount = 0
    const eventBlocks: number[] = []
    let continuation: string | undefined

    // Page through the window. Capped so a busy pool cannot hang the UI.
    for (let page = 0; page < 6; page += 1) {
      const response = await provider.getEvents({
        address: POOL_ADDRESS,
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        chunk_size: 1000,
        continuation_token: continuation,
      })

      for (const event of response.events) {
        eventCount += 1
        if (typeof event.block_number === 'number') eventBlocks.push(event.block_number)

        // Bucket by asset, not by amount.
        //
        // Amounts are NOT recoverable here, and that is the pool working
        // correctly: a private action emits a commitment, not a value.
        // Verified against mainnet — these events carry three keys and a
        // single data word. Code that tiered them by "the first non-zero data
        // word" would be bucketing commitment hashes and reporting a
        // confident, meaningless anonymity-set number.
        //
        // These are Cairo 1 events, so indexed `#[key]` fields — including
        // `token` — live in `keys`, after the selector at keys[0]. Grouping by
        // token is the honest measure: a shielded strkBTC note hides among
        // other strkBTC actions, and the count of those is observable even
        // though their sizes are not.
        const assetKey = event.keys?.[1] ?? event.keys?.[0]
        if (assetKey) {
          const token = tokenByAddress(assetKey)
          const bucket = token ? token.symbol : assetKey
          tierCounts[bucket] = (tierCounts[bucket] ?? 0) + 1
        }
      }

      continuation = response.continuation_token
      if (!continuation) break
    }

    // Inter-arrival gaps, derived from where events actually landed.
    //
    // Filling this with a constant would be worse than leaving it empty: the
    // timing term measures *variance*, so uniform gaps would report the pool as
    // perfectly periodic and quietly corrupt the score. Instead, take the real
    // spacing between the blocks events occurred in and scale it by the
    // window's measured average block time. Events sharing a block give a gap
    // of zero, which is genuine information about burstiness.
    const [fromHeader, toHeader] = await Promise.all([
      provider.getBlockWithTxHashes(fromBlock).catch(() => null),
      provider.getBlockWithTxHashes(toBlock).catch(() => null),
    ])

    const spanMs =
      fromHeader && toHeader && 'timestamp' in fromHeader && 'timestamp' in toHeader
        ? (Number(toHeader.timestamp) - Number(fromHeader.timestamp)) * 1000
        : 0

    const blockSpan = Math.max(1, toBlock - fromBlock)
    const msPerBlock = spanMs > 0 ? spanMs / blockSpan : 0

    const interArrivalsMs: number[] = []
    if (msPerBlock > 0) {
      eventBlocks.sort((a, b) => a - b)
      for (let i = 1; i < eventBlocks.length; i += 1) {
        interArrivalsMs.push((eventBlocks[i] - eventBlocks[i - 1]) * msPerBlock)
      }
    }

    return {
      activity: {
        tierCounts,
        interArrivalsMs,
        totalNotes: eventCount,
      },
      live: true,
      fromBlock,
      toBlock,
      eventCount,
    }
  } catch (error) {
    return {
      activity: emptyActivity(),
      live: false,
      fromBlock: 0,
      toBlock: 0,
      eventCount: 0,
      error:
        error instanceof Error
          ? error.message
          : 'Could not reach the Starknet RPC endpoint.',
    }
  }
}
