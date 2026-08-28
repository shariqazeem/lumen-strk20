// @vitest-environment node

/**
 * The escrow rails carry money behind a hash — a drift between this file and
 * `contracts/src/escrow.cairo` would mint links the contract cannot find. The
 * commitment vector here is pinned against the SAME constant as the Cairo
 * test `test_claim_commitment_matches_client_vector`; neither side may change
 * without the other.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const ESCROW = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
/** What the builders hand the wallet: the same felt, minimal hex. */
const ESCROW_SENT = `0x${BigInt(ESCROW).toString(16)}`

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS', ESCROW)
})

async function lib() {
  return await import('../escrow')
}

describe('commitments', () => {
  it('matches the pinned Cairo vector for secret 0x1234', async () => {
    const { claimCommitment } = await lib()
    expect(claimCommitment('0x1234')).toBe(
      '0x308c7c8531f0e0d2789204d5bd59baa4b55308631b86215304789c774ac500d',
    )
  })

  it('claim and refund domains never collide', async () => {
    const { claimCommitment, refundCommitment } = await lib()
    expect(claimCommitment('0x1234')).not.toBe(refundCommitment('0x1234'))
  })
})

describe('secrets', () => {
  it('generates felt-safe, distinct, non-zero secrets', async () => {
    const { generateSecret } = await lib()
    const a = generateSecret()
    const b = generateSecret()
    expect(a).not.toBe(b)
    const value = BigInt(a)
    expect(value).toBeGreaterThan(0n)
    // 248 bits stays strictly below the felt prime (~2^251.5).
    expect(value < 2n ** 248n).toBe(true)
  })
})

describe('action builders', () => {
  it('fund is withdraw-to-escrow then Deposit invoke, in that order', async () => {
    const { buildEscrowFund, claimCommitment, refundCommitment } = await lib()
    const actions = buildEscrowFund({
      token: '0xt0ken',
      amount: 149_884_201n,
      claimSecret: '0xaaa',
      refundSecret: '0xbbb',
      expiry: 1_756_600_000,
    })
    expect(actions).toHaveLength(2)
    expect(actions[0]).toEqual({
      type: 'withdraw',
      // Not a felt, so it passes through untouched — see `walletFelt`.
      token: '0xt0ken',
      amount: `0x${(149_884_201n).toString(16)}`,
      recipient: ESCROW_SENT,
    })
    const invoke = actions[1]
    if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
    expect(invoke.contract).toBe(ESCROW_SENT)
    // [op, claim, refund, expiry, token, amount, secret, note, batch_len]
    expect(invoke.calldata).toEqual([
      '0x0',
      claimCommitment('0xaaa'),
      refundCommitment('0xbbb'),
      `0x${(1_756_600_000).toString(16)}`,
      '0xt0ken',
      `0x${(149_884_201n).toString(16)}`,
      '0x0',
      '0x0',
      '0x0',
    ])
  })

  it('claim opens a note first and passes the secret before the note ref', async () => {
    const { buildEscrowClaim } = await lib()
    const actions = buildEscrowClaim({
      token: '0xt0ken',
      recipient: '0xme',
      secret: '0xsec',
    })
    expect(actions[0]).toEqual({
      type: 'transfer',
      token: '0xt0ken',
      amount: 'OPEN',
      recipient: '0xme',
    })
    const invoke = actions[1]
    if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
    expect(invoke.calldata?.[0]).toBe('0x1')
    expect(invoke.calldata?.[6]).toBe('0xsec')
    expect(invoke.calldata?.[7]).toBe('${openNoteIds[0]}')
  })

  it('refund uses the Refund discriminant on the same shape', async () => {
    const { buildEscrowRefund } = await lib()
    const actions = buildEscrowRefund({ token: '0xt', recipient: '0xme', secret: '0xr' })
    const invoke = actions[1]
    if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
    expect(invoke.calldata?.[0]).toBe('0x2')
  })

  /**
   * An escrow is superseded, never emptied. A link minted before a redeploy is
   * still sitting in the older one, and an exit built against the current
   * address finds no entry and reverts — which is what happened on mainnet to
   * a 2 STRK link left in the second escrow.
   */
  it('exits against the escrow that holds the entry, not the newest one', async () => {
    const { buildEscrowRefund, buildEscrowClaim } = await lib()
    const older = '0x43e41de87ebfaec2913a85398a68e011ab2a92bbddb9211956bfabe6ed57288'

    for (const actions of [
      buildEscrowRefund({ token: '0xt', recipient: '0xme', secret: '0xr', escrowAddress: older }),
      buildEscrowClaim({ token: '0xt', recipient: '0xme', secret: '0xs', escrowAddress: older }),
    ]) {
      const invoke = actions[1]
      if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
      expect(invoke.contract).toBe(older)
    }
  })

  it('still defaults to the current escrow when no holder is named', async () => {
    const { buildEscrowRefund } = await lib()
    const invoke = buildEscrowRefund({ token: '0xt', recipient: '0xme', secret: '0xr' })[1]
    if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
    expect(invoke.contract).toBe(ESCROW_SENT)
  })
})

