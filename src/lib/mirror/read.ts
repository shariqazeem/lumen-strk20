'use client'

/**
 * Reading a public address the way a stranger would.
 *
 * Everything here comes from `starknet_getEvents` against an ordinary public
 * RPC — no indexer, no API key, no server of ours. That is the point: if
 * Lumen needed privileged access to produce this, it would prove nothing. The
 * whole argument is that *anyone* can compute it.
 *
 * Starknet ERC-20s emit `Transfer` with `keys = [selector, from, to]` and
 * `data = [low, high]`, so the sender and recipient are filterable server-side
 * and a single address's history comes back in a handful of requests.
 */

import { RPC_URL, TOKENS, type TokenSymbol } from '@/lib/strk20/config'

/** `Transfer` — the standard ERC-20 event selector on Starknet. */
const TRANSFER = '0x0099cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9'

/** Assets worth reading. Enough to see a life; few enough to stay fast. */
const WATCHED: TokenSymbol[] = ['STRK', 'USDC', 'strkBTC', 'ETH']

/**
 * Pages per direction per token.
 *
 * `getEvents` pages by *blocks scanned*, not by results, so a page limit does
 * not trim the tail of a result set — it stops the scan partway through the
 * window and returns whatever was found in the oldest part of it. That is the
 * wrong half: recent behaviour is what a stranger reads. So the window is
 * walked from the recent end in slices, and a slice that fills up simply
 * reports that the picture is partial.
 */
const MAX_PAGES = 2
const CHUNK = 100

/** Roughly 1.7s blocks on Starknet mainnet, measured 2026-08-28. */
const BLOCKS_PER_DAY = Math.round(86_400 / 1.7)

export interface PublicTransfer {
  token: TokenSymbol
  amount: bigint
  direction: 'in' | 'out'
  /** The other side. Public, because a transfer names both ends. */
  counterparty: string
  blockNumber: number
  /** Estimated — see `interpolator`. */
  timestamp: number
  txHash: string
}

export interface MirrorRead {
  address: string
  transfers: PublicTransfer[]
  days: number
  /** True when a page limit was hit, so the picture is partial and says so. */
  truncated: boolean
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'RPC error')
  return body.result as T
}

/**
 * Block number → wall clock.
 *
 * `getEvents` returns a block number and no timestamp, and fetching a block
 * per event would be hundreds of requests. Starknet's block time is regular
 * enough that two real anchors interpolate the rest to within a minute or so —
 * far inside what a cadence measured in days needs. Anything reading these
 * timestamps must treat them as estimates, and the UI says so.
 */
async function interpolator(head: number, back: number) {
  const [a, b] = await Promise.all([
    rpc<{ timestamp: number }>('starknet_getBlockWithTxHashes', [{ block_number: head }]),
    rpc<{ timestamp: number }>('starknet_getBlockWithTxHashes', [{ block_number: back }]),
  ])
  const perBlock = (a.timestamp - b.timestamp) / (head - back)
  return (block: number) => (a.timestamp + (block - head) * perBlock) * 1000
}

/** One direction of one token. */
async function readLeg(
  token: TokenSymbol,
  address: string,
  direction: 'in' | 'out',
  fromBlock: number,
  toBlock: number,
): Promise<{ raw: { block: number; hash: string; keys: string[]; data: string[] }[]; more: boolean }> {
  const keys = direction === 'out' ? [[TRANSFER], [address]] : [[TRANSFER], [], [address]]
  const raw: { block: number; hash: string; keys: string[]; data: string[] }[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await rpc<{
      events?: { block_number: number; transaction_hash: string; keys: string[]; data: string[] }[]
      continuation_token?: string
    }>('starknet_getEvents', [
      {
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        address: TOKENS[token].address,
        keys,
        chunk_size: CHUNK,
        ...(cursor ? { continuation_token: cursor } : {}),
      },
    ])

    for (const event of result.events ?? []) {
      raw.push({
        block: event.block_number,
        hash: event.transaction_hash,
        keys: event.keys,
        data: event.data,
      })
    }
    cursor = result.continuation_token
    if (!cursor) return { raw, more: false }
  }
  return { raw, more: Boolean(cursor) }
}

/** A u256 split across two felts, as every Starknet ERC-20 emits it. */
function u256(data: string[]): bigint {
  const low = BigInt(data[0] ?? '0x0')
  const high = BigInt(data[1] ?? '0x0')
  return low + (high << 128n)
}

/** Felt comparison that survives zero-padding differences. */
function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

/**
 * Everything a stranger can see about one address over the last `days`.
 *
 * Legs run in parallel because six sequential round trips is the difference
 * between a demo and a wait.
 */
export async function readPublicHistory(
  address: string,
  days = 7,
  /** Called as each asset's history lands, so the page can fill in live. */
  onProgress?: (partial: PublicTransfer[], done: number, total: number) => void,
): Promise<MirrorRead> {
  // `starknet_blockNumber` answers with a bare number, not an object.
  const tip = await rpc<number>('starknet_blockNumber', [])
  if (!Number.isFinite(tip) || tip <= 0) throw new Error('Could not read the chain head.')

  const fromBlock = Math.max(0, tip - days * BLOCKS_PER_DAY)
  const at = await interpolator(tip, Math.max(0, tip - 50_000))

  const transfers: PublicTransfer[] = []
  let truncated = false
  let done = 0
  const jobs = WATCHED.flatMap((token) => (['in', 'out'] as const).map((d) => ({ token, d })))

  await Promise.all(
    jobs.map(async ({ token, d: direction }) => {
      const leg = await readLeg(token, address, direction, fromBlock, tip)
      if (leg.more) truncated = true
      for (const event of leg.raw) {
        const [, from, to] = event.keys
        // A self-transfer is noise, not a relationship.
        if (from && to && sameFelt(from, to)) continue
        transfers.push({
          token,
          amount: u256(event.data),
          direction,
          counterparty: direction === 'out' ? (to ?? '0x0') : (from ?? '0x0'),
          blockNumber: event.block,
          timestamp: at(event.block),
          txHash: event.hash,
        })
      }
      done += 1
      transfers.sort((a, b) => a.timestamp - b.timestamp)
      onProgress?.([...transfers], done, jobs.length)
    }),
  )

  transfers.sort((a, b) => a.timestamp - b.timestamp)
  return { address, transfers, days, truncated }
}
