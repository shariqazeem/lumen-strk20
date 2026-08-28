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
  buildSplit,
  buildPrivateTransfer,
  buildShield,
  explainWalletError,
} from '@/lib/strk20/actions'
import {
  buildEscrowClaim,
  buildEscrowFund,
  buildEscrowFundMany,
  buildEscrowRefund,
  buildPublicClaim,
  findEscrowHolding,
  encodeClaimLink,
  ESCROW_ADDRESS,
  generateSecret,
  MIN_REFUND_WINDOW_S,
  readEscrowEntry,
  type ClaimLinkPayload,
} from '@/lib/strk20/escrow'
import { addLink, loadLinks, updateLinkStatus, type SentLink } from './links'
import { readPoolFee } from '@/lib/strk20/pool'
import { executeAvnuPrivateSwap, fetchSpotPricesUsd, type Quote } from '@/lib/strk20/swap'
import { FALLBACK_POOL_FEE_STRK, TOKENS, tokenByAddress, type TokenSymbol } from '@/lib/strk20/config'
import { appendLedger, loadLedger, type LedgerEntry } from '@/lib/history'
import { loadPeople, addPerson, removePerson, type Person } from './people'
import {
  addSpace,
  adjustAllocation,
  loadSpaces,
  removeSpace,
  type Space,
  type SpaceIcon,
} from './spaces'
import { addReceipt, loadReceipts, type Receipt } from './receipts'
import { loadJournal, recordDecision, type JournalEntry } from './journal'
import { rememberLink } from './inbox'
import { loadArrivals, syncArrivals, type Arrival } from './arrivals'
import type { GuardReport } from './guard'
import { guardSeed } from './guard'
import { scatterPlan, SPLITTER_ADDRESS } from './scatter'
import { isAccountDeployed, readRegistration } from '@/lib/strk20/registration'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface LastTx {
  hash: string
  kind: 'pay' | 'add' | 'out' | 'link' | 'claim' | 'convert'
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
  /** What the engine decided, action by action. */
  journal: JournalEntry[]
  /** Money that showed up without this device doing anything. */
  arrivals: Arrival[]

  lastTx: LastTx | null
  submitting: boolean

  connect: (wallet: WalletWithStarknetFeatures) => Promise<void>
  disconnect: () => void
  revealBalances: () => Promise<void>
  loadMarket: () => Promise<void>

  addPerson: (input: { name: string; address: string; emoji?: string }) => void
  removePerson: (id: string) => void
  addSpace: (input: { name: string; icon?: SpaceIcon; goalUsd?: number }) => void
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
  scatterBalance: (input: {
    token: TokenSymbol
    amount: bigint
    count: number
  }) => Promise<number>
  cashOut: (input: { token: TokenSymbol; amount: bigint; recipient: string }) => Promise<string>

  /**
   * Pay several people in one pool operation: N private transfers in a single
   * action list. Public sees one operation, each recipient sees only their own
   * amount, and one flat pool fee covers all of them.
   */
  paySplit: (input: {
    token: TokenSymbol
    recipients: Array<{ address: string; name?: string; amount: bigint }>
    note?: string
  }) => Promise<Receipt[]>

  /** Fund a claim link; returns the record plus the shareable URL. */
  sendClaimLinks: (input: {
    token: TokenSymbol
    legs: readonly { amount: bigint; name?: string; note?: string }[]
    refundAfterS: number
    fromName?: string
  }) => Promise<{ amount: bigint; name?: string; url: string }[]>
  sendClaimLink: (input: {
    token: TokenSymbol
    amount: bigint
    /** Seconds until the refund path opens. */
    refundAfterS: number
    note?: string
    fromName?: string
  }) => Promise<{ link: SentLink; url: string }>
  /** Claim a link into this account's private balance. */
  claimToAddress: (input: { secret: string; recipient: string }) => Promise<string>
  claimAnyWay: (input: {
    payload: ClaimLinkPayload
    recipient: string
  }) => Promise<string>
  probeClaim: () => Promise<'private' | 'public'>
  claimFromLink: (payload: ClaimLinkPayload) => Promise<string>
  /** Reclaim an expired, unclaimed link back into this private balance. */
  refundLink: (id: string) => Promise<string>
  /** Re-check every open link against the escrow; the chain is the truth. */
  syncLinks: () => Promise<void>

  /**
   * Execute a quoted AVNU private swap: value converts inside the pool and
   * lands in a fresh private note. Quoting itself is stateless and lives in
   * the sheet; this is the signing half.
   */
  convert: (input: { quote: Quote; sellToken: TokenSymbol; sellAmount: bigint }) => Promise<string>

  /** Persist what the engine decided about an action that just executed. */
  noteDecision: (input: {
    action: JournalEntry['action']
    report: GuardReport
    rewritten?: { from: string; to: string; token: string }
  }) => void

  clearError: () => void

  /**
   * Development-only: fill the account with representative data so the whole
   * surface can be built and reviewed without a wallet. Guarded by NODE_ENV,
   * so it cannot be reached in a production build — nothing in the shipped
   * product is sample data.
   */
  devPreview: (variant?: 'full' | 'empty') => void
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
 * store's error state (not just a throw) is what makes it visible in the UI.
 */
/**
 * One wallet operation at a time.
 *
 * Every submitting action guards on this rather than trusting a disabled
 * button: a second entry point, a stray keypress, or a component that
 * re-renders mid-flight would otherwise queue a second prompt against money
 * that is already moving. Rejecting is free; a duplicate transfer is not.
 */
/**
 * How long to wait on a wallet before asking the chain instead.
 *
 * A wallet's promise can hang: the user rejects and nothing rejects back, or
 * the transaction succeeds and the response never routes home. Both leave the
 * UI insisting it is waiting while the money has already moved, which is the
 * worst thing this product can display.
 */
const WALLET_TIMEOUT_MS = 45_000

/** Resolves to `null` if the wallet has not answered in time. */
function withWalletTimeout<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WALLET_TIMEOUT_MS)),
  ])
}

