// @vitest-environment node

/**
 * The stake payload.
 *
 * Every rule pinned here was learned from a mainnet failure, not from the docs —
 * the docs contradicted themselves and two readings of them were wrong. Felts go
 * to the wallet as minimal hex; an `invoke` needs its `withdraw`; an `OPEN` note
 * has to be the one the helper fills; and calldata is deserialized straight into
 * `privacy_invoke`'s parameters, so its order is the signature's order.
 *
 * The one that is specific to staking: the open note is in the *receipt* token.
 * Opening it in strkBTC would make the pool try to fill a note that does not
 * exist, and the failure would arrive as a bare execution revert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VAULT = '0x73e57be7d6c9d2321d7a01d0c2e426392fd5e736ecfbcd91d4216ba5d7a5f67'
const STRKBTC = '0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135'
const XSTRKBTC = '0x047751b3532fabca89b0f2e35ca1cb45e5a7b11d5e3d3663dfa1f4406b45fd88'
const ME = '0x05db1a4f8e0c7b6d3a2f9e1c4b7a0d3f6e9c2b5a8d1f4e7c0b3a6d9f2e5c8b10'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_LUMEN_VAULT_ADDRESS', VAULT)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function lib() {
  return import('../vault')
}

async function actionsFor(amount: bigint, minShares = 0n) {
  const { buildPrivateStake } = await lib()
  return buildPrivateStake({ amount, recipient: ME, minShares })
}

describe('buildPrivateStake', () => {
  it('emits the three legs in the order the pool documents', async () => {
    const actions = await actionsFor(20_000n)
    expect(actions.map((a) => a.type)).toEqual(['withdraw', 'transfer', 'invoke'])
  })

  it('funds the helper, and nothing else', async () => {
    const [withdraw] = await actionsFor(20_000n)
    if (withdraw.type !== 'withdraw') throw new Error('first action must be a withdraw')
    expect(BigInt(withdraw.recipient)).toBe(BigInt(VAULT))
    expect(BigInt(withdraw.token)).toBe(BigInt(STRKBTC))
  })

  it('opens the note in the receipt token, not the asset', async () => {
    // Opening it in strkBTC is the mistake that reverts with nothing to read.
    const [, open] = await actionsFor(20_000n)
    if (open.type !== 'transfer') throw new Error('second action must open a note')
    expect(open.amount).toBe('OPEN')
    expect(BigInt(open.token)).toBe(BigInt(XSTRKBTC))
    expect(BigInt(open.recipient)).toBe(BigInt(ME))
  })

  it('hands the helper the note ref first, then the floor', async () => {
    // Calldata order is `privacy_invoke(note_id, min_shares)`, exactly.
    const [, , invoke] = await actionsFor(20_000n, 19_800n)
    if (invoke.type !== 'invoke') throw new Error('third action must be an invoke')
    expect(BigInt(invoke.contract)).toBe(BigInt(VAULT))
    expect(invoke.calldata).toEqual(['${openNoteIds[0]}', '0x4d58'])
  })

  it('writes amounts as minimal hex, never zero-padded', async () => {
    // A padded felt was rejected as INVALID_REQUEST_PAYLOAD on mainnet, and the
    // "fix" that padded them was itself the bug.
    const [withdraw, , invoke] = await actionsFor(1n, 1n)
    if (withdraw.type !== 'withdraw' || invoke.type !== 'invoke') throw new Error('shape')
    expect(withdraw.amount).toBe('0x1')
    expect(invoke.calldata?.[1]).toBe('0x1')
  })

  it('treats a negative floor as no floor rather than underflowing', async () => {
    const [, , invoke] = await actionsFor(20_000n, -5n)
    if (invoke.type !== 'invoke') throw new Error('shape')
    expect(invoke.calldata?.[1]).toBe('0x0')
  })

  it('refuses an empty stake', async () => {
    await expect(actionsFor(0n)).rejects.toThrow(/above zero/)
  })

  it('refuses to build when no vault is deployed', async () => {
    vi.stubEnv('NEXT_PUBLIC_LUMEN_VAULT_ADDRESS', '')
    vi.resetModules()
    await expect(actionsFor(20_000n)).rejects.toThrow(/not enabled/)
  })
})

describe('the unshield guard', () => {
  it('passes when the helper is the one in this transaction', async () => {
    const { assertNeverUnshields } = await import('../actions')
    const actions = await actionsFor(20_000n)
    expect(() => assertNeverUnshields(actions, { contracts: [VAULT] })).not.toThrow()
  })

  it('refuses the same payload if the helper is not allowlisted', async () => {
    // The invariant that separates a private stake from an unshield. If this
    // ever passes by accident, Lumen is a mixer with extra steps.
    const { assertNeverUnshields } = await import('../actions')
    const actions = await actionsFor(20_000n)
    expect(() => assertNeverUnshields(actions, { contracts: [] })).toThrow(/unshield/)
  })
})

describe('floorFromPreview', () => {
  it('takes the stated slippage off the quote', async () => {
    const { floorFromPreview } = await lib()
    // 50 bps under 100_000_000.
    expect(floorFromPreview(100_000_000n)).toBe(99_500_000n)
    expect(floorFromPreview(100_000_000n, 0n)).toBe(100_000_000n)
  })

  it('never returns a floor above the quote', async () => {
    const { floorFromPreview } = await lib()
    for (const quote of [1n, 7n, 99_415_375n]) {
      expect(floorFromPreview(quote)).toBeLessThanOrEqual(quote)
    }
  })

  it('opts out rather than flooring a quote that failed', async () => {
    const { floorFromPreview } = await lib()
    expect(floorFromPreview(0n)).toBe(0n)
  })
})
