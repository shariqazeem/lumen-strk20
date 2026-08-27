'use client'

/**
 * People — Lumen's relationship identities.
 *
 * Every person you pay gets their own privacy boundary. On-chain that boundary
 * already exists: a private transfer publishes no sender, recipient or amount.
 * What the chain cannot enforce is *behavioural* separation — reusing a
 * distinctive amount or a rigid cadence across relationships is exactly the
 * cross-note provenance signal the Anonymity Gap research measures. The guard
 * reads this address book plus the local ledger to enforce that separation
 * silently.
 *
 * Contacts live only on this device, keyed by the connected account. They are
 * product data, not chain data: nothing here is ever published.
 */

export interface Person {
  id: string
  name: string
  /** Their Starknet address (must be pool-registered to receive privately). */
  address: string
  createdAt: number
}

const KEY_PREFIX = 'lumen:people:v1:'

/** Same normalization as the ledger: padded and unpadded felts share a key. */
function peopleKey(account: string): string {
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

function revive(raw: unknown): Person | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  if (typeof r.address !== 'string' || !r.address.trim()) return null
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    createdAt: r.createdAt,
  }
}

export function loadPeople(account: string): Person[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(peopleKey(account))
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((p): p is Person => p !== null)
  } catch {
    return []
  }
}

function persist(account: string, people: Person[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(peopleKey(account), JSON.stringify(people))
  } catch {
    // Quota or private mode: the in-memory list stays authoritative.
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `person-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addPerson(
  account: string,
  input: { name: string; address: string },
): Person[] {
  const person: Person = {
    id: newId(),
    name: input.name.trim(),
    address: input.address.trim(),
    createdAt: Date.now(),
  }
  const next = [person, ...loadPeople(account)]
  persist(account, next)
  return next
}

export function removePerson(account: string, id: string): Person[] {
  const next = loadPeople(account).filter((p) => p.id !== id)
  persist(account, next)
  return next
}

/** Felt-tolerant address match against a contact list. */
export function personByAddress(people: readonly Person[], address: string): Person | undefined {
  let target: bigint | null = null
  try {
    target = BigInt(address)
  } catch {
    return undefined
  }
  return people.find((p) => {
    try {
      return BigInt(p.address) === target
    } catch {
      return false
    }
  })
}

/**
 * A monogram for a name.
 *
 * Replaced the emoji avatar: initials cost the user no decision, stay inside
 * the monochrome palette, and read as a person. An address is not a name — it
 * would render as "0" — so it gets a neutral mark instead.
 */
export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || looksLikeStarknetAddress(trimmed)) return '\u2022'

  const words = trimmed.split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '\u2022'
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ''
  return `${first}${last}`.replace(/[^\p{L}\p{N}]/gu, '') || '\u2022'
}

/** A short display form of an address, for rows where the name is unknown. */
export function shortAddress(address: string): string {
  const trimmed = address.trim()
  if (trimmed.length <= 12) return trimmed
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`
}

/** Loose validity check before we let a pay flow proceed to the wallet. */
export function looksLikeStarknetAddress(address: string): boolean {
  const trimmed = address.trim()
  if (!/^0x[0-9a-fA-F]{3,64}$/.test(trimmed)) return false
  try {
    const value = BigInt(trimmed)
    return value > 0n
  } catch {
    return false
  }
}
