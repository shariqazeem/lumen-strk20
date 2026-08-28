// @vitest-environment node

/**
 * The inbox is what makes Incoming honest: it holds links this device was
 * handed, which is the only arrival Lumen can actually see. Its rules matter —
 * re-opening a link must never duplicate it or resurrect a claimed one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(() => markInboxClaimed('0x0f')).not.toThrow()
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
        { ...link({ claimSecret: '0x600d' }), firstSeenAt: 1, status: 'waiting' },
        { claimSecret: '0xbad', token: 'DOGE', amountRaw: '1', firstSeenAt: 1 },
        { claimSecret: '0xbad2', token: 'USDC', amountRaw: 'xyz', firstSeenAt: 1 },
        // Not a felt: the compact codec would throw while re-encoding a link
        // from this row, so it has to die here instead.
        { claimSecret: '0xnope', token: 'USDC', amountRaw: '1', firstSeenAt: 1 },
        null,
        'junk',
      ]),
    )
    const all = loadInbox()
    expect(all).toHaveLength(1)
    expect(all[0].claimSecret).toBe('0x600d')
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

/**
 * "Waiting for you" offering money that is already gone is the one lie this
 * screen must never tell — and it told it on mainnet, because the inbox is
 * written optimistically and nothing ever asked the chain.
 */
describe('verifyInbox', () => {
  const holding = (claimed: boolean) => ({ address: '0xesc', entry: { exists: true, claimed } })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('@/lib/strk20/escrow')
  })

  const withChain = async (
    find: (secret: string) => Promise<unknown>,
  ): Promise<typeof import('../inbox')> => {
    vi.resetModules()
    vi.doMock('@/lib/strk20/escrow', () => ({ findEscrowHolding: find }))
    return import('../inbox')
  }

  it('marks a link the chain says was already claimed', async () => {
    const inbox = await withChain(async () => holding(true))
    inbox.rememberLink(link())
    expect(await inbox.verifyInbox()).toHaveLength(1)
    expect(inbox.waitingLinks()).toHaveLength(0)
  })

  it('leaves a link the chain still holds', async () => {
    const inbox = await withChain(async () => holding(false))
    inbox.rememberLink(link())
    await inbox.verifyInbox()
    expect(inbox.waitingLinks()).toHaveLength(1)
  })

  it('leaves a link it cannot find, rather than assuming it is gone', async () => {
    // An escrow this build does not carry is not evidence of a claim.
    const inbox = await withChain(async () => null)
    inbox.rememberLink(link())
    await inbox.verifyInbox()
    expect(inbox.waitingLinks()).toHaveLength(1)
  })

  it('survives an RPC that throws', async () => {
    const inbox = await withChain(async () => {
      throw new Error('RPC down')
    })
    inbox.rememberLink(link())
    await expect(inbox.verifyInbox()).resolves.toHaveLength(1)
    expect(inbox.waitingLinks()).toHaveLength(1)
  })

  it('asks nothing of the chain when nothing is waiting', async () => {
    let asked = 0
    const inbox = await withChain(async () => {
      asked += 1
      return holding(true)
    })
    expect(await inbox.verifyInbox()).toHaveLength(0)
    expect(asked).toBe(0)
  })
})
