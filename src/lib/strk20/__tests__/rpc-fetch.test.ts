// @vitest-environment node

/**
 * The JSON-RPC fallback, and the distinction it exists to keep.
 *
 * This is regression cover for a bug that reached production: `RPC_URL` kept
 * its own hardcoded default after the shared endpoint list had moved on, so
 * two readers went on POSTing to an endpoint that had been retired and now
 * answers HTTP 410 with `{"error": "This endpoint has been discontinued."}`.
 *
 * The mirror went blank, which was survivable. The claim page did something
 * worse: it read that body's `error` key as a node-level failure and told
 * people with a brand-new wallet that their account was not deployed. A dead
 * endpoint had been turned into a confident wrong answer.
 *
 * So: a node that answered "no such contract" told us something. A node that
 * is gone told us nothing. These pin that they stay different.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rpcFetch, RPC_URLS } from '../rpc'
import { isAccountDeployed } from '../registration'

const ADDRESS = '0x048f5f116ba486a0799e3d7f0b6a2f1e5c8d3a9b7f4e2c1d0a9b8c7d6e5f4a3b'

const reply = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)

/** What lava.build actually returns since it was retired. */
const discontinued = () =>
  reply({ error: 'This endpoint has been discontinued.', message: 'see gateway' }, false)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rpcFetch', () => {
  it('has more than one endpoint to fall through to', () => {
    expect(RPC_URLS.length).toBeGreaterThan(1)
  })

  it('skips an endpoint that answers with a non-ok status', async () => {
    vi.mocked(fetch)
      .mockReturnValueOnce(discontinued())
      .mockReturnValueOnce(reply({ result: '0x1' }))
    expect((await rpcFetch<string>('starknet_getClassHashAt', [])).result).toBe('0x1')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('skips an endpoint whose transport fails', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(reply({ result: '0x9' }))
    expect((await rpcFetch<string>('starknet_call', [])).result).toBe('0x9')
  })

  it('returns a genuine node error rather than trying the next node', async () => {
    vi.mocked(fetch).mockReturnValue(reply({ error: { code: 20, message: 'not found' } }))
    const body = await rpcFetch<string>('starknet_getClassHashAt', [])
    expect(body.error?.code).toBe(20)
    // One answer is an answer. Shopping for a different one would be wrong.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns nothing at all when no endpoint answers', async () => {
    vi.mocked(fetch).mockReturnValue(discontinued())
    const body = await rpcFetch<string>('starknet_call', [])
    expect(body.result).toBeUndefined()
    expect(body.error).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(RPC_URLS.length)
  })
})

describe('isAccountDeployed', () => {
  it('is true for an account with a class hash', async () => {
    vi.mocked(fetch).mockReturnValue(reply({ result: '0x816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253' }))
    expect(await isAccountDeployed(ADDRESS)).toBe(true)
  })

  it('is false only when the node looked and found nothing', async () => {
    vi.mocked(fetch).mockReturnValue(reply({ error: { code: 20, message: 'Contract not found' } }))
    expect(await isAccountDeployed(ADDRESS)).toBe(false)
  })

  it('is unknown — not false — when every endpoint is dead', async () => {
    // The bug. `false` here tells a real person their wallet does not exist.
    vi.mocked(fetch).mockReturnValue(discontinued())
    expect(await isAccountDeployed(ADDRESS)).toBeNull()
  })

  it('is unknown — not false — on any error that is not CONTRACT_NOT_FOUND', async () => {
    vi.mocked(fetch).mockReturnValue(reply({ error: { code: 429, message: 'rate limited' } }))
    expect(await isAccountDeployed(ADDRESS)).toBeNull()
  })
})
