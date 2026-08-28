// @vitest-environment node

/**
 * The split has one job: make the exit amount a worse thing to match against.
 * Two ways it could fail silently — losing a wei, or producing parts so tidy
 * they are their own signature — and both are worse than not splitting.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  vi.stubEnv(
    'NEXT_PUBLIC_LUMEN_SPLITTER_ADDRESS',
    '0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0',
  )
})

async function lib() {
  return await import('../scatter')
}

describe('scatter', () => {
  it('never loses or invents a wei', async () => {
    const { scatter } = await lib()
    for (const amount of [1_000_000n, 999_999_999_999_999_999n, 42_424_242n]) {
      for (const count of [2, 3, 5, 9]) {
        const parts = scatter(amount, count, amount.toString().length * count)
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(amount)
      }
    }
  })

  it('produces unequal parts — equal ones are their own signature', async () => {
    const { scatter } = await lib()
    const parts = scatter(1_000_000_000n, 4, 7)
    expect(parts).toHaveLength(4)
    expect(new Set(parts.map(String)).size).toBe(4)
  })

  it('leaves no part round, which is the entire point', async () => {
    const { scatter } = await lib()
    const parts = scatter(500_000_000n, 5, 99)
    // A round exit is what re-links a withdrawal to a deposit.
    for (const part of parts) expect(part % 1_000_000n).not.toBe(0n)
  })

  it('splits the same balance differently for different seeds', async () => {
    const { scatter } = await lib()
    const a = scatter(1_000_000_000n, 4, 1).join(',')
    const b = scatter(1_000_000_000n, 4, 2).join(',')
    expect(a).not.toBe(b)
  })

  it('is deterministic for one seed, so a retry is not a new fingerprint', async () => {
    const { scatter } = await lib()
    expect(scatter(1_000_000_000n, 4, 5)).toEqual(scatter(1_000_000_000n, 4, 5))
  })

  it('refuses to split an amount too small to split usefully', async () => {
    const { scatter } = await lib()
    // Dust broken into parts is still dust, and now it is dust in a pattern.
    expect(scatter(500n, 4, 1)).toEqual([500n])
    expect(scatter(0n, 4, 1)).toEqual([])
  })

  it("honours the contract's own leg cap", async () => {
    const { scatter, MAX_SPLITS } = await lib()
    expect(scatter(10n ** 18n, 500, 3)).toHaveLength(MAX_SPLITS)
  })
})

describe('scatterPlan', () => {
  it('keeps the value inside the pool — the splitter is both taker and helper', async () => {
    const { scatterPlan, SPLITTER_ADDRESS } = await lib()
    const plan = scatterPlan({ token: '0xt', amount: 10n ** 9n, count: 3, seed: 4 })
    expect(plan).not.toBeNull()
    expect(plan!.takerAddress).toBe(SPLITTER_ADDRESS)
    expect(plan!.splitterAddress).toBe(SPLITTER_ADDRESS)
    expect(plan!.parts.reduce((a, b) => a + b, 0n)).toBe(plan!.amountIn)
  })

  it('declines rather than splitting when there is nothing to gain', async () => {
    const { scatterPlan } = await lib()
    expect(scatterPlan({ token: '0xt', amount: 100n, count: 4, seed: 1 })).toBeNull()
  })
})
