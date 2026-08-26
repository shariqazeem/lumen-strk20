// @vitest-environment node

/**
 * The journal is the product's memory of its own decisions. It must record
 * outcomes without ever recording what it looked at, and summarise a window
 * the way the home screen reads it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadJournal, recordDecision, summarize } from '../journal'
import type { GuardReport } from '../guard'

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

const report = (level: GuardReport['level'], warn?: string): GuardReport => ({
  level,
  checks: [
    { id: 'a', label: 'No public record', detail: 'Nothing was published.', status: 'pass' },
    ...(warn
      ? [{ id: 'b', label: 'Worth a look', detail: warn, status: 'warn' as const }]
      : []),
  ],
})

describe('recordDecision', () => {
  it('stores an outcome with a human headline', () => {
    recordDecision(ACCOUNT, { action: 'pay', report: report('protected') })
    const entries = loadJournal(ACCOUNT)
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('pay')
    expect(entries[0].level).toBe('protected')
    expect(entries[0].headline).toBe('Sent privately — nothing published')
    expect(entries[0].warnings).toEqual([])
  })

  it('captures a rewrite and says so in the headline', () => {
    recordDecision(ACCOUNT, {
      action: 'add',
      report: report('tuned'),
      rewritten: { from: '100', to: '99.889991', token: 'USDC' },
    })
    const [entry] = loadJournal(ACCOUNT)
    expect(entry.rewritten).toEqual({ from: '100', to: '99.889991', token: 'USDC' })
    expect(entry.headline).toBe('Adjusted the amount so the deposit blends in')
  })

  it('carries warning details through and leads with the warning label', () => {
    recordDecision(ACCOUNT, {
      action: 'out',
      report: report('attention', 'This mirrors a recent deposit.'),
    })
    const [entry] = loadJournal(ACCOUNT)
    expect(entry.level).toBe('attention')
    expect(entry.headline).toBe('Worth a look')
    expect(entry.warnings).toEqual(['This mirrors a recent deposit.'])
  })

  it('keeps newest first', () => {
    recordDecision(ACCOUNT, { action: 'pay', report: report('protected') })
    recordDecision(ACCOUNT, { action: 'claim', report: report('protected') })
    expect(loadJournal(ACCOUNT)[0].action).toBe('claim')
  })

  it('keeps separate accounts apart', () => {
    recordDecision(ACCOUNT, { action: 'pay', report: report('protected') })
    expect(loadJournal('0xabc')).toEqual([])
  })
})

describe('summarize', () => {
  const now = 1_756_000_000_000
  const day = 86_400_000

  it('counts actions, rewrites and flags inside the window', () => {
    const entries = [
      { id: '1', timestamp: now - day, action: 'pay' as const, level: 'protected' as const, headline: 'x', warnings: [] },
      { id: '2', timestamp: now - 2 * day, action: 'add' as const, level: 'tuned' as const, headline: 'x', warnings: [], rewritten: { from: '100', to: '99.8', token: 'USDC' } },
      { id: '3', timestamp: now - 3 * day, action: 'out' as const, level: 'attention' as const, headline: 'x', warnings: ['w'] },
    ]
    const digest = summarize(entries, now)
    expect(digest.actions).toBe(3)
    expect(digest.rewritten).toBe(1)
    expect(digest.flagged).toBe(1)
  })

  it('excludes anything older than the window', () => {
    const entries = [
      { id: '1', timestamp: now - 40 * day, action: 'pay' as const, level: 'protected' as const, headline: 'x', warnings: [] },
    ]
    expect(summarize(entries, now).actions).toBe(0)
  })
})
