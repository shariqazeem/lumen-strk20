'use client'

/**
 * The decision journal — what the engine did while you weren't looking.
 *
 * The guard already computes a review before every money action and then
 * throws it away when the sheet closes. This persists the outcome, which is
 * the only feature in the product that requires *history*: a one-shot payment
 * tool cannot produce it, because it never holds more than the transaction in
 * front of it.
 *
 * Records outcomes, never inputs. No amounts a review was run against, no
 * counterparties — just what the engine decided and why, in one sentence.
 * Device-local, keyed by account.
 */

import type { GuardReport } from './guard'

export type JournalAction = 'pay' | 'add' | 'link' | 'out' | 'claim'

export interface JournalEntry {
  id: string
  /** ms epoch */
  timestamp: number
  action: JournalAction
  /** What the engine concluded overall. */
  level: GuardReport['level']
  /** The single most important thing it did, in plain words. */
  headline: string
  /** Present when the engine rewrote an amount before signing. */
  rewritten?: { from: string; to: string; token: string }
  /** Checks that came back as warnings — the things worth a second look. */
  warnings: string[]
}

const KEY_PREFIX = 'lumen:journal:v1:'
const CAP = 300

function journalKey(account: string): string {
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

const ACTIONS = new Set<JournalAction>(['pay', 'add', 'link', 'out', 'claim'])

function revive(raw: unknown): JournalEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) return null
  if (typeof r.action !== 'string' || !ACTIONS.has(r.action as JournalAction)) return null
  if (typeof r.headline !== 'string') return null
  const level =
    r.level === 'tuned' || r.level === 'attention' ? r.level : ('protected' as const)
  return {
    id: r.id,
    timestamp: r.timestamp,
    action: r.action as JournalAction,
    level,
    headline: r.headline,
    warnings: Array.isArray(r.warnings)
      ? r.warnings.filter((w): w is string => typeof w === 'string')
      : [],
    ...(typeof r.rewritten === 'object' && r.rewritten !== null
      ? { rewritten: r.rewritten as JournalEntry['rewritten'] }
      : {}),
  }
}

export function loadJournal(account: string): JournalEntry[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(journalKey(account))
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((e): e is JournalEntry => e !== null)
  } catch {
    return []
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Human headline for what the engine did, given the review and the action. */
function headlineFor(action: JournalAction, report: GuardReport, rewritten: boolean): string {
  if (rewritten) {
    return action === 'add'
      ? 'Adjusted the amount so the deposit blends in'
      : action === 'link'
        ? 'Adjusted the amount so the escrow blends in'
        : 'Adjusted the amount before signing'
  }
  if (report.level === 'attention') {
    return report.checks.find((c) => c.status === 'warn')?.label ?? 'Flagged something worth a look'
  }
  switch (action) {
    case 'pay':
      return 'Sent privately — nothing published'
    case 'claim':
      return 'Claimed into your private balance'
    case 'link':
      return 'Escrowed behind a secret only the link holds'
    case 'add':
      return 'Added money with a clean public record'
    case 'out':
      return 'Checked the exit against your history'
  }
}

export function recordDecision(
  account: string,
  input: {
    action: JournalAction
    report: GuardReport
    rewritten?: { from: string; to: string; token: string }
  },
): JournalEntry[] {
  const entry: JournalEntry = {
    id: newId(),
    timestamp: Date.now(),
    action: input.action,
    level: input.report.level,
    headline: headlineFor(input.action, input.report, input.rewritten !== undefined),
    warnings: input.report.checks.filter((c) => c.status === 'warn').map((c) => c.detail),
    ...(input.rewritten ? { rewritten: input.rewritten } : {}),
  }
  const next = [entry, ...loadJournal(account)].slice(0, CAP)
  const store = storage()
  if (store) {
    try {
      store.setItem(journalKey(account), JSON.stringify(next))
    } catch {
      // The returned list stays authoritative for this session.
    }
  }
  return next
}

export interface JournalSummary {
  actions: number
  rewritten: number
  flagged: number
  /** Entries the summary was computed from, newest first. */
  entries: JournalEntry[]
}

/**
 * Roll the journal up over a window — the four numbers the home screen shows.
 * Defaults to the last 30 days.
 */
export function summarize(
  entries: readonly JournalEntry[],
  now: number,
  windowMs: number = 30 * 24 * 60 * 60 * 1000,
): JournalSummary {
  const recent = entries.filter((e) => now - e.timestamp <= windowMs)
  return {
    actions: recent.length,
    rewritten: recent.filter((e) => e.rewritten !== undefined).length,
    flagged: recent.filter((e) => e.level === 'attention').length,
    entries: recent,
  }
}
