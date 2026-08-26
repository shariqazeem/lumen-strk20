'use client'

/**
 * Arrivals — money that showed up without Lumen doing anything.
 *
 * The Wallet API exposes an aggregate balance per token and nothing else: no
 * note enumeration, no sender, no timestamp, no event. So an arrival can only
 * be *inferred* — the balance grew by more than this device's own actions
 * explain — and the UI must say exactly that and no more.
 *
 * That limitation is the product working. A private transfer publishes no
 * sender, which is why neither Lumen nor anyone else can tell you who paid.
 *
 * Deliberately conservative. Pool fees and any activity from another device
 * push the unexplained delta down, so the failure mode is missing an arrival,
 * never inventing one.
 */

import type { LedgerEntry } from '@/lib/history'
import type { TokenSymbol } from '@/lib/strk20/config'
import { TOKENS } from '@/lib/strk20/config'
import type { ShieldedBalance } from '@/lib/strk20/wallet'

export interface Arrival {
  id: string
  token: TokenSymbol
  /** Raw amount, bigint as decimal string. */
  amountRaw: string
  /** ms epoch this device noticed — NOT when it actually arrived. */
  detectedAt: number
}

interface Snapshot {
  /** token → raw balance as a decimal string. */
  balances: Partial<Record<TokenSymbol, string>>
  /** ms epoch of the snapshot. */
  at: number
}

const ARRIVALS_PREFIX = 'lumen:arrivals:v1:'
const SNAPSHOT_PREFIX = 'lumen:balancesnap:v1:'
const CAP = 100

function keyFor(prefix: string, account: string): string {
  try {
    return `${prefix}${BigInt(account).toString(16)}`
  } catch {
    return `${prefix}${account.trim().toLowerCase()}`
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function read<T>(key: string, fallback: T): T {
  const store = storage()
  if (!store) return fallback
  try {
    const text = store.getItem(key)
    return text ? (JSON.parse(text) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // Non-fatal: detection simply restarts from the next read.
  }
}

export function loadArrivals(account: string): Arrival[] {
  const raw = read<unknown[]>(keyFor(ARRIVALS_PREFIX, account), [])
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string') return []
    if (typeof r.token !== 'string' || !(r.token in TOKENS)) return []
    if (typeof r.amountRaw !== 'string') return []
    if (typeof r.detectedAt !== 'number') return []
    try {
      BigInt(r.amountRaw)
    } catch {
      return []
    }
    return [
      {
        id: r.id,
        token: r.token as TokenSymbol,
        amountRaw: r.amountRaw,
        detectedAt: r.detectedAt,
      },
    ]
  })
}

/**
 * How a ledger entry moved the shielded balance of its own token.
 *
 * SWAP is counted only as an outflow of the sell token: the ledger records the
 * sell side, and crediting an unknown buy amount would be a guess.
 */
function balanceEffect(entry: LedgerEntry): bigint {
  switch (entry.type) {
    case 'SHIELD':
    case 'CLAIM':
      return entry.amount
    case 'TRANSFER':
    case 'UNSHIELD':
    case 'LINK':
    case 'SWAP':
      return -entry.amount
    default:
      return 0n
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `arrival-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Compare a fresh balance read against the last snapshot and record whatever
 * this device's own actions cannot account for.
 *
 * The first ever read establishes a baseline and reports nothing — otherwise
 * an existing balance would appear as one enormous arrival.
 */
export function syncArrivals(
  account: string,
  balances: readonly ShieldedBalance[],
  ledger: readonly LedgerEntry[],
  now: number = Date.now(),
): { arrivals: Arrival[]; fresh: Arrival[] } {
  const snapKey = keyFor(SNAPSHOT_PREFIX, account)
  const previous = read<Snapshot | null>(snapKey, null)

  const current: Snapshot = { balances: {}, at: now }
  for (const balance of balances) {
    current.balances[balance.symbol] = balance.raw.toString()
  }

  if (!previous || typeof previous.at !== 'number') {
    write(snapKey, current)
    return { arrivals: loadArrivals(account), fresh: [] }
  }

  // Everything this device did since the snapshot, per token.
  const explained = new Map<TokenSymbol, bigint>()
  for (const entry of ledger) {
    if (entry.timestamp < previous.at) continue
    explained.set(entry.asset, (explained.get(entry.asset) ?? 0n) + balanceEffect(entry))
  }

  const fresh: Arrival[] = []
  for (const balance of balances) {
    let before: bigint
    try {
      before = BigInt(previous.balances[balance.symbol] ?? '0')
    } catch {
      before = 0n
    }
    const unexplained = balance.raw - before - (explained.get(balance.symbol) ?? 0n)
    if (unexplained > 0n) {
      fresh.push({
        id: newId(),
        token: balance.symbol,
        amountRaw: unexplained.toString(),
        detectedAt: now,
      })
    }
  }

  const arrivals = [...fresh, ...loadArrivals(account)].slice(0, CAP)
  write(keyFor(ARRIVALS_PREFIX, account), arrivals)
  write(snapKey, current)
  return { arrivals, fresh }
}

export function clearArrivals(account: string): void {
  write(keyFor(ARRIVALS_PREFIX, account), [])
}
