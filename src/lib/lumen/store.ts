'use client'

/**
 * The Lumen store — one place where the wallet, the pool, and the product
 * meet.
 *
 * Everything chain-touching goes through the user's privacy-enabled wallet
 * (`WalletAccountV6`): the wallet owns viewing keys, note discovery, proving
 * and submission. Lumen never sees private state and never asks for a key.
 *
 * Product state (people, spaces, receipts, the action ledger) lives on this
 * device only, keyed by account. The store mirrors it in memory so React can
 * render it; the modules under `@/lib/lumen` own persistence.
 */

import { create } from 'zustand'
import type { WalletAccountV6 } from 'starknet'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import {
  connectWallet,
  formatUnits,
  provider,
  readShieldedBalances,
  type ShieldedBalance,
} from '@/lib/strk20/wallet'
import {
  assertNeverUnshields,
  buildExplicitUnshield,
  buildPrivateTransfer,
  buildShield,
  explainWalletError,
} from '@/lib/strk20/actions'
import {
  buildEscrowClaim,
  buildEscrowFund,
  buildEscrowRefund,
  encodeClaimLink,
  ESCROW_ADDRESS,
  generateSecret,
  readEscrowEntry,
  type ClaimLinkPayload,
} from '@/lib/strk20/escrow'
import { addLink, loadLinks, updateLinkStatus, type SentLink } from './links'
import { readPoolFee } from '@/lib/strk20/pool'
import { fetchSpotPricesUsd } from '@/lib/strk20/swap'
import { FALLBACK_POOL_FEE_STRK, TOKENS, tokenByAddress, type TokenSymbol } from '@/lib/strk20/config'
import { appendLedger, loadLedger, type LedgerEntry } from '@/lib/history'
import { loadPeople, addPerson, pickEmoji, removePerson, type Person } from './people'
import {
  addSpace,
  adjustAllocation,
  allocationOf,
  loadSpaces,
  removeSpace,
  type Space,
} from './spaces'
import { addReceipt, loadReceipts, type Receipt } from './receipts'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface LastTx {
  hash: string
  kind: 'pay' | 'add' | 'out' | 'link' | 'claim'
  status: 'submitted' | 'confirmed' | 'unknown'
}

interface LumenState {
  status: ConnectionStatus
  error: string | null
  account: WalletAccountV6 | null
  address: string | null
  walletName: string | null

  balances: ShieldedBalance[]
  balancesLoading: boolean
  /** Balances are consent-gated; null until the user explicitly reveals. */
  balancesRevealedAt: number | null
  /**
   * Pool registration, learned from the wallet: null = unknown, false = this
   * account has never touched the pool (a fresh user, not an error), true =
   * registered. The wallet registers automatically on the first deposit.
   */
  registered: boolean | null

  prices: Partial<Record<TokenSymbol, number>>
  poolFee: bigint
  poolFeeLive: boolean

  ledger: LedgerEntry[]
  people: Person[]
  spaces: Space[]
  receipts: Receipt[]
  links: SentLink[]

  lastTx: LastTx | null
  submitting: boolean

  connect: (wallet: WalletWithStarknetFeatures) => Promise<void>
  disconnect: () => void
  revealBalances: () => Promise<void>
  loadMarket: () => Promise<void>

  addPerson: (input: { name: string; address: string; emoji?: string }) => void
  removePerson: (id: string) => void
  addSpace: (input: { name: string; emoji?: string; goalUsd?: number }) => void
  removeSpace: (id: string) => void
  moveIntoSpace: (spaceId: string, token: TokenSymbol, delta: bigint) => void

  pay: (input: {
    token: TokenSymbol
    amount: bigint
    recipient: string
    recipientName?: string
    note?: string
  }) => Promise<Receipt>
  addMoney: (input: { token: TokenSymbol; amount: bigint }) => Promise<string>
  cashOut: (input: { token: TokenSymbol; amount: bigint; recipient: string }) => Promise<string>

