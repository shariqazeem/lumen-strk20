'use client'

/**
 * Spaces — how Lumen organizes one private balance.
 *
 * A Space is a local view over the shielded balance: Rent, Travel, Emergency.
 * Moving money between Spaces is instant and free because nothing moves
 * on-chain — the pool holds one private balance and this device holds the
 * partition. That is the honest design: a Space boundary the chain could see
 * would itself be a leak.
 *
 * Amounts are stored raw (bigint as decimal string) per token so the partition
 * survives price movement. The unallocated remainder is always
 * `balance − Σ allocations`, computed live, never stored.
 */

import type { TokenSymbol } from '@/lib/strk20/config'

export interface Space {
  id: string
  name: string
  emoji: string
  /** Index into the tint wheel — the UI resolves it to a pastel. */
  tint: number
  /** Optional goal in USD, for the progress arc. */
  goalUsd?: number
  /** Raw allocated amount per token, bigint as decimal string. */
  allocations: Partial<Record<TokenSymbol, string>>
  createdAt: number
}

const KEY_PREFIX = 'lumen:spaces:v1:'

function spacesKey(account: string): string {
  try {
    return `${KEY_PREFIX}${BigInt(account).toString(16)}`
  } catch {
    return `${KEY_PREFIX}${account.trim().toLowerCase()}`
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function revive(raw: unknown): Space | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  if (typeof r.createdAt !== 'number') return null

  const allocations: Space['allocations'] = {}
  if (typeof r.allocations === 'object' && r.allocations !== null) {
    for (const [token, value] of Object.entries(r.allocations as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      try {
        BigInt(value)
        allocations[token as TokenSymbol] = value
      } catch {
        // Drop the corrupt allocation, keep the space.
      }
    }
  }

  return {
    id: r.id,
    name: r.name,
    emoji: typeof r.emoji === 'string' && r.emoji ? r.emoji : '✳️',
    tint: typeof r.tint === 'number' && Number.isFinite(r.tint) ? r.tint : 0,
    ...(typeof r.goalUsd === 'number' && Number.isFinite(r.goalUsd) && r.goalUsd > 0
      ? { goalUsd: r.goalUsd }
      : {}),
    allocations,
    createdAt: r.createdAt,
  }
}

export function loadSpaces(account: string): Space[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(spacesKey(account))
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((s): s is Space => s !== null)
  } catch {
    return []
  }
}

function persist(account: string, spaces: Space[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(spacesKey(account), JSON.stringify(spaces))
  } catch {
    // In-memory list stays authoritative.
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `space-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addSpace(
  account: string,
  input: { name: string; emoji?: string; goalUsd?: number },
): Space[] {
  const existing = loadSpaces(account)
  const space: Space = {
    id: newId(),
    name: input.name.trim(),
    emoji: input.emoji?.trim() || '✳️',
    tint: existing.length % 5,
    ...(input.goalUsd && input.goalUsd > 0 ? { goalUsd: input.goalUsd } : {}),
    allocations: {},
    createdAt: Date.now(),
  }
  const next = [...existing, space]
  persist(account, next)
  return next
}

export function removeSpace(account: string, id: string): Space[] {
  const next = loadSpaces(account).filter((s) => s.id !== id)
  persist(account, next)
  return next
}

export function allocationOf(space: Space, token: TokenSymbol): bigint {
  const raw = space.allocations[token]
  if (!raw) return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

/** Total already reserved across all spaces for a token. */
export function totalAllocated(spaces: readonly Space[], token: TokenSymbol): bigint {
  return spaces.reduce((sum, space) => sum + allocationOf(space, token), 0n)
}

/**
 * Move raw value into (positive) or out of (negative) a space. Clamps at zero;
 * the caller is responsible for not allocating past the live balance, because
 * only the caller knows the balance.
 */
export function adjustAllocation(
  account: string,
  spaceId: string,
  token: TokenSymbol,
  delta: bigint,
): Space[] {
  const next = loadSpaces(account).map((space) => {
    if (space.id !== spaceId) return space
    const current = allocationOf(space, token)
    const updated = current + delta < 0n ? 0n : current + delta
    const allocations = { ...space.allocations }
    if (updated === 0n) delete allocations[token]
    else allocations[token] = updated.toString()
    return { ...space, allocations }
  })
  persist(account, next)
  return next
}

/** Pastel tints for space cards. Index with `space.tint`. */
export const SPACE_TINTS = [
  { bg: '#f6efe3', fg: '#7a5a18' },
  { bg: '#f9e8ec', fg: '#8f3a52' },
  { bg: '#ece7f8', fg: '#54418f' },
  { bg: '#e3eef7', fg: '#2f5a7d' },
  { bg: '#e7f1e8', fg: '#3a6647' },
] as const
