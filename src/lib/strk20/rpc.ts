'use client'

/**
 * One provider for every read, with somewhere to go when it fails.
 *
 * Nothing in this app needs a key to read the chain, and that is a property
 * worth keeping: a clone must run out of the box, and the observatory's whole
 * argument is that it computes from what anyone can see. But keyless public
 * endpoints are rate-limited and go quiet under load — and when the only one
 * configured goes quiet, every panel that reads the chain goes silent at once,
 * on exactly the day someone is judging it.
 *
 * So reads try a short list in order. The list is the operator's own URL first
 * when one is set, then the public endpoints that actually answered when this
 * was written (several well-known ones did not).
 *
 * The fallback is **sticky**: once an endpoint fails, the next one becomes the
 * default for the rest of the session. That is not only a performance choice.
 * `getEvents` pages with a continuation token that is meaningful to the node
 * that issued it, and a scan that switched nodes between pages would either
 * error or, worse, quietly restart from the top and double-count. Sticking to
 * one node per sequence keeps a mid-scan failure at "silence this time", which
 * every caller already handles, and never at "wrong number".
 *
 * Only reads are retried. Anything that submits is the wallet's job here, and
 * a submit retried on a second node is how you pay twice.
 */

import { RpcProvider } from 'starknet'

/** Tried in order. Verified 5 Sep 2026: these two answer `starknet_blockNumber` without a key. */
export const PUBLIC_RPC_URLS = [
  'https://rpc.starknet.lava.build:443',
  'https://1rpc.io/starknet',
] as const

export const RPC_URLS: readonly string[] = [
  ...new Set(
    [process.env.NEXT_PUBLIC_STARKNET_RPC_URL, ...PUBLIC_RPC_URLS].filter(
      (url): url is string => typeof url === 'string' && url.length > 0,
    ),
  ),
]

/** Read methods it is safe to answer from a different node. */
const RETRYABLE = new Set<PropertyKey>([
  'getBlockNumber',
  'getBlockLatestAccepted',
  'getBlockWithTxHashes',
  'getEvents',
  'callContract',
  'getClassHashAt',
  'getClassAt',
  'getTransactionReceipt',
  'getTransactionByHash',
  'waitForTransaction',
])

let providers: RpcProvider[] | null = null

function pool(): RpcProvider[] {
  providers ??= RPC_URLS.map((nodeUrl) => new RpcProvider({ nodeUrl }))
  return providers
}

/**
 * Build a provider whose retryable reads fall through the endpoint list.
 *
 * Exposed so tests can hand in their own list; the app uses `rpc()`.
 */
export function withFallback(list: readonly RpcProvider[]): RpcProvider {
  if (list.length === 0) throw new Error('withFallback needs at least one provider')
  let current = 0

  return new Proxy(list[0]!, {
    get(_target, prop) {
      const primary = list[current]!
      const value = Reflect.get(primary, prop, primary) as unknown
      if (typeof value !== 'function') return value
      if (!RETRYABLE.has(prop)) return (value as (...a: unknown[]) => unknown).bind(primary)

      return async (...args: unknown[]) => {
        let lastError: unknown
        for (let attempt = 0; attempt < list.length; attempt += 1) {
          const index = (current + attempt) % list.length
          const node = list[index]!
          try {
            const fn = Reflect.get(node, prop, node) as (...a: unknown[]) => Promise<unknown>
            const result = await fn.apply(node, args)
            // Whoever answered becomes the default from here on.
            current = index
            return result
          } catch (error) {
            lastError = error
          }
        }
        throw lastError
      }
    },
  })
}

let shared: RpcProvider | null = null

/** The app's provider. One instance, shared, sticky across failures. */
export function rpc(): RpcProvider {
  shared ??= withFallback(pool())
  return shared
}
