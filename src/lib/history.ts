'use client'

/**
 * Persistent local action ledger.
 *
 * The engine's behavioural terms — timing entropy, behavioural uniqueness,
 * exit correlation — need to know what this wallet has already done. The chain
 * deliberately cannot provide that: private actions publish commitments, not
 * amounts or per-user attribution, and that opacity is the product working.
 * So Lumen keeps its own ledger of the actions it executed, locally, keyed by
 * account, in localStorage. It never leaves the device.
 *
 * Amounts are bigint in memory and decimal strings on disk (JSON has no
 * bigint). Corrupt or foreign data degrades to an empty ledger rather than
 * throwing into the UI.
 */

import type { ActionRecord, ActionType, PrivateNote, Route } from '@/lib/engine'
import { TOKENS, type TokenSymbol } from '@/lib/strk20/config'

export interface LedgerEntry {
  /** crypto.randomUUID() */
  id: string
  /** ms epoch */
  timestamp: number
  type:
    | 'SHIELD'
    | 'SWAP'
    | 'REBALANCE'
    | 'COMPACT'
    | 'TRANSFER'
    | 'UNSHIELD'
    | 'LINK'
    | 'CLAIM'
    | 'STAKE'
  asset: TokenSymbol
  /** Raw amount in the asset's smallest unit. */
  amount: bigint
  route: 'AVNU' | 'POOL' | 'DIRECT'
  txHash?: string
  /** Normalized address of the other side, when the entry has one (TRANSFER / UNSHIELD). */
  counterparty?: string
  /** What a chain observer saw for this entry, e.g. 'deposit · public', 'executor → AMM', '—' */
  observer: string
}

/** Hard cap on stored entries; oldest fall off the end. */
export const LEDGER_CAP = 500

const KEY_PREFIX = 'lumen:ledger:v1:'

const LEDGER_TYPES = new Set<LedgerEntry['type']>([
  'SHIELD',
  'SWAP',
  'REBALANCE',
  'COMPACT',
  'TRANSFER',
  'UNSHIELD',
  // Claim links: LINK is the sender's public escrow leg, CLAIM the
  // recipient's arrival. Both are boundary legs the engine deliberately
  // cannot express; the guard reads them from the raw ledger.
  'LINK',
  'CLAIM',
  // Private Bitcoin staking through LumenVault. Public as an operation —
  // pool to helper to Endur — but never attributable to the staker.
  'STAKE',
])
const LEDGER_ROUTES = new Set<LedgerEntry['route']>(['AVNU', 'POOL', 'DIRECT'])

/**
 * Storage key for an account. The address is normalized through BigInt so the
 * padded and unpadded spellings of the same felt (`0x0abc` vs `0xabc`, any
 * casing) share one ledger. A string BigInt cannot parse is used as-is,
 * lowercased — a stable key is still better than a crash.
 */
export function ledgerKey(address: string): string {
  try {
    return `${KEY_PREFIX}${BigInt(address).toString(16)}`
  } catch {
    return `${KEY_PREFIX}${address.trim().toLowerCase()}`
  }
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * SSR-safe storage access: on the server (`typeof window === 'undefined'`)
 * there is nothing to read and every operation becomes a no-op. Resolved
 * through `globalThis` as the fallback so node tests can install a plain shim
 * without faking a DOM. Access is guarded — some privacy modes throw on the
 * mere property read.
 */
function storage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
    const shim = (globalThis as { localStorage?: StorageLike }).localStorage
    return shim ?? null
  } catch {
    return null
  }
}

function serialize(entries: readonly LedgerEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({ ...entry, amount: entry.amount.toString() })))
}

/** Revive one stored entry; anything malformed is dropped, not repaired. */
function reviveEntry(raw: unknown): LedgerEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string') return null
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) return null
  if (typeof r.type !== 'string' || !LEDGER_TYPES.has(r.type as LedgerEntry['type'])) return null
  if (typeof r.asset !== 'string' || !(r.asset in TOKENS)) return null
  if (typeof r.route !== 'string' || !LEDGER_ROUTES.has(r.route as LedgerEntry['route']))
    return null
  if (typeof r.observer !== 'string') return null

  let amount: bigint
  try {
    amount = BigInt(typeof r.amount === 'string' || typeof r.amount === 'number' ? r.amount : '')
  } catch {
    return null
  }

  return {
    id: r.id,
    timestamp: r.timestamp,
    type: r.type as LedgerEntry['type'],
    asset: r.asset as TokenSymbol,
    amount,
    route: r.route as LedgerEntry['route'],
    ...(typeof r.txHash === 'string' ? { txHash: r.txHash } : {}),
    ...(typeof r.counterparty === 'string' ? { counterparty: r.counterparty } : {}),
    observer: r.observer,
  }
}