describe('link codec', () => {
  it('round-trips a payload with unicode intact through the fragment', async () => {
    const { encodeClaimLink, decodeClaimLink } = await lib()
    const payload = {
      v: 1 as const,
      s: '0x1234abcd',
      t: '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
      a: '52880000',
      f: 'Shariq',
      n: 'Coffee ☕️ — thanks!',
    }
    const url = encodeClaimLink('https://lumen-strk20.vercel.app', payload)
    expect(url.startsWith('https://lumen-strk20.vercel.app/claim#')).toBe(true)
    // Fragment must be URL-safe: no +, /, = that chat apps mangle.
    const fragment = url.split('#')[1]
    expect(/^[A-Za-z0-9_-]+$/.test(fragment)).toBe(true)
    const back = decodeClaimLink(`#${fragment}`)
    // The compact codec returns canonical padded felts; the value is identical.
    expect(BigInt(back!.s)).toBe(BigInt(payload.s))
    expect(BigInt(back!.t)).toBe(BigInt(payload.t))
    expect(back!.a).toBe(payload.a)
    expect(back!.f).toBe(payload.f)
    expect(back!.n).toBe(payload.n)
  })

  it('rejects garbage, wrong versions, and non-hex secrets', async () => {
    const { decodeClaimLink } = await lib()
    expect(decodeClaimLink('#not-base64!!')).toBeNull()
    expect(decodeClaimLink(`#${btoa(JSON.stringify({ v: 2, s: '0x1', t: '0x1', a: '1' }))}`)).toBeNull()
    expect(
      decodeClaimLink(`#${btoa(JSON.stringify({ v: 1, s: 'hello', t: '0x1', a: '1' }))}`),
    ).toBeNull()
  })
})

describe('batch claim links', () => {
  it('carries one withdraw for the total and one invoke for every leg', async () => {
    const { buildEscrowFundMany, claimCommitment, refundCommitment } = await lib()
    const actions = buildEscrowFundMany({
      token: '0xt0ken',
      expiry: 1_756_600_000,
      legs: [
        { amount: 41_003_117n, claimSecret: '0xa1', refundSecret: '0xb1' },
        { amount: 8_819_443n, claimSecret: '0xa2', refundSecret: '0xb2' },
      ],
    })
    expect(actions).toHaveLength(2)

    const total = 41_003_117n + 8_819_443n
    expect(actions[0]).toEqual({
      type: 'withdraw',
      token: '0xt0ken',
      amount: `0x${total.toString(16)}`,
      recipient: ESCROW_SENT,
    })

    const invoke = actions[1]
    if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
    // [op, claim, refund, expiry, token, amount, secret, note, len, ...legs]
    expect(invoke.calldata).toEqual([
      '0x3',
      '0x0',
      '0x0',
      `0x${(1_756_600_000).toString(16)}`,
      '0xt0ken',
      `0x${total.toString(16)}`,
      '0x0',
      '0x0',
      '0x2',
      claimCommitment('0xa1'),
      refundCommitment('0xb1'),
      `0x${(41_003_117n).toString(16)}`,
      claimCommitment('0xa2'),
      refundCommitment('0xb2'),
      `0x${(8_819_443n).toString(16)}`,
    ])
  })

  it('withdraws exactly the sum, so the contract cannot be asked for more', async () => {
    const { buildEscrowFundMany } = await lib()
    const legs = [7n, 13n, 29n].map((amount, i) => ({
      amount,
      claimSecret: `0x${i + 1}a`,
      refundSecret: `0x${i + 1}b`,
    }))
    const actions = buildEscrowFundMany({ token: '0xt', legs, expiry: 0 })
    if (actions[0].type !== 'withdraw') throw new Error('first action must be withdraw')
    expect(BigInt(actions[0].amount)).toBe(49n)
  })

  it('refuses an empty batch and one past the contract limit', async () => {
    const { buildEscrowFundMany, MAX_BATCH } = await lib()
    expect(() => buildEscrowFundMany({ token: '0xt', legs: [], expiry: 0 })).toThrow(
      /at least one/,
    )
    const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      amount: 1_000n,
      claimSecret: `0x${(i + 1).toString(16)}a`,
      refundSecret: `0x${(i + 1).toString(16)}b`,
    }))
    expect(() => buildEscrowFundMany({ token: '0xt', legs: tooMany, expiry: 0 })).toThrow(
      /at most 32/,
    )
  })

  it('every single-leg operation still passes an empty batch payload', async () => {
    // The Cairo signature ends in `Span<EscrowLeg>`; omitting it would shift
    // nothing but would deserialise as a missing argument.
    const { buildEscrowFund, buildEscrowClaim, buildEscrowRefund } = await lib()
    const fund = buildEscrowFund({
      token: '0xt',
      amount: 1n,
      claimSecret: '0xa',
      refundSecret: '0xb',
      expiry: 1_756_600_000,
    })
    for (const actions of [
      fund,
      buildEscrowClaim({ token: '0xt', recipient: '0xme', secret: '0xs' }),
      buildEscrowRefund({ token: '0xt', recipient: '0xme', secret: '0xr' }),
    ]) {
      const invoke = actions[1]
      if (invoke.type !== 'invoke') throw new Error('second action must be invoke')
      expect(invoke.calldata).toHaveLength(9)
      expect(invoke.calldata?.[8]).toBe('0x0')
    }
  })
})