  /** Fund a claim link; returns the record plus the shareable URL. */
  sendClaimLink: (input: {
    token: TokenSymbol
    amount: bigint
    /** Seconds until the refund path opens. */
    refundAfterS: number
    note?: string
    fromName?: string
  }) => Promise<{ link: SentLink; url: string }>
  /** Claim a link into this account's private balance. */
  claimFromLink: (payload: ClaimLinkPayload) => Promise<string>
  /** Reclaim an expired, unclaimed link back into this private balance. */
  refundLink: (id: string) => Promise<string>
  /** Re-check every open link against the escrow; the chain is the truth. */
  syncLinks: () => Promise<void>

  clearError: () => void

  /** True when the session is the sample-data walkthrough, not a wallet. */
  preview: boolean
  enterPreview: () => void
}

/** USD value of the full balance list under the current prices, or null when unpriced. */
export function portfolioUsd(
  balances: readonly ShieldedBalance[],
  prices: Partial<Record<TokenSymbol, number>>,
): number | null {
  let total = 0
  let priced = false
  for (const balance of balances) {
    if (balance.raw === 0n) continue
    const price = prices[balance.symbol]
    if (price === undefined) continue
    priced = true
    total += Number(formatUnits(balance.raw, balance.decimals, 6).replace(/,/g, '')) * price
  }
  return priced ? total : null
}

/**
 * Chain actions need a live wallet account. Surfacing the refusal through the
 * store's error state (not just a throw) is what makes it visible in the UI —
 * and in the sample walkthrough the copy says why, instead of dead-ending.
 */
function requireAccount(
  get: () => LumenState,
  set: (partial: Partial<LumenState>) => void,
): { account: WalletAccountV6; address: string } {
  const { account, address, preview } = get()
  if (account && address) return { account, address }
  const message = preview
    ? 'This is the sample walkthrough — connect a privacy wallet to actually move money.'
    : 'Connect a wallet first.'
  set({ error: message })
  throw new Error(message)
}

/** Bound a confirmation wait so a slow relayer degrades to "submitted". */
async function watchTx(hash: string, update: (status: LastTx['status']) => void): Promise<void> {
  try {
    await Promise.race([
      provider().waitForTransaction(hash),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 90_000)),
    ])
    update('confirmed')
  } catch {
    update('unknown')
  }
}

