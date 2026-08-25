import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LEDGER_CAP,
  appendLedger,
  clearLedger,
  ledgerKey,
  loadLedger,
  syntheticNotesFromBalances,
  toEngineHistory,
  type LedgerEntry,
} from '../history'

/**
 * The vitest environment is node, so there is no DOM localStorage. The module
 * resolves storage through `globalThis`, so a plain Map-backed shim is enough.
 */
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

const g = globalThis as unknown as { localStorage?: MemoryStorage }

beforeEach(() => {
  g.localStorage = new MemoryStorage()
})

afterEach(() => {
  delete g.localStorage
})

const NOW = Date.UTC(2026, 7, 18, 9, 30, 0)
const ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

const entry = (over: Partial<Omit<LedgerEntry, 'id'>> = {}): Omit<LedgerEntry, 'id'> => ({
  timestamp: NOW,
  type: 'SWAP',
  asset: 'STRK',
  amount: 4_100_370_000_000_000_000_000n,
  route: 'AVNU',
  txHash: '0xabc123',
  observer: 'executor → AMM',
  ...over,
})

describe('ledgerKey', () => {
  it('normalizes padded, unpadded and mixed-case spellings to one key', () => {
    expect(ledgerKey('0x0abc')).toBe(ledgerKey('0xabc'))
    expect(ledgerKey('0x00ABC')).toBe(ledgerKey('0xabc'))
    expect(ledgerKey('0xabc')).toBe('lumen:ledger:v1:abc')
  })

  it('keeps distinct accounts distinct', () => {
    expect(ledgerKey('0xabc')).not.toBe(ledgerKey('0xabd'))
  })

  it('does not throw on garbage input', () => {
    expect(ledgerKey('not-an-address')).toContain('not-an-address')
  })
})

describe('loadLedger / appendLedger round-trip', () => {
  it('revives amounts as bigint, exactly', () => {
    appendLedger(ADDRESS, entry())
    const loaded = loadLedger(ADDRESS)
    expect(loaded).toHaveLength(1)
    expect(typeof loaded[0].amount).toBe('bigint')
    expect(loaded[0].amount).toBe(4_100_370_000_000_000_000_000n)
    expect(loaded[0].type).toBe('SWAP')
    expect(loaded[0].route).toBe('AVNU')
    expect(loaded[0].txHash).toBe('0xabc123')
    expect(loaded[0].observer).toBe('executor → AMM')
    expect(loaded[0].id).toBeTruthy()
  })

  it('prepends: newest entry first, and returns the same list it persisted', () => {
    appendLedger(ADDRESS, entry({ timestamp: NOW - 1000, amount: 1n }))
    const returned = appendLedger(ADDRESS, entry({ timestamp: NOW, amount: 2n }))
    expect(returned.map((e) => e.amount)).toEqual([2n, 1n])
    expect(loadLedger(ADDRESS).map((e) => e.amount)).toEqual([2n, 1n])
  })

  it('reads the same ledger through padded and unpadded addresses', () => {
    appendLedger('0x0abc', entry({ amount: 7n }))
    const viaUnpadded = loadLedger('0xabc')
    expect(viaUnpadded).toHaveLength(1)
    expect(viaUnpadded[0].amount).toBe(7n)
  })

  it('caps the ledger at 500 entries, dropping the oldest', () => {
    for (let i = 0; i < LEDGER_CAP + 5; i += 1) {
      appendLedger(ADDRESS, entry({ timestamp: NOW + i, amount: BigInt(i) }))
    }
    const loaded = loadLedger(ADDRESS)
    expect(loaded).toHaveLength(LEDGER_CAP)
    // Newest survives at the front; the five oldest fell off the end.
    expect(loaded[0].amount).toBe(BigInt(LEDGER_CAP + 4))
    expect(loaded[loaded.length - 1].amount).toBe(5n)
  })

  it('clearLedger removes the account ledger and nothing else', () => {
    appendLedger(ADDRESS, entry())
    appendLedger('0x999', entry({ amount: 9n }))
    clearLedger(ADDRESS)
    expect(loadLedger(ADDRESS)).toEqual([])
    expect(loadLedger('0x999')).toHaveLength(1)
  })
})

