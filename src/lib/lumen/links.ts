'use client'

/**
 * Sent claim links — the sender's local record.
 *
 * The link itself carries the claim secret to the recipient; the sender keeps
 * both secrets here so they can re-copy a link they already sent and reclaim
 * an expired one. Device-local, keyed by account, never leaves the browser —
 * losing this store loses the *refund* path, never the recipient's claim.
 */

import type { TokenSymbol } from '@/lib/strk20/config'
import { TOKENS } from '@/lib/strk20/config'

export interface SentLink {
  id: string
  /** Goes to the recipient inside the URL fragment. */
  claimSecret: string
  /** Stays with the sender; opens the reclaim path after expiry. */
  refundSecret: string
  token: TokenSymbol
  /** Raw amount, bigint as decimal string. */
  amountRaw: string
  /** Seconds since epoch when the refund path opens. */
  expiry: number
  note?: string
  txHash?: string
  createdAt: number
  /** Local status cache; the chain is the truth. */
  status: 'open' | 'claimed' | 'refunded'
}

const KEY_PREFIX = 'lumen:links:v1:'

function linksKey(account: string): string {
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

function revive(raw: unknown): SentLink | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.claimSecret !== 'string' || typeof r.refundSecret !== 'string') return null
  if (typeof r.token !== 'string' || !(r.token in TOKENS)) return null
  if (typeof r.amountRaw !== 'string') return null
  if (typeof r.expiry !== 'number' || typeof r.createdAt !== 'number') return null
  try {
    BigInt(r.amountRaw)
  } catch {
    return null
  }
  const status =
    r.status === 'claimed' || r.status === 'refunded' ? r.status : ('open' as const)
  return {
    id: r.id,
    claimSecret: r.claimSecret,
    refundSecret: r.refundSecret,
    token: r.token as TokenSymbol,
    amountRaw: r.amountRaw,
    expiry: r.expiry,
    createdAt: r.createdAt,
    status,
    ...(typeof r.note === 'string' ? { note: r.note } : {}),
    ...(typeof r.txHash === 'string' ? { txHash: r.txHash } : {}),
  }
}

export function loadLinks(account: string): SentLink[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(linksKey(account))
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((l): l is SentLink => l !== null)
  } catch {
    return []
  }
}

function persist(account: string, links: SentLink[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(linksKey(account), JSON.stringify(links))
  } catch {
    // In-memory list stays authoritative.
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addLink(account: string, input: Omit<SentLink, 'id' | 'status'>): SentLink {
  const link: SentLink = { ...input, id: newId(), status: 'open' }
  persist(account, [link, ...loadLinks(account)])
  return link
}

export function updateLinkStatus(
  account: string,
  id: string,
  status: SentLink['status'],
): SentLink[] {
  const next = loadLinks(account).map((link) => (link.id === id ? { ...link, status } : link))
  persist(account, next)
  return next
}
