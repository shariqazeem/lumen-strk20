// @vitest-environment node

/**
 * Arrival detection is inference, not observation, so its contract is mostly
 * about restraint: never invent an arrival, never double-count one, and treat
 * the first ever read as a baseline rather than a windfall.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadArrivals, syncArrivals } from '../arrivals'
import type { LedgerEntry } from '@/lib/history'
import type { ShieldedBalance } from '@/lib/strk20/wallet'

class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

const g = globalThis as unknown as { window?: unknown; localStorage?: MemoryStorage }

beforeEach(() => {
  const store = new MemoryStorage()
  g.localStorage = store
  g.window = { localStorage: store }
})

afterEach(() => {
  delete g.localStorage
  delete g.window
})

const ACCOUNT = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const T0 = 1_756_000_000_000

const usdc = (raw: bigint): ShieldedBalance => ({
  symbol: 'USDC',
  address: '0x1',
  raw,
  decimals: 6,
})

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 'e',
  timestamp: T0 + 1000,
  type: 'SHIELD',
  asset: 'USDC',
  amount: 0n,
  route: 'DIRECT',
  observer: '—',
  ...over,
})

describe('baseline', () => {
  it('reports nothing on the first read, however large the balance', () => {
    const { fresh } = syncArrivals(ACCOUNT, [usdc(5_000_000n)], [], T0)
    expect(fresh).toEqual([])
    expect(loadArrivals(ACCOUNT)).toEqual([])
  })
})

describe('detection', () => {
  it('reports growth this device cannot explain', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    const { fresh } = syncArrivals(ACCOUNT, [usdc(1_500_000n)], [], T0 + 60_000)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].amountRaw).toBe('500000')
    expect(fresh[0].token).toBe('USDC')
  })

  it('stays silent when our own deposit explains the growth', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    const ledger = [entry({ type: 'SHIELD', amount: 500_000n, timestamp: T0 + 10 })]
    const { fresh } = syncArrivals(ACCOUNT, [usdc(1_500_000n)], ledger, T0 + 60_000)
    expect(fresh).toEqual([])
  })

  it('still spots the unexplained part alongside our own deposit', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    const ledger = [entry({ type: 'SHIELD', amount: 500_000n, timestamp: T0 + 10 })]
    const { fresh } = syncArrivals(ACCOUNT, [usdc(1_700_000n)], ledger, T0 + 60_000)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].amountRaw).toBe('200000')
  })

  it('never reports an arrival when the balance falls', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    const ledger = [entry({ type: 'TRANSFER', amount: 400_000n, timestamp: T0 + 10 })]
    const { fresh } = syncArrivals(ACCOUNT, [usdc(600_000n)], ledger, T0 + 60_000)
    expect(fresh).toEqual([])
  })

  it('does not re-report the same arrival on the next read', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    syncArrivals(ACCOUNT, [usdc(1_500_000n)], [], T0 + 60_000)
    const second = syncArrivals(ACCOUNT, [usdc(1_500_000n)], [], T0 + 120_000)
    expect(second.fresh).toEqual([])
    expect(second.arrivals).toHaveLength(1)
  })

  it('ignores ledger entries from before the snapshot', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    // A deposit that predates the snapshot is already inside the baseline.
    const ledger = [entry({ type: 'SHIELD', amount: 900_000n, timestamp: T0 - 500_000 })]
    const { fresh } = syncArrivals(ACCOUNT, [usdc(1_400_000n)], ledger, T0 + 60_000)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].amountRaw).toBe('400000')
  })

  it('treats an outgoing claim link as an outflow', () => {
    syncArrivals(ACCOUNT, [usdc(1_000_000n)], [], T0)
    const ledger = [entry({ type: 'LINK', amount: 300_000n, timestamp: T0 + 10 })]
    const { fresh } = syncArrivals(ACCOUNT, [usdc(700_000n)], ledger, T0 + 60_000)
    expect(fresh).toEqual([])
  })
})

describe('resilience', () => {
  it('is SSR-safe with no storage', () => {
    delete g.window
    delete g.localStorage
    expect(() => syncArrivals(ACCOUNT, [usdc(1n)], [], T0)).not.toThrow()
    expect(loadArrivals(ACCOUNT)).toEqual([])
  })

  it('drops corrupt stored rows', () => {
    g.localStorage?.setItem(
      `lumen:arrivals:v1:${BigInt(ACCOUNT).toString(16)}`,
      JSON.stringify([
        { id: 'a', token: 'USDC', amountRaw: '1', detectedAt: 1 },
        { id: 'b', token: 'DOGE', amountRaw: '1', detectedAt: 1 },
        { id: 'c', token: 'USDC', amountRaw: 'xyz', detectedAt: 1 },
        null,
      ]),
    )
    expect(loadArrivals(ACCOUNT)).toHaveLength(1)
  })
})
