// @vitest-environment node

/**
 * Two mainnet failures are pinned here.
 *
 * One: a claim landed, the wallet's promise never resolved, and the button sat
 * on "Waiting for your wallet…" while the money was already gone from the
 * escrow. The rule: the chain decides, not the wallet.
 *
 * Two: a wallet prompt appeared for a transaction the user had already
 * confirmed and dismissed. A wallet queues what it cannot show at once, so a
 * request raised while another is open resurfaces later with no context. The
 * rule: one request at a time, released when the wallet answers — not when the
 * app stops listening.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Gate = typeof import('../wallet-gate')

let gate: Gate

beforeEach(async () => {
  // The lock is module state, so each test gets a fresh module.
  vi.resetModules()
  gate = await import('../wallet-gate')
})

const never = () => new Promise<string>(() => {})
const stillOpen = async () => false

describe('one wallet request at a time', () => {
  it('refuses a second request while the first is open', async () => {
    const first = gate.walletRequest(never)
    await expect(gate.walletRequest(never)).rejects.toThrow(gate.WALLET_BUSY_MESSAGE)
    expect(gate.walletIsBusy()).toBe(true)
    void first
  })

  it('releases once the wallet answers', async () => {
    await gate.walletRequest(async () => '0xabc')
    expect(gate.walletIsBusy()).toBe(false)
    await expect(gate.walletRequest(async () => '0xdef')).resolves.toBe('0xdef')
  })

  it('releases when the wallet refuses, so a retry is possible', async () => {
    await expect(
      gate.walletRequest(async () => {
        throw new Error('USER_REFUSED_OP')
      }),
    ).rejects.toThrow('USER_REFUSED_OP')
    expect(gate.walletIsBusy()).toBe(false)
  })

  it('stays held after the app gives up, because the wallet has not', async () => {
    vi.useFakeTimers()
    const raced = gate.raceTheChain(gate.walletRequest(never), stillOpen)
    await vi.advanceTimersByTimeAsync(gate.CLAIM_WATCH_MS + gate.CLAIM_POLL_MS)
    expect(await raced).toBeNull()
    // The prompt is still sitting in the wallet. Letting a retry through here
    // is exactly how a duplicate prompt gets made.
    expect(gate.walletIsBusy()).toBe(true)
    vi.useRealTimers()
  })
})

describe('racing the wallet against the chain', () => {
  it('prefers the wallet’s own answer when it arrives', async () => {
    vi.useFakeTimers()
    const quick = new Promise<string>((resolve) => setTimeout(() => resolve('0xabc'), 100))
    const raced = gate.raceTheChain(quick, stillOpen)
    await vi.advanceTimersByTimeAsync(200)
    expect(await raced).toBe('0xabc')
    vi.useRealTimers()
  })

  it('reports success from the chain when the wallet goes quiet', async () => {
    vi.useFakeTimers()
    let landed = false
    setTimeout(() => {
      landed = true
    }, 20_000)
    const raced = gate.raceTheChain(never(), async () => landed)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await raced).toBe('settled')
    vi.useRealTimers()
  })

  it('lets a refusal through rather than swallowing it into a timeout', async () => {
    const refused = Promise.reject(new Error('USER_REFUSED_OP'))
    await expect(gate.raceTheChain(refused, stillOpen)).rejects.toThrow('USER_REFUSED_OP')
  })

  it('keeps asking after an RPC read throws', async () => {
    vi.useFakeTimers()
    let asked = 0
    const flaky = async () => {
      asked += 1
      if (asked < 3) throw new Error('RPC down')
      return true
    }
    const raced = gate.raceTheChain(never(), flaky)
    await vi.advanceTimersByTimeAsync(gate.CLAIM_POLL_MS * 4)
    // A failed read is not evidence that nothing happened.
    expect(await raced).toBe('settled')
    expect(asked).toBe(3)
    vi.useRealTimers()
  })
})