/**
 * Load the ledger for an account, newest first. Returns `[]` on the server,
 * when storage is unreadable, and when the stored JSON is corrupt — a broken
 * ledger must degrade to "no history", never to a crash.
 */
export function loadLedger(address: string): LedgerEntry[] {
  const store = storage()
  if (!store) return []

  let text: string | null
  try {
    text = store.getItem(ledgerKey(address))
  } catch {
    return []
  }
  if (!text) return []

  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(reviveEntry)
      .filter((entry): entry is LedgerEntry => entry !== null)
      .slice(0, LEDGER_CAP)
  } catch {
    return []
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Non-cryptographic fallback for exotic environments; ids only need to be
  // locally unique list keys.
  return `ledger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Prepend an entry, cap at {@link LEDGER_CAP}, persist, and return the new
 * list. The returned list is authoritative even when persistence fails
 * (private mode, quota) so the session stays coherent in memory.
 */
export function appendLedger(address: string, entry: Omit<LedgerEntry, 'id'>): LedgerEntry[] {
  const full: LedgerEntry = { ...entry, id: newId() }
  const next = [full, ...loadLedger(address)].slice(0, LEDGER_CAP)

  const store = storage()
  if (store) {
    try {
      store.setItem(ledgerKey(address), serialize(next))
    } catch {
      // Quota exceeded or storage denied: keep the in-memory result.
    }
  }
  return next
}

export function clearLedger(address: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(ledgerKey(address))
  } catch {
    // Nothing to do — a ledger that cannot be cleared cannot be read either.
  }
}

/**
 * Ledger type → engine `ActionType`.
 *
 * The engine's vocabulary deliberately has no member for crossing the pool
 * boundary, so the mapping is:
 *
 *   - SWAP / REBALANCE / COMPACT → themselves (identity).
 *   - TRANSFER → REBALANCE: a private note-to-note transfer is exactly what
 *     the engine models as an in-pool rebalance — value moves between notes
 *     and nothing leaves the shielded environment.
 *   - SHIELD / UNSHIELD → dropped (no entry). They are the public boundary
 *     legs, not in-pool actions; inventing an in-pool ActionType for them
 *     would feed the behavioural terms an event class the engine's types
 *     deliberately cannot express. The guard reads them from the raw ledger
 *     instead, where boundary crossings are exactly the signal it wants.
 */
const ENGINE_TYPE: Partial<Record<LedgerEntry['type'], ActionType>> = {
  SWAP: 'SWAP',
  REBALANCE: 'REBALANCE',
  COMPACT: 'COMPACT',
  TRANSFER: 'REBALANCE',
}

/**
 * Ledger route → engine `Route`. `DIRECT` (a plain wallet-submitted pool
 * operation with no venue) maps to `POOL`; the others are identities.
 */
const ENGINE_ROUTE: Record<LedgerEntry['route'], Route> = {
  AVNU: 'AVNU',
  POOL: 'POOL',
  DIRECT: 'POOL',
}

/**
 * Project the ledger into the engine's `ActionRecord` history. SHIELD entries
 * are filtered out; see {@link ENGINE_TYPE} for the full mapping rationale.
 */
export function toEngineHistory(entries: readonly LedgerEntry[]): ActionRecord[] {
  return entries.flatMap((entry) => {
    const type = ENGINE_TYPE[entry.type]
    if (!type) return []
    return [
      {
        timestamp: entry.timestamp,
        asset: entry.asset,
        amount: entry.amount,
        type,
        route: ENGINE_ROUTE[entry.route],
      },
    ]
  })
}

/** Age assigned to synthetic notes: old enough to be past note maturity. */
const SYNTHETIC_NOTE_AGE_MS = 3_600_000

/**
 * Approximate the engine's note set from shielded balances.
 *
 * The Wallet API exposes balances, not note enumeration — the wallet owns
 * note discovery and Lumen never sees individual commitments. So note-level
 * granularity is approximated as one synthetic note per nonzero balance;
 * notes Lumen itself creates are tracked in the ledger, which is where the
 * behavioural terms get their real signal. Zero balances produce no note.
 */
export function syntheticNotesFromBalances(
  balances: ReadonlyArray<{ symbol: TokenSymbol; raw: bigint }>,
  now: number,
): PrivateNote[] {
  return balances
    .filter((balance) => balance.raw > 0n)
    .map((balance) => ({
      commitment: `synthetic:${balance.symbol}`,
      asset: balance.symbol,
      amount: balance.raw,
      leafIndex: 0,
      nullifier: '',
      timestamp: now - SYNTHETIC_NOTE_AGE_MS,
    }))
}
