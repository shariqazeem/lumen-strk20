// @vitest-environment node

/**
 * The private-swap action set, assembled without AVNU's paymaster.
 *
 * The SDK's `executePrivateSwap` routes through a paymaster whose `toRpcFeeMode`
 * always asks for `sponsored_private` — a mode gated behind an API key, which a
 * browser cannot hold. Verified against the live paymaster: SNIP-29 code 163,
 * `data: "x-paymaster-api-key is invalid"`.
 *
 * Everything the paymaster contributed was submission, and the wallet already
 * submits every other private operation here. So the action set is built
 * locally and the paymaster's fee leg — payment for a relay this route no
 * longer uses — goes with it.
 */

import { describe, expect, it } from 'vitest'
import { buildPrivateDefi, assertNeverUnshields } from '../actions'

const EXECUTOR = '0x0426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const STRKBTC = '0x0787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135'
const ME = '0x05db1a4f8e0c7b6d3a2f9e1c4b7a0d3f6e9c2b5a8d1f4e7c0b3a6d9f2e5c8b10'

const plan = () => ({
  tokenIn: STRK,
  amountIn: 300_000_000_000_000_000_000n,
  tokenOut: STRKBTC,
  helperAddress: EXECUTOR,
  takerAddress: ME,
  helperCalldata: ['0x2', '0xabc', '0xdef'],
})

describe('the paymaster-free swap payload', () => {
  it('is three legs, with no fee withdraw', () => {
    const actions = buildPrivateDefi(plan())
    expect(actions.map((a) => a.type)).toEqual(['withdraw', 'transfer', 'invoke'])
  })

  it('still emits a fee leg when a route genuinely charges one', () => {
    const actions = buildPrivateDefi({
      ...plan(),
      fee: { token: STRK, amount: 1_000n, recipient: EXECUTOR },
    })
    expect(actions.map((a) => a.type)).toEqual(['withdraw', 'withdraw', 'transfer', 'invoke'])
  })

  it('funds the executor and opens the note in the buy token', () => {
    const [withdraw, open] = buildPrivateDefi(plan())
    if (withdraw.type !== 'withdraw' || open.type !== 'transfer') throw new Error('shape')
    expect(BigInt(withdraw.recipient)).toBe(BigInt(EXECUTOR))
    expect(BigInt(withdraw.token)).toBe(BigInt(STRK))
    expect(open.amount).toBe('OPEN')
    expect(BigInt(open.token)).toBe(BigInt(STRKBTC))
  })

  it('passes the executor its own signature order: buy token, calls, note', () => {
    const invoke = buildPrivateDefi(plan())[2]
    if (invoke.type !== 'invoke') throw new Error('shape')
    expect(invoke.calldata).toEqual([
      '0x787150e306e6eae6e3f79dea881770e8bbff2c1b8eb490f969669ee945b3135',
      '0x2',
      '0xabc',
      '0xdef',
      '${openNoteIds[0]}',
    ])
  })

  it('strips the zero-padding AVNU may hand back', () => {
    // A padded felt was rejected on mainnet, and these addresses come from a
    // third-party API that makes no promises about their spelling.
    const felts: string[] = []
    for (const action of buildPrivateDefi(plan())) {
      // Narrowed per variant rather than by ternary: a `deposit` action has no
      // `recipient`, and the union does not let you ask for one.
      if (action.type === 'invoke') {
        felts.push(action.contract)
      } else if (action.type === 'withdraw' || action.type === 'transfer') {
        felts.push(action.token, action.recipient)
      } else {
        felts.push(action.token)
      }
    }
    expect(felts.length).toBeGreaterThan(0)
    for (const felt of felts) {
      expect(felt.startsWith('0x0'), felt).toBe(false)
    }
  })

  it('writes the sell amount as minimal hex', () => {
    const [withdraw] = buildPrivateDefi({ ...plan(), amountIn: 1n })
    if (withdraw.type !== 'withdraw') throw new Error('shape')
    expect(withdraw.amount).toBe('0x1')
  })
})

describe('the unshield guard on a swap', () => {
  it('passes when the executor is the one in this transaction', () => {
    const actions = buildPrivateDefi(plan())
    expect(() => assertNeverUnshields(actions, { contracts: [EXECUTOR] })).not.toThrow()
  })

  it('refuses when the withdraw goes somewhere unaccounted for', () => {
    const actions = buildPrivateDefi(plan())
    expect(() => assertNeverUnshields(actions, { contracts: [STRK] })).toThrow(/unshield/)
  })
})
