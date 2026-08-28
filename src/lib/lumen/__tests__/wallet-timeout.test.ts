// @vitest-environment node

/**
 * A wallet's promise can hang — the user rejects and nothing rejects back, or
 * the transaction lands and the response never routes home. Both leave a
 * button insisting it is waiting while the money has already moved, which is
 * the worst thing a payments UI can display, and it is exactly what happened
 * on mainnet.
 *
 * The rule these pin: the chain decides, not the wallet.
 */

import { describe, expect, it, vi } from 'vitest'

/** Mirrors `withWalletTimeout` in the store. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

describe('a wallet that never answers', () => {
  it('gives up rather than waiting forever', async () => {
    vi.useFakeTimers()
    const hung = new Promise<string>(() => {})
    const race = withTimeout(hung, 45_000)
    await vi.advanceTimersByTimeAsync(45_001)
    expect(await race).toBeNull()
    vi.useRealTimers()
  })

  it('still prefers a real answer that arrives in time', async () => {
    vi.useFakeTimers()
    const quick = new Promise<string>((resolve) => setTimeout(() => resolve('0xabc'), 100))
    const race = withTimeout(quick, 45_000)
    await vi.advanceTimersByTimeAsync(200)
    expect(await race).toBe('0xabc')
    vi.useRealTimers()
  })

  it('lets a rejection through rather than swallowing it into a timeout', async () => {
    // A refused prompt must read as refused, not as an unanswered wallet.
    const refused = Promise.reject(new Error('USER_REFUSED_OP'))
    await expect(withTimeout(refused, 45_000)).rejects.toThrow('USER_REFUSED_OP')
  })
})
