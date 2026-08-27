// @vitest-environment node

/**
 * Connecting is the app's front door, and it used to fail in the one way that
 * looks like the app's fault rather than the wallet's: `WalletAccountV6.connect`
 * reads `accounts[0]?.address` and returns an account with `address:
 * undefined` when the wallet has not authorised yet. Several wallets resolve
 * `connect()` the instant their approval window opens, so that path is normal,
 * not exotic — and taking it at face value is what made a reload look like the
 * fix.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const connect = vi.fn()

// Only the three exports this module tree actually reaches. Spreading the
// real package instead costs seconds of module loading per run, for nothing.
vi.mock('starknet', () => ({
  WalletAccountV6: { connect },
  RpcProvider: class {},
  constants: { StarknetChainId: { SN_MAIN: '0x534e5f4d41494e' } },
}))

type Listener = () => void

/** A wallet that authorises after `approveAfter` ms, or never. */
function fakeWallet({
  approveAfter,
  address = '0x05db1e2c3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c23048',
}: {
  approveAfter: number | null
  address?: string
}) {
  const listeners = new Set<Listener>()
  const wallet = {
    name: 'Ready X',
    accounts: [] as { address: string }[],
    features: {
      'standard:events': {
        on: (_event: string, listener: Listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  }
  if (approveAfter !== null) {
    setTimeout(() => {
      wallet.accounts = [{ address }]
      for (const listener of listeners) listener()
    }, approveAfter)
  }
  return { wallet, listenerCount: () => listeners.size }
}

async function lib() {
  return await import('../wallet')
}

describe('connectWallet', () => {
  beforeEach(() => {
    connect.mockReset()
  })

  it('returns the account when the wallet is already authorised', async () => {
    connect.mockResolvedValue({ address: '0x1234' })
    const { wallet } = fakeWallet({ approveAfter: null })
    const { connectWallet } = await lib()
    const account = await connectWallet(wallet as never)
    expect(account.address).toBe('0x1234')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('waits out the approval window instead of reporting a bad connection', async () => {
    const address = '0x05db1e2c3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c23048'
    // First call lands while the approval window is still open.
    connect.mockResolvedValueOnce({ address: undefined })
    connect.mockResolvedValueOnce({ address })
    const { wallet } = fakeWallet({ approveAfter: 30 })
    const { connectWallet } = await lib()
    const account = await connectWallet(wallet as never)
    expect(account.address).toBe(address)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('drops its listener once the wallet authorises', async () => {
    connect.mockResolvedValueOnce({ address: undefined })
    connect.mockResolvedValueOnce({ address: '0x99' })
    const { wallet, listenerCount } = fakeWallet({ approveAfter: 20 })
    const { connectWallet } = await lib()
    await connectWallet(wallet as never)
    expect(listenerCount()).toBe(0)
  })

  it('names the wallet when it never shares an account', async () => {
    vi.useFakeTimers()
    connect.mockResolvedValue({ address: undefined })
    const { wallet } = fakeWallet({ approveAfter: null })
    const { connectWallet } = await lib()
    const attempt = connectWallet(wallet as never)
    const assertion = expect(attempt).rejects.toThrow(/Ready X did not share an account/)
    await vi.advanceTimersByTimeAsync(95_000)
    await assertion
    vi.useRealTimers()
  })

  it('rejects an address that is present but empty', async () => {
    vi.useFakeTimers()
    // A zero address is a wallet saying "no account" in a different dialect.
    connect.mockResolvedValue({ address: '0x0' })
    const { wallet } = fakeWallet({ approveAfter: null })
    const { connectWallet } = await lib()
    const attempt = connectWallet(wallet as never)
    const assertion = expect(attempt).rejects.toThrow(/did not share an account/)
    await vi.advanceTimersByTimeAsync(95_000)
    await assertion
    vi.useRealTimers()
  })
})
