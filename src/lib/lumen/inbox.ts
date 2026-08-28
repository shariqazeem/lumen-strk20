'use client'

/**
 * The inbox — claim links this device has been handed.
 *
 * Distinct from `links.ts`, which records links you *sent*. This records links
 * you *received*: every time a claim link is opened on this device, it is
 * remembered so Incoming can show "money waiting for you" instead of the link
 * existing only in whatever chat app delivered it.
 *
 * Deliberately NOT keyed by account. A claim link belongs to whoever holds the
 * secret, and it is routinely opened before any wallet is connected — that is
 * the entire point of the flow. Keying by account would drop exactly the
 * arrivals a new user is about to claim.
 *
 * The secret is already in the URL the user is holding; storing it here moves
 * it no further. Nothing is ever transmitted.
 */

import { TOKENS, type TokenSymbol } from '@/lib/strk20/config'
import { findEscrowHolding } from '@/lib/strk20/escrow'

export interface InboxLink {
  /** Claim secret — the identity of the link. */
  claimSecret: string
  token: TokenSymbol
  /** Raw amount, bigint as decimal string. */
  amountRaw: string
  /** Sender's chosen display name, if the link carried one. */
  fromName?: string
  note?: string
  /** ms epoch this device first saw the link. */
  firstSeenAt: number
  status: 'waiting' | 'claimed'
  /** Set once claimed through this device. */
  claimedAt?: number
  txHash?: string
}

const KEY = 'lumen:inbox:v1'
const CAP = 100

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function revive(raw: unknown): InboxLink | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.claimSecret !== 'string' || !r.claimSecret) return null
  if (typeof r.token !== 'string' || !(r.token in TOKENS)) return null
  if (typeof r.amountRaw !== 'string') return null
  if (typeof r.firstSeenAt !== 'number' || !Number.isFinite(r.firstSeenAt)) return null
  // Both must parse as numbers: the compact codec packs them as bytes, so a
  // corrupt row would throw while re-encoding the link rather than here.
  try {
    BigInt(r.amountRaw)
    if (BigInt(r.claimSecret) <= 0n) return null
  } catch {
    return null
  }
  return {
    claimSecret: r.claimSecret,
    token: r.token as TokenSymbol,
    amountRaw: r.amountRaw,
    firstSeenAt: r.firstSeenAt,
    status: r.status === 'claimed' ? 'claimed' : 'waiting',
    ...(typeof r.fromName === 'string' ? { fromName: r.fromName } : {}),
    ...(typeof r.note === 'string' ? { note: r.note } : {}),
    ...(typeof r.claimedAt === 'number' ? { claimedAt: r.claimedAt } : {}),
    ...(typeof r.txHash === 'string' ? { txHash: r.txHash } : {}),
  }
}

export function loadInbox(): InboxLink[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(KEY)
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((l): l is InboxLink => l !== null)
  } catch {
    return []
  }
}

function persist(links: InboxLink[]): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(links.slice(0, CAP)))
  } catch {
    // In-memory result stays authoritative.
  }
}

/**
 * Remember a link this device just opened. Idempotent on the claim secret, so
 * re-opening the same link never duplicates it and never resets its status.
 */
export function rememberLink(input: {
  claimSecret: string
  token: TokenSymbol
  amountRaw: string
  fromName?: string
  note?: string
}): InboxLink[] {
  const existing = loadInbox()
  if (existing.some((l) => l.claimSecret === input.claimSecret)) return existing

  const link: InboxLink = {
    claimSecret: input.claimSecret,
    token: input.token,
    amountRaw: input.amountRaw,
    firstSeenAt: Date.now(),
    status: 'waiting',
    ...(input.fromName ? { fromName: input.fromName } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
  const next = [link, ...existing]
  persist(next)
  return next
}

/** Mark a remembered link claimed. Safe to call for links never remembered. */
export function markInboxClaimed(claimSecret: string, txHash?: string): InboxLink[] {
  const next = loadInbox().map((link) =>
    link.claimSecret === claimSecret
      ? {
          ...link,
          status: 'claimed' as const,
          claimedAt: Date.now(),
          ...(txHash ? { txHash } : {}),
        }
      : link,
  )
  persist(next)
  return next
}

/**
 * Mark a link claimed because the chain says so — someone else got there
 * first, or it was claimed on another device. Distinct from our own claim only
 * in that no transaction hash of ours exists.
 */
export function reconcileInbox(claimSecret: string, claimedOnChain: boolean): InboxLink[] {
  if (!claimedOnChain) return loadInbox()
  return markInboxClaimed(claimSecret)
}

/**
 * How many waiting links to verify on a page load.
 *
 * Each one is an RPC read per known escrow, so the check is bounded rather
 * than unbounded — the newest are the ones anybody is about to act on.
 */
const VERIFY_CAP = 20

/**
 * Check waiting links against the chain and mark the ones already settled.
 *
 * The inbox is written optimistically: a link is remembered the moment it is
 * opened, and the claim can land somewhere this device never observes — on
 * another device, by whoever else the link reached, or right here in a wallet
 * that approved the transaction and never reported back. Without this,
 * "Waiting for you" keeps offering money that is already gone, which is the
 * one lie this screen must never tell.
 */
export async function verifyInbox(): Promise<InboxLink[]> {
  const pending = waitingLinks().slice(0, VERIFY_CAP)
  if (pending.length === 0) return loadInbox()

  const settled = await Promise.all(
    pending.map(async (link) => {
      try {
        const holder = await findEscrowHolding(link.claimSecret)
        // A link we cannot find is not a link we know was claimed — it may
        // have been minted against an escrow this build does not carry. Only
        // a positive `claimed` flag is evidence.
        return holder?.entry.claimed ? link.claimSecret : null
      } catch {
        return null
      }
    }),
  )

  let inbox = loadInbox()
  for (const claimSecret of settled) {
    if (claimSecret) inbox = markInboxClaimed(claimSecret)
  }
  return inbox
}

/** Links still waiting to be claimed, newest first. The Incoming heartbeat. */
export function waitingLinks(links: readonly InboxLink[] = loadInbox()): InboxLink[] {
  return links.filter((l) => l.status === 'waiting')
}

export function forgetLink(claimSecret: string): InboxLink[] {
  const next = loadInbox().filter((l) => l.claimSecret !== claimSecret)
  persist(next)
  return next
}