/**
 * Ask the escrow whether a claim actually settled.
 *
 * The chain is the authority. If the wallet went quiet but the entry is marked
 * claimed, the money moved and the UI must say so.
 */
async function claimSettled(secret: string): Promise<boolean> {
  const holder = await findEscrowHolding(secret)
  // A settled entry is still *present* — `take_entry` flips `claimed` rather
  // than deleting it, which is what lets the app tell "already collected"
  // apart from "never existed". Checking only for absence would report a
  // successful claim as unsettled, which is the bug this function exists to
  // prevent.
  return holder !== null && holder.entry.claimed
}

function requireIdle(get: () => LumenState): void {
  if (get().submitting) throw new Error('Something is already going to your wallet — finish that first.')
}

function requireAccount(
  get: () => LumenState,
  set: (partial: Partial<LumenState>) => void,
): { account: WalletAccountV6; address: string } {
  const { account, address } = get()
  if (account && address) return { account, address }
  const message = 'Connect a wallet first.'
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
  journal: [],
  arrivals: [],

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
        journal: loadJournal(address),
        arrivals: loadArrivals(address),
      })
      void get().loadMarket()
      // The pool publishes every account's viewing key, so whether this one
      // can hold a private balance is readable without a wallet prompt. It
      // decides which single screen the account opens on.
      void readRegistration(address).then((result) => {
        if (get().address !== address) return
        if (result !== 'unknown') set({ registered: result === 'registered' })
      })
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
      journal: [],
      arrivals: [],
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
      // A balance read is the only moment an arrival can be inferred, so
      // reconcile here rather than on a timer we are not allowed to run.
      const { address } = get()
      const { arrivals } = address
        ? syncArrivals(address, balances, get().ledger)
        : { arrivals: [] as Arrival[] }
      set({
        balances,
        balancesLoading: false,
        balancesRevealedAt: Date.now(),
        registered: true,
        arrivals,
      })
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

  // Product-data mutations persist through the modules under @/lib/lumen.

  addPerson(input) {
    const { address } = get()
    if (!address) return
    set({ people: addPerson(address, input) })
  },

  removePerson(id) {
    const { address } = get()
    if (!address) return
    set({ people: removePerson(address, id) })
  },

  addSpace(input) {
    const { address } = get()
    if (!address) return
    set({ spaces: addSpace(address, input) })
  },

  removeSpace(id) {
    const { address } = get()
    if (!address) return
    set({ spaces: removeSpace(address, id) })
  },

  moveIntoSpace(spaceId, token, delta) {
    const { address } = get()
    if (!address) return
    set({ spaces: adjustAllocation(address, spaceId, token, delta) })
  },

  async pay(input) {
    requireIdle(get)
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

  async paySplit(input) {
    requireIdle(get)
    const { account, address } = requireAccount(get, set)
    const recipients = input.recipients.filter((r) => r.amount > 0n)
    if (recipients.length === 0) throw new Error('Add at least one person and an amount.')
    set({ submitting: true, error: null })
    try {
      const tokenAddress = TOKENS[input.token].address
      const actions = recipients.flatMap((r) =>
        buildPrivateTransfer(tokenAddress, r.amount, r.address),
      )
      assertNeverUnshields(actions, { contracts: [] })

      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      // One transaction, but one ledger entry and one receipt per person: each
      // recipient is a separate relationship, and each may need to prove their
      // own payment without seeing anyone else's.
      const now = Date.now()
      let ledger = get().ledger
      for (const r of recipients) {
        ledger = appendLedger(address, {
          timestamp: now,
          type: 'TRANSFER',
          asset: input.token,
          amount: r.amount,
          route: 'DIRECT',
          txHash: transaction_hash,
          counterparty: r.address,
          observer: '—',
        })
        addReceipt(address, {
          txHash: transaction_hash,
          token: input.token,
          amountRaw: r.amount.toString(),
          toAddress: r.address,
          timestamp: now,
          ...(r.name ? { toName: r.name } : {}),
          ...(input.note ? { note: input.note } : {}),
        })
      }

      const lastTx: LastTx = { hash: transaction_hash, kind: 'pay', status: 'submitted' }
      const receipts = loadReceipts(address)
      set({ submitting: false, ledger, receipts, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return receipts.slice(0, recipients.length)
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async addMoney(input) {
    requireIdle(get)
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

  /**
   * Break the balance into unequal notes before any of it leaves.
   *
   * Nothing goes public here: the value is withdrawn to the splitter and
   * credited straight back into fresh notes owned by the same account, in one
   * pool operation. What changes is the shape an observer meets at the exit —
   * several uneven notes instead of one round one.
   */
  async scatterBalance(input) {
    requireIdle(get)
    const { account, address } = requireAccount(get, set)
    const plan = scatterPlan({
      token: TOKENS[input.token].address,
      amount: input.amount,
      count: input.count,
      seed: guardSeed(address, Date.now()),
    })
    if (!plan) throw new Error('That amount is too small to split usefully.')

    set({ submitting: true, error: null })
    try {
      const actions = buildSplit(plan)
      // The split must never become an unshield: the only address it may
      // withdraw to is the splitter itself.
      assertNeverUnshields(actions, { contracts: [SPLITTER_ADDRESS] })

      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'TRANSFER',
        asset: input.token,
        amount: input.amount,
        route: 'POOL',
        txHash: transaction_hash,
        observer: '—',
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'pay', status: 'submitted' }
      set({ submitting: false, ledger, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return plan.parts.length
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async cashOut(input) {
    requireIdle(get)
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

  /**
   * N claim links, one pool operation.
   *
   * Every recipient gets their own secret and their own refund path, so the
   * links are independent afterwards — but they are funded together, which is
   * the point: one fee, one timestamp, and nothing in the sizes or the spacing
   * for an observer to line up. Minting them one at a time would publish the
   * whole payout as a sequence.
   */
  async sendClaimLinks(input) {
    requireIdle(get)
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const expiry =
        Math.floor(Date.now() / 1000) + Math.max(MIN_REFUND_WINDOW_S, input.refundAfterS)

      const drafted = input.legs.map((leg) => ({
        ...leg,
        claimSecret: generateSecret(),
        refundSecret: generateSecret(),
      }))

      const actions = buildEscrowFundMany({
        token: TOKENS[input.token].address,
        expiry,
        legs: drafted.map((leg) => ({
          amount: leg.amount,
          claimSecret: leg.claimSecret,
          refundSecret: leg.refundSecret,
        })),
      })
      assertNeverUnshields(actions, { contracts: [ESCROW_ADDRESS] })

      const { transaction_hash } = await account.strk20InvokeTransaction(actions)

      const minted = drafted.map((leg) => {
        addLink(address, {
          claimSecret: leg.claimSecret,
          refundSecret: leg.refundSecret,
          token: input.token,
          amountRaw: leg.amount.toString(),
          expiry,
          createdAt: Date.now(),
          txHash: transaction_hash,
          ...(leg.note ? { note: leg.note } : {}),
        })
        return {
          amount: leg.amount,
          ...(leg.name ? { name: leg.name } : {}),
          url: encodeClaimLink(window.location.origin, {
            v: 1,
            s: leg.claimSecret,
            t: TOKENS[input.token].address,
            a: leg.amount.toString(),
            ...(input.fromName ? { f: input.fromName } : {}),
            ...(leg.note ? { n: leg.note } : {}),
          }),
        }
      })

      const total = drafted.reduce((sum, leg) => sum + leg.amount, 0n)
      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'LINK',
        asset: input.token,
        amount: total,
        route: 'DIRECT',
        txHash: transaction_hash,
        observer: `escrow · ${drafted.length} links · public total`,
      })

      const lastTx: LastTx = { hash: transaction_hash, kind: 'link', status: 'submitted' }
      set({ submitting: false, ledger, links: loadLinks(address), lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return minted
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async sendClaimLink(input) {
    requireIdle(get)
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const claimSecret = generateSecret()
      const refundSecret = generateSecret()
      const expiry =
        Math.floor(Date.now() / 1000) + Math.max(MIN_REFUND_WINDOW_S, input.refundAfterS)

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

  /**
   * Collect a link straight to a public address.
   *
   * The second door. Not a pool action — an ordinary contract call — so it
   * works for someone who has never registered, has no shielded balance and
   * cannot pay the pool's flat fee. What it costs is publicity: this leg names
   * the recipient and the amount. The sender is not named by it.
   */
  /**
   * Take the money, whichever way works.
   *
   * There are two doors and the person opening a link should not have to learn
   * that. If this account can hold a private balance the money lands
   * privately; if it cannot, it lands publicly. Both are collections of the
   * same claim, and the difference is reported afterwards rather than posed as
   * a question beforehand.
   *
   * The one thing that is never done silently is publishing something. If the
   * public door is the only one available, the caller is told before it runs —
   * `probeClaim` exists for that.
   */
  async claimAnyWay(input) {
    const route = await get().probeClaim()
    return route === 'private'
      ? get().claimFromLink(input.payload)
      : get().claimToAddress({ secret: input.payload.s, recipient: input.recipient })
  },

  /** Which door this account can use, decided before anything is signed. */
  async probeClaim() {
    const { address, registered } = get()
    if (!address) return 'public'
    if (registered === true) return 'private'
    if (registered === false) return 'public'
    const result = await readRegistration(address)
    return result === 'registered' ? 'private' : 'public'
  },

  async claimToAddress(input) {
    requireIdle(get)
    const { account } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const holder = await findEscrowHolding(input.secret)
      if (!holder) throw new Error('No escrow is holding this link. It may already be claimed.')

      // A wallet minutes old has an address but not yet a deployed account
      // contract. It can receive tokens and cannot send a transaction, which
      // otherwise surfaces as an unexplained "transaction failed".
      if ((await isAccountDeployed(input.recipient)) === false) {
        throw new Error(
          'This wallet has not been activated on Starknet yet — it has an address but no account ' +
            'contract. Wallets deploy it on their first transaction, so send any small amount ' +
            'into it, or make one transaction from it, then come back to this link.',
        )
      }

      const call = buildPublicClaim({
        escrowAddress: holder.address,
        secret: input.secret,
        recipient: input.recipient,
      })
      // A plain Starknet invoke, deliberately not `strk20InvokeTransaction`:
      // nothing about this touches the pool.
      const submitted = await withWalletTimeout(account.execute([call]))
      if (!submitted) {
        if (await claimSettled(input.secret)) {
          set({ submitting: false, error: null })
          return ''
        }
        throw new Error(
          'Your wallet did not answer. Check it — if the transaction went through, this link is ' +
            'already claimed and refreshing will show it.',
        )
      }
      const { transaction_hash } = submitted

      const lastTx: LastTx = { hash: transaction_hash, kind: 'claim', status: 'submitted' }
      set({ submitting: false, lastTx })
      void watchTx(transaction_hash, (status) =>
        set((s) => (s.lastTx?.hash === transaction_hash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transaction_hash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async claimFromLink(payload) {
    requireIdle(get)
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const actions = buildEscrowClaim({
        token: payload.t,
        recipient: address,
        secret: payload.s,
      })
      const submitted = await withWalletTimeout(account.strk20InvokeTransaction(actions))
      if (!submitted) {
        // The wallet stopped answering. The chain still knows the truth.
        if (await claimSettled(payload.s)) {
          set({ submitting: false, error: null })
          return ''
        }
        throw new Error(
          'Your wallet did not answer. Check it — if the transaction went through, this link is ' +
            'already claimed and refreshing will show it.',
        )
      }
      const { transaction_hash } = submitted

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
    requireIdle(get)
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

  async convert(input) {
    const { account, address } = requireAccount(get, set)
    set({ submitting: true, error: null })
    try {
      const { transactionHash } = await executeAvnuPrivateSwap({
        account,
        quote: input.quote,
      })

      const ledger = appendLedger(address, {
        timestamp: Date.now(),
        type: 'SWAP',
        asset: input.sellToken,
        amount: input.sellAmount,
        route: 'AVNU',
        txHash: transactionHash,
        observer: 'executor → AMM',
      })

      const lastTx: LastTx = { hash: transactionHash, kind: 'convert', status: 'submitted' }
      set({ submitting: false, ledger, lastTx })
      void watchTx(transactionHash, (status) =>
        set((s) => (s.lastTx?.hash === transactionHash ? { lastTx: { ...s.lastTx, status } } : {})),
      )
      return transactionHash
    } catch (error) {
      set({ submitting: false, error: explainWalletError(error) })
      throw error
    }
  },

  async syncLinks() {
    const { address, links } = get()
    if (!address) return
    for (const link of links) {
      if (link.status !== 'open') continue
      const entry = await readEscrowEntry(link.claimSecret)
      if (entry?.claimed) updateLinkStatus(address, link.id, 'claimed')
    }
    set({ links: loadLinks(address) })
  },

  noteDecision(input) {
    const { address } = get()
    if (!address) return
    set({ journal: recordDecision(address, input) })
  },

  clearError() {
    set({ error: null })
  },

  devPreview(variant = 'full') {
    if (process.env.NODE_ENV !== 'development') return

    const now = Date.now()
    const HOUR = 3_600_000
    const address = '0x0777de1ab77e57a1d8c2b3f4a5968de00000000000000000000000000de0001'
    const amara = '0x0421b1fca8f3a4b2e9a1c6d80e3f1972d54ab8c0de91f2a34b56c78d90e1f234'
    const landlord = '0x05512c3d97e4b8a1f2063c5d41e8ba97310fedcba98765432100ffeeddccbbaa'
    const client = '0x0663a1e5b8c9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5'

    // Seed through the real persistence modules so the surface exercises the
    // same code paths a live account would.
    try {
      localStorage.removeItem('lumen:inbox:v1')
      // Reset the journal too, or repeated dev entries keep inflating it.
      localStorage.removeItem(`lumen:journal:v1:${BigInt(address).toString(16)}`)
    } catch {
      // Nothing to clear.
    }
    rememberLink({
      claimSecret: '0xde01',
      token: 'USDC',
      amountRaw: '52880000',
      fromName: 'Amara',
      note: 'Coffee money',
    })
    rememberLink({
      claimSecret: '0xde02',
      token: 'STRK',
      amountRaw: '40000000000000000000',
      fromName: 'Hackathon',
      note: 'Bounty payout',
    })

    for (const seed of [
      { action: 'pay' as const, level: 'protected' as const },
      {
        action: 'add' as const,
        level: 'tuned' as const,
        rewritten: { from: '100', to: '99.889991', token: 'USDC' },
      },
      { action: 'link' as const, level: 'protected' as const },
      {
        action: 'out' as const,
        level: 'attention' as const,
        warn: 'This is almost exactly what you deposited recently.',
      },
      { action: 'pay' as const, level: 'protected' as const },
    ]) {
      recordDecision(address, {
        action: seed.action,
        report: {
          level: seed.level,
          checks: [
            { id: 'p', label: 'No public record', detail: 'Nothing was published.', status: 'pass' },
            ...(seed.warn
              ? [
                  {
                    id: 'w',
                    label: 'Entry and exit unlinked',
                    detail: seed.warn,
                    status: 'warn' as const,
                  },
                ]
              : []),
          ],
        },
        ...(seed.rewritten ? { rewritten: seed.rewritten } : {}),
      })
    }

    if (variant === 'empty') {
      // The first-run screen: connected, but nothing has ever happened.
      set({
        status: 'connected',
        account: null,
        address,
        walletName: 'Preview',
        balancesRevealedAt: null,
        registered: false,
        balances: [],
        prices: { USDC: 1, STRK: 0.41 },
        arrivals: [],
        journal: [],
        people: [],
        spaces: [],
        receipts: [],
        links: [],
        ledger: [],
        error: null,
      })
      return
    }

    set({
      status: 'connected',
      account: null,
      address,
      walletName: 'Preview',
      balancesRevealedAt: now,
      registered: true,
      balances: [
        { symbol: 'USDC', address: TOKENS.USDC.address, raw: 2_412_713_400n, decimals: 6 },
        { symbol: 'STRK', address: TOKENS.STRK.address, raw: 1_203_814_000_000_000_000_000n, decimals: 18 },
      ],
      prices: { USDC: 1, STRK: 0.41, ETH: 4120, WBTC: 108_500, strkBTC: 108_500 },
      arrivals: [
        { id: 'a1', token: 'USDC', amountRaw: '800000000', detectedAt: now - 40 * 60_000 },
        { id: 'a2', token: 'USDC', amountRaw: '212470000', detectedAt: now - 6 * HOUR },
      ],
      journal: loadJournal(address),
      people: [
        { id: 'p1', name: 'Amara Diallo', address: amara, createdAt: now - 40 * 24 * HOUR },
        { id: 'p2', name: 'Landlord', address: landlord, createdAt: now - 90 * 24 * HOUR },
        { id: 'p3', name: 'Ines Roy', address: client, createdAt: now - 20 * 24 * HOUR },
      ],
      spaces: [],
      receipts: [],
      links: [],
      ledger: [
        {
          id: 'l1',
          timestamp: now - 2 * HOUR,
          type: 'TRANSFER',
          asset: 'USDC',
          amount: 212_470_000n,
          route: 'DIRECT',
          txHash: '0x04d21b3c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f9e1a',
          counterparty: amara,
          observer: '—',
        },
        {
          id: 'l2',
          timestamp: now - 5 * HOUR,
          type: 'LINK',
          asset: 'USDC',
          amount: 52_880_000n,
          route: 'DIRECT',
          txHash: '0x07f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1',
          observer: 'escrow · public amount',
        },
        {
          id: 'l3',
          timestamp: now - 3 * 24 * HOUR,
          type: 'SHIELD',
          asset: 'USDC',
          amount: 987_310_000n,
          route: 'DIRECT',
          txHash: '0x06e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8',
          observer: 'deposit · public',
        },
      ],
      error: null,
    })
  },

}))