export const useLumen = create<LumenState>((set, get) => ({
  status: 'disconnected',
  error: null,
  account: null,
  address: null,
  walletName: null,

  balances: [],
  balancesLoading: false,
  balancesRevealedAt: null,
  registered: null,

  prices: {},
  poolFee: FALLBACK_POOL_FEE_STRK,
  poolFeeLive: false,

  ledger: [],
  people: [],
  spaces: [],
  receipts: [],
  links: [],

  lastTx: null,
  submitting: false,

  async connect(wallet) {
    set({ status: 'connecting', error: null })
    try {
      const account = await connectWallet(wallet)
      const address = account.address
      set({
        status: 'connected',
        account,
        address,
        walletName: wallet.name,
        error: null,
        ledger: loadLedger(address),
        people: loadPeople(address),
        spaces: loadSpaces(address),
        receipts: loadReceipts(address),
        links: loadLinks(address),
      })
      void get().loadMarket()
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not connect to that wallet.',
        account: null,
        address: null,
      })
    }
  },

  disconnect() {
    set({
      status: 'disconnected',
      preview: false,
      account: null,
      address: null,
      walletName: null,
      balances: [],
      balancesRevealedAt: null,
      registered: null,
      ledger: [],
      people: [],
      spaces: [],
      receipts: [],
      links: [],
      lastTx: null,
      error: null,
    })
  },

  async revealBalances() {
    const { account } = get()
    if (!account) return
    set({ balancesLoading: true, error: null })
    try {
      const balances = await readShieldedBalances(account)
      set({ balances, balancesLoading: false, balancesRevealedAt: Date.now(), registered: true })
    } catch (error) {
      // NOT_REGISTERED (118) is not a failure: this account simply has no
      // private balance yet. The wallet registers it on the first deposit, so
      // the correct read is "empty", shown as the welcoming zero state.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? Number((error as { code: unknown }).code)
          : undefined
      if (code === 118) {
        set({
          balances: [],
          balancesLoading: false,
          balancesRevealedAt: Date.now(),
          registered: false,
        })
        return
      }
      set({
        balancesLoading: false,
        error: error instanceof Error ? error.message : 'The wallet declined the balance request.',
      })
    }
  },

  async loadMarket() {
    const [{ fee, live }, prices] = await Promise.all([
      readPoolFee(),
      fetchSpotPricesUsd(Object.keys(TOKENS) as TokenSymbol[]),
    ])
    set({ poolFee: fee, poolFeeLive: live, prices })
  },

  // Product-data mutations persist through the lumen modules. In preview
  // there is nothing on disk to persist into, so they operate in memory —
  // same shapes, same rules, no storage.

  addPerson(input) {
    const { address, preview, people } = get()
    if (!address) return
    if (preview) {
      set({
        people: [
          {
            id: `preview-${Date.now().toString(36)}`,
            name: input.name.trim(),
            address: input.address.trim(),
            emoji: input.emoji?.trim() || pickEmoji(input.name),
            createdAt: Date.now(),
          },
          ...people,
        ],
      })
      return
    }
    set({ people: addPerson(address, input) })
  },

  removePerson(id) {
    const { address, preview, people } = get()
    if (!address) return
    if (preview) {
      set({ people: people.filter((p) => p.id !== id) })
      return
    }
    set({ people: removePerson(address, id) })
  },

  addSpace(input) {
    const { address, preview, spaces } = get()
    if (!address) return
    if (preview) {
      set({
        spaces: [
          ...spaces,
          {
            id: `preview-${Date.now().toString(36)}`,
            name: input.name.trim(),
            emoji: input.emoji?.trim() || '✳️',
            tint: spaces.length % 5,
            ...(input.goalUsd && input.goalUsd > 0 ? { goalUsd: input.goalUsd } : {}),
            allocations: {},
            createdAt: Date.now(),
          },
        ],
      })
      return
    }
    set({ spaces: addSpace(address, input) })
  },

  removeSpace(id) {
    const { address, preview, spaces } = get()
    if (!address) return
    if (preview) {
      set({ spaces: spaces.filter((s) => s.id !== id) })
      return
    }
    set({ spaces: removeSpace(address, id) })
  },

  moveIntoSpace(spaceId, token, delta) {
    const { address, preview, spaces } = get()
    if (!address) return
    if (preview) {
      set({
        spaces: spaces.map((space) => {
          if (space.id !== spaceId) return space
          const current = allocationOf(space, token)
          const updated = current + delta < 0n ? 0n : current + delta
          const allocations = { ...space.allocations }
          if (updated === 0n) delete allocations[token]
          else allocations[token] = updated.toString()
          return { ...space, allocations }
        }),
      })
      return
    }
    set({ spaces: adjustAllocation(address, spaceId, token, delta) })
  },

  async pay(input) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const actions = buildPrivateTransfer(
        TOKENS[input.token].address,
        input.amount,
        input.recipient,
      )
      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'TRANSFER',
        asset: input.token,
        amount: input.amount,
        route: 'DIRECT',
        txHash: transaction_hash,
        counterparty: input.recipient,
        observer: '—',
      })

      const receipt = addReceipt(address, {
        txHash: transaction_hash,
        token: input.token,
        amountRaw: input.amount.toString(),
        toAddress: input.recipient,
        timestamp: Date.now(),
        ...(input.recipientName ? { toName: input.recipientName } : {}),
        ...(input.note ? { note: input.note } : {}),
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'pay', status: 'submitted' }
      set({ submitting: false, ledger, receipts: loadReceipts(address), lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return receipt
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async addMoney(input) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const actions = buildShield(TOKENS[input.token].address, input.amount)
      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'SHIELD',
        asset: input.token,
        amount: input.amount,
        route: 'DIRECT',
        txHash: transaction_hash,
        observer: 'deposit · public',
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'add', status: 'submitted' }
      set({ submitting: false, ledger, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transaction_hash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async cashOut(input) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      // Deliberately the only path in the app that can produce a public
      // withdrawal, mirroring `buildExplicitUnshield`'s own contract.
      const actions = buildExplicitUnshield(
        TOKENS[input.token].address,
        input.amount,
        input.recipient,
      )
      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'UNSHIELD',
        asset: input.token,
        amount: input.amount,
        route: 'DIRECT',
        txHash: transaction_hash,
        counterparty: input.recipient,
        observer: 'withdrawal · public',
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'out', status: 'submitted' }
      set({ submitting: false, ledger, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transaction_hash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async sendClaimLink(input) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const claimSecret = generateSecret()
      const refundSecret = generateSecret()
      const expiry = Math.floor(Date.now() / 1000) + Math.max(3600, input.refundAfterS)

      const actions = buildEscrowFund({
        token: TOKENS[input.token].address,
        amount: input.amount,
        claimSecret,
        refundSecret,
        expiry,
      })
      // The fund leg withdraws to the escrow helper — the one shape of
      // withdraw the app is allowed to produce. Enforced, not assumed.
      assertNeverUnshields(actions, { contracts: [ESCROW_ADDRESS] })

      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const link = addLink(address, {
        claimSecret,
        refundSecret,
        token: input.token,
        amountRaw: input.amount.toString(),
        expiry,
        createdAt: Date.now(),
        txHash: transaction_hash,
        ...(input.note ? { note: input.note } : {}),
      })
      const url = encodeClaimLink(window.location.origin, {
        v: 1,
        s: claimSecret,
        t: TOKENS[input.token].address,
        a: input.amount.toString(),
        ...(input.fromName ? { f: input.fromName } : {}),
        ...(input.note ? { n: input.note } : {}),
      })

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'LINK',
        asset: input.token,
        amount: input.amount,
        route: 'DIRECT',
        txHash: transaction_hash,
        observer: 'escrow · public amount',
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'link', status: 'submitted' }
      set({ submitting: false, ledger, links: loadLinks(address), lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return { link, url }
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async claimFromLink(payload) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const actions = buildEscrowClaim({
        token: payload.t,
        recipient: address,
        secret: payload.s,
      })
      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const token = tokenByAddress(payload.t)
      const ledger = token
        ? appendLedger(address, {
            timestamp: Date.now(),
            type: 'CLAIM',
            asset: token.symbol,
            amount: BigInt(payload.a),
            route: 'DIRECT',
            txHash: transaction_hash,
            observer: 'claim · public amount',
          })
        : get().ledger

      const lastTx: LastTx = { hash: transaction_hash, kind: 'claim', status: 'submitted' }
      set({ submitting: false, ledger, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transaction_hash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async refundLink(id) {
    const { account, address } = requireAccount(get, set)
    const link = get().links.find((l) => l.id === id)
    if (!link) throw new Error('That link is not in this device’s records.')
    set({ submitting: true, error: null })
    try {
      const actions = buildEscrowRefund({
        token: TOKENS[link.token].address,
        recipient: address,
        secret: link.refundSecret,
      })
      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'CLAIM',
        asset: link.token,
        amount: BigInt(link.amountRaw),
        route: 'DIRECT',
        txHash: transaction_hash,
        observer: 'reclaim · public amount',
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'claim', status: 'submitted' }
      set({
        submitting: false,
        ledger,
        links: updateLinkStatus(address, id, 'refunded'),
        lastTx,
      })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transaction_hash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async syncLinks() {
    const { address, links, preview } = get()
    if (!address || preview) return
    for (const link of links) {
      if (link.status !== 'open') continue
      const entry = await readEscrowEntry(link.claimSecret)
      if (entry?.claimed) updateLinkStatus(address, link.id, 'claimed')
    }
    set({ links: loadLinks(address) })
  },

  clearError() {
    set({ error: null })
  },

  preview: false,

  /**
   * Sample-data walkthrough for people without a privacy wallet installed.
   *
   * Everything rendered is clearly-labeled fixture data on a throwaway
   * address; there is no account, so every chain action still refuses with
   * "Connect a wallet first." — the preview can show the product, never fake
   * a transaction. Market data (prices, pool fee) is still fetched live.
   */
  enterPreview() {
    const now = Date.now()
    const HOUR = 3_600_000
    const amara = '0x0421b1fca8f3a4b2e9a1c6d80e3f1972d54ab8c0de91f2a34b56c78d90e1f234'
    const landlord = '0x05512c3d97e4b8a1f2063c5d41e8ba97310fedcba98765432100ffeeddccbbaa'
    const demo = {
      address: '0x0777de1ab77e57a1d8c2b3f4a5968derived0000000000000000000demo0001',
      balances: [
        { symbol: 'USDC' as const, address: TOKENS.USDC.address, raw: 2_412_713_400n, decimals: 6 },
        { symbol: 'STRK' as const, address: TOKENS.STRK.address, raw: 1_203_814_000_000_000_000_000n, decimals: 18 },
      ],
      people: [
        { id: 'p-amara', name: 'Amara', address: amara, emoji: '🌊', createdAt: now - 40 * 24 * HOUR },
        { id: 'p-landlord', name: 'Landlord', address: landlord, emoji: '🏠', createdAt: now - 90 * 24 * HOUR },
      ],
      spaces: [
        {
          id: 's-travel',
          name: 'Travel',
          emoji: '✈️',
          tint: 3,
          goalUsd: 3000,
          allocations: { USDC: '1240310000' },
          createdAt: now - 30 * 24 * HOUR,
        },
        {
          id: 's-rainy',
          name: 'Rainy day',
          emoji: '☔️',
          tint: 0,
          allocations: { USDC: '612480000' },
          createdAt: now - 21 * 24 * HOUR,
        },
      ],
      links: [
        {
          id: 'link-1',
          claimSecret: '0x1234',
          refundSecret: '0x5678',
          token: 'USDC' as const,
          amountRaw: '52880000',
          expiry: Math.floor(now / 1000) + 5 * 24 * 3600,
          note: 'Coffee money ☕️',
          createdAt: now - 5 * HOUR,
          status: 'open' as const,
        },
      ],
      ledger: [
        {
          id: 'l-0',
          timestamp: now - 5 * HOUR,
          type: 'LINK' as const,
          asset: 'USDC' as const,
          amount: 52_880_000n,
          route: 'DIRECT' as const,
          txHash: '0x07f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1',
          observer: 'escrow · public amount',
        },
        {
          id: 'l-1',
          timestamp: now - 2 * HOUR,
          type: 'TRANSFER' as const,
          asset: 'USDC' as const,
          amount: 212_470_000n,
          route: 'DIRECT' as const,
          txHash: '0x04d21b3c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f9e1a',
          counterparty: amara,
          observer: '—',
        },
        {
          id: 'l-2',
          timestamp: now - 26 * HOUR,
          type: 'TRANSFER' as const,
          asset: 'USDC' as const,
          amount: 938_120_000n,
          route: 'DIRECT' as const,
          txHash: '0x02c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
          counterparty: landlord,
          observer: '—',
        },
        {
          id: 'l-3',
          timestamp: now - 3 * 24 * HOUR,
          type: 'SHIELD' as const,
          asset: 'USDC' as const,
          amount: 987_310_000n,
          route: 'DIRECT' as const,
          txHash: '0x06e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8',
          observer: 'deposit · public',
        },
      ],
      receipts: [
        {
          id: 'r-1',
          txHash: '0x04d21b3c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f9e1a',
          token: 'USDC' as const,
          amountRaw: '212470000',
          toName: 'Amara',
          toAddress: amara,
          note: 'Dinner + tickets',
          timestamp: now - 2 * HOUR,
        },
        {
          id: 'r-2',
          txHash: '0x02c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
          token: 'USDC' as const,
          amountRaw: '938120000',
          toName: 'Landlord',
          toAddress: landlord,
          timestamp: now - 26 * HOUR,
        },
      ],
    }

    set({
      status: 'connected',
      preview: true,
      account: null,
      address: demo.address,
      walletName: 'Preview',
      balances: demo.balances,
      balancesRevealedAt: now,
      registered: true,
      ledger: demo.ledger,
      people: demo.people,
      spaces: demo.spaces,
      receipts: demo.receipts,
      links: demo.links,
      prices: { USDC: 1, STRK: 0.41, ETH: 4120, WBTC: 108_500, strkBTC: 108_500 },
      error: null,
    })
    void get().loadMarket()
  },
}))