describe('wallet payload shape', () => {
  it('writes every address as minimal hex, never zero-padded', async () => {
    // Verified against a wallet on mainnet: the same action array passes with
    // minimal hex and fails, as INVALID_REQUEST_PAYLOAD, when zero-padded to
    // 64 digits. The error names no field, so this is pinned here instead.
    const { buildEscrowFund, buildEscrowClaim, buildEscrowFundMany } = await lib()
    const everything = [
      ...buildEscrowFund({
        token: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
        amount: 1n,
        claimSecret: '0xa',
        refundSecret: '0xb',
        expiry: 1_756_600_000,
      }),
      ...buildEscrowClaim({ token: '0xabc', recipient: '0xdef', secret: '0x1' }),
      ...buildEscrowFundMany({
        token: '0xabc',
        expiry: 0,
        legs: [{ amount: 5n, claimSecret: '0x1a', refundSecret: '0x1b' }],
      }),
    ]

    for (const action of everything) {
      for (const field of ['token', 'recipient', 'contract'] as const) {
        const value = (action as Record<string, unknown>)[field]
        if (typeof value !== 'string') continue
        expect(value, `${action.type}.${field}`).toMatch(/^0x(0|[1-9a-f][0-9a-f]*)$/)
      }
    }
  })
})

describe('the public door', () => {
  it('is a plain contract call, not a pool action', async () => {
    // No shielded balance, no registration, no pool fee — which is the whole
    // point. It also means the caller can be a relayer paying the gas.
    const { buildPublicClaim } = await lib()
    const call = buildPublicClaim({
      escrowAddress: ESCROW,
      secret: '0x00abc',
      recipient: '0x0def',
    })
    expect(call.entrypoint).toBe('claim_to_address')
    expect(call.calldata).toEqual(['0xabc', '0xdef'])
    expect(call.contractAddress).toBe(`0x${BigInt(ESCROW).toString(16)}`)
  })

  it('refuses to pay nobody', async () => {
    const { buildPublicClaim } = await lib()
    expect(() =>
      buildPublicClaim({ escrowAddress: ESCROW, secret: '0x1', recipient: '0x0' }),
    ).toThrow(/needs an address/)
  })

  it('knows every escrow that has ever held a link', async () => {
    // A redeploy is a version, not a replacement: a link minted against an
    // older escrow must still open. Removing one strands money.
    const { KNOWN_ESCROWS } = await lib()
    expect(KNOWN_ESCROWS.length).toBeGreaterThanOrEqual(2)
    const seen = new Set(KNOWN_ESCROWS.map((a) => BigInt(a).toString()))
    expect(seen.size).toBe(KNOWN_ESCROWS.length)
  })
})