describe('loadLedger — corruption tolerance', () => {
  it('returns [] for unparseable JSON', () => {
    g.localStorage?.setItem(ledgerKey(ADDRESS), '{definitely not json')
    expect(loadLedger(ADDRESS)).toEqual([])
  })

  it('returns [] for JSON that is not an array', () => {
    g.localStorage?.setItem(ledgerKey(ADDRESS), '{"a":1}')
    expect(loadLedger(ADDRESS)).toEqual([])
    g.localStorage?.setItem(ledgerKey(ADDRESS), '42')
    expect(loadLedger(ADDRESS)).toEqual([])
  })

  it('drops malformed rows but keeps the well-formed ones', () => {
    const good = {
      id: 'a',
      timestamp: NOW,
      type: 'SWAP',
      asset: 'USDC',
      amount: '123',
      route: 'AVNU',
      observer: '—',
    }
    const badAmount = { ...good, id: 'b', amount: 'xyz' }
    // UNSHIELD became a legal type when Lumen added explicit cash-outs, so the
    // invalid-type example must be something no version ever accepted.
    const badType = { ...good, id: 'c', type: 'TELEPORT' }
    const badAsset = { ...good, id: 'd', asset: 'DOGE' }
    g.localStorage?.setItem(
      ledgerKey(ADDRESS),
      JSON.stringify([good, badAmount, badType, badAsset, null, 'junk']),
    )
    const loaded = loadLedger(ADDRESS)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('a')
    expect(loaded[0].amount).toBe(123n)
  })

  it('is SSR-safe: no storage at all means an empty ledger, not a throw', () => {
    delete g.localStorage
    expect(loadLedger(ADDRESS)).toEqual([])
    expect(() => clearLedger(ADDRESS)).not.toThrow()
    // append still returns the in-memory result even with nowhere to persist
    expect(appendLedger(ADDRESS, entry())).toHaveLength(1)
  })
})

describe('toEngineHistory', () => {
  it('maps SWAP/REBALANCE/COMPACT to themselves and keeps fields intact', () => {
    const ledger: LedgerEntry[] = [
      { id: '1', ...entry({ type: 'SWAP', route: 'AVNU', amount: 5n }) },
      { id: '2', ...entry({ type: 'REBALANCE', route: 'POOL', amount: 6n }) },
      { id: '3', ...entry({ type: 'COMPACT', route: 'POOL', amount: 7n }) },
    ]
    const history = toEngineHistory(ledger)
    expect(history).toEqual([
      { timestamp: NOW, asset: 'STRK', amount: 5n, type: 'SWAP', route: 'AVNU' },
      { timestamp: NOW, asset: 'STRK', amount: 6n, type: 'REBALANCE', route: 'POOL' },
      { timestamp: NOW, asset: 'STRK', amount: 7n, type: 'COMPACT', route: 'POOL' },
    ])
  })

  it('maps TRANSFER to REBALANCE (note-to-note is in-pool rebalancing)', () => {
    const history = toEngineHistory([
      { id: '1', ...entry({ type: 'TRANSFER', route: 'DIRECT' }) },
    ])
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe('REBALANCE')
  })

  it('maps the DIRECT route to POOL (the engine has no DIRECT member)', () => {
    const history = toEngineHistory([
      { id: '1', ...entry({ type: 'SWAP', route: 'DIRECT' }) },
    ])
    expect(history[0].route).toBe('POOL')
  })

  it('drops SHIELD entirely — the engine cannot express the pool boundary', () => {
    const history = toEngineHistory([
      { id: '1', ...entry({ type: 'SHIELD', route: 'DIRECT' }) },
      { id: '2', ...entry({ type: 'SWAP', route: 'AVNU' }) },
    ])
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe('SWAP')
  })
})

describe('syntheticNotesFromBalances', () => {
  it('creates one synthetic note per nonzero balance and skips zeros', () => {
    const notes = syntheticNotesFromBalances(
      [
        { symbol: 'STRK', raw: 10n ** 18n },
        { symbol: 'USDC', raw: 0n },
        { symbol: 'ETH', raw: 5n },
      ],
      NOW,
    )
    expect(notes).toHaveLength(2)
    expect(notes.map((n) => n.asset)).toEqual(['STRK', 'ETH'])
  })

  it('stamps the documented synthetic shape', () => {
    const [note] = syntheticNotesFromBalances([{ symbol: 'USDC', raw: 42n }], NOW)
    expect(note).toEqual({
      commitment: 'synthetic:USDC',
      asset: 'USDC',
      amount: 42n,
      leafIndex: 0,
      nullifier: '',
      timestamp: NOW - 3_600_000,
    })
  })

  it('returns [] for empty or all-zero balances', () => {
    expect(syntheticNotesFromBalances([], NOW)).toEqual([])
    expect(syntheticNotesFromBalances([{ symbol: 'WBTC', raw: 0n }], NOW)).toEqual([])
  })
})
