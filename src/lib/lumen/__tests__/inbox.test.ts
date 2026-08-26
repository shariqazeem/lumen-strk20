// @vitest-environment node

/**
 * The inbox is what makes Incoming honest: it holds links this device was
 * handed, which is the only arrival Lumen can actually see. Its rules matter —
 * re-opening a link must never duplicate it or resurrect a claimed one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  forgetLink,
  loadInbox,
  markInboxClaimed,
  reconcileInbox,
  rememberLink,
  waitingLinks,
} from '../inbox'

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

const link = (over: Partial<Parameters<typeof rememberLink>[0]> = {}) => ({
  claimSecret: '0xaaa',
  token: 'USDC' as const,
  amountRaw: '52880000',
  fromName: 'Shariq',
  note: 'Coffee',
  ...over,
})

describe('rememberLink', () => {
  it('stores a link with waiting status', () => {
    rememberLink(link())
    const all = loadInbox()
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe('waiting')
    expect(all[0].fromName).toBe('Shariq')
    expect(all[0].amountRaw).toBe('52880000')
  })

  it('is idempotent — reopening the same link does not duplicate it', () => {
    rememberLink(link())
    rememberLink(link())
    rememberLink(link())
    expect(loadInbox()).toHaveLength(1)
  })

  it('never resurrects a claimed link when it is reopened', () => {
    rememberLink(link())
    markInboxClaimed('0xaaa', '0xtx')
    rememberLink(link())
    const all = loadInbox()
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe('claimed')
    expect(all[0].txHash).toBe('0xtx')
  })

  it('keeps distinct links apart, newest first', () => {
    rememberLink(link({ claimSecret: '0xaaa' }))
    rememberLink(link({ claimSecret: '0xbbb' }))
    const all = loadInbox()
    expect(all).toHaveLength(2)
    expect(all[0].claimSecret).toBe('0xbbb')
  })
})

describe('status', () => {
  it('waitingLinks excludes claimed ones', () => {
    rememberLink(link({ claimSecret: '0xaaa' }))
    rememberLink(link({ claimSecret: '0xbbb' }))
    markInboxClaimed('0xaaa')
    const waiting = waitingLinks()
    expect(waiting).toHaveLength(1)
    expect(waiting[0].claimSecret).toBe('0xbbb')
  })

  it('reconcile marks claimed only when the chain says so', () => {
    rememberLink(link())
    reconcileInbox('0xaaa', false)
    expect(loadInbox()[0].status).toBe('waiting')
    reconcileInbox('0xaaa', true)
    expect(loadInbox()[0].status).toBe('claimed')
  })

  it('marking an unknown secret is a harmless no-op', () => {
    rememberLink(link())
    expect(() => markInboxClaimed('0xnothing')).not.toThrow()
    expect(loadInbox()[0].status).toBe('waiting')
  })
})

describe('resilience', () => {
  it('drops corrupt rows instead of throwing', () => {
    g.localStorage?.setItem(
      'lumen:inbox:v1',
      JSON.stringify([
        // A fully-shaped stored row — note `firstSeenAt`, which the input
        // shape does not carry.
        { ...link({ claimSecret: '0xgood' }), firstSeenAt: 1, status: 'waiting' },
        { claimSecret: '0xbad', token: 'DOGE', amountRaw: '1', firstSeenAt: 1 },
        { claimSecret: '0xbad2', token: 'USDC', amountRaw: 'xyz', firstSeenAt: 1 },
        null,
        'junk',
      ]),
    )
    const all = loadInbox()
    expect(all).toHaveLength(1)
    expect(all[0].claimSecret).toBe('0xgood')
  })

  it('returns [] on unparseable storage, never throws', () => {
    g.localStorage?.setItem('lumen:inbox:v1', '{not json')
    expect(loadInbox()).toEqual([])
  })

  it('is SSR-safe with no storage at all', () => {
    delete g.window
    delete g.localStorage
    expect(loadInbox()).toEqual([])
    expect(() => rememberLink(link())).not.toThrow()
  })

  it('forgetLink removes just that one', () => {
    rememberLink(link({ claimSecret: '0xaaa' }))
    rememberLink(link({ claimSecret: '0xbbb' }))
    forgetLink('0xaaa')
    const all = loadInbox()
    expect(all).toHaveLength(1)
    expect(all[0].claimSecret).toBe('0xbbb')
  })
})
