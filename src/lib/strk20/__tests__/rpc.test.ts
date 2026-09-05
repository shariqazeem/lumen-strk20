// @vitest-environment node

/**
 * The read fallback, pinned.
 *
 * Every panel that reads the chain shares one provider. When its endpoint
 * goes quiet — public ones do, under load, on the day it matters — a read
 * that can be answered elsewhere should be, and whoever answered should keep
 * answering. That last part is not a nicety: `getEvents` continuation tokens
 * belong to the node that issued them, so a scan that hopped nodes between
 * pages could restart and double-count. Sticky beats wrong.
 */

import { describe, expect, it } from 'vitest'
import type { RpcProvider } from 'starknet'
import { withFallback } from '../rpc'

type Fake = { getBlockNumber: () => Promise<number>; calls: number }
const node = (behaviour: () => Promise<number>): Fake & RpcProvider => {
  const fake: Fake = {
    calls: 0,
    getBlockNumber: async () => {
      fake.calls += 1
      return behaviour()
    },
  }
  return fake as unknown as Fake & RpcProvider
}
const ok = (n: number) => node(async () => n)
const down = () =>
  node(async () => {
    throw new Error('rate limited')
  })

describe('withFallback', () => {
  it('answers from the first node that works', async () => {
    const a = down()
    const b = ok(42)
    expect(await withFallback([a, b]).getBlockNumber()).toBe(42)
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(1)
  })

  it('sticks to the node that answered', async () => {
    const a = down()
    const b = ok(7)
    const provider = withFallback([a, b])
    await provider.getBlockNumber()
    await provider.getBlockNumber()
    await provider.getBlockNumber()
    // The dead node is not re-tried on every call — one failure moved the
    // default, and it stays moved.
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(3)
  })

  it('surfaces the last error when every node fails', async () => {
    await expect(withFallback([down(), down()]).getBlockNumber()).rejects.toThrow('rate limited')
  })

  it('refuses an empty list rather than silently never answering', () => {
    expect(() => withFallback([])).toThrow()
  })
})
