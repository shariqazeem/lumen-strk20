'use client'

/**
 * LumenEscrow rails — claim links.
 *
 * A claim link parks value behind a secret inside the LumenEscrow anonymizer:
 * the sender's wallet funds it through the pool (no public sender), the link
 * carries the secret in its URL fragment (never sent to any server), and the
 * recipient's wallet claims straight into an open note (no public recipient).
 *
 * Every constant here is pinned against the Cairo side by
 * `test_claim_commitment_matches_client_vector` in the contract test suite —
 * a drift between these two files would mint links the contract cannot find.
 */

import { hash, RpcProvider, shortString } from 'starknet'
import { rpc } from './rpc'
import type { STRK20_ACTION } from '@starknet-io/types-js'
import { walletFelt, RPC_URL, sameAddress, TOKEN_LIST, TOKENS, type TokenConfig } from './config'
import { decodeClaim, encodeClaim } from '@/lib/lumen/codec'
import { openNoteRef } from './actions'

/** Deployed LumenEscrow instance; empty until the mainnet deploy lands. */
const RAW_ESCROW_ADDRESS = process.env.NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS ?? ''

/**
 * Padded on read, so however the address was written into the environment —
 * a deploy log, a dashboard field, a copy-paste — the wallet always receives
 * the canonical form.
 */
export const ESCROW_ADDRESS = RAW_ESCROW_ADDRESS ? walletFelt(RAW_ESCROW_ADDRESS) : ''

/**
 * Escrows that have ever held a Lumen link, newest first.
 *
 * A redeploy is a version, not a replacement. Links already in the world name
 * no escrow — they carry a secret — so the app finds the one holding the
 * commitment rather than assuming the current address. A dead link is money
 * somebody cannot reach, and nothing minted here is allowed to become one.
 *
 * Append superseded addresses; never remove one.
 */
export const KNOWN_ESCROWS: string[] = [
  ESCROW_ADDRESS,
  // First mainnet escrow. Eight-argument `privacy_invoke`, no batch, no public
  // claim. Superseded 2026-08-28; still holds anything minted against it.
  '0x293c8a9541d00d0762797a16353f2505aeeaef650bf9f3e8f0a68a98d9b8cd8',
  // Second. Nine arguments and DepositMany; superseded by the public-claim
  // version.
  '0x43e41de87ebfaec2913a85398a68e011ab2a92bbddb9211956bfabe6ed57288',
].filter((address, index, all) => {
  if (!address) return false
  try {
    return all.findIndex((other) => other && BigInt(other) === BigInt(address)) === index
  } catch {
    return false
  }
})

/**
 * Which escrow is holding this claim, if any.
 *
 * Asks each known escrow for the entry and takes the first that owns it. A
 * commitment can only live in one, because minting writes it to exactly one.
 */
export async function findEscrowHolding(
  claimSecret: string,
): Promise<{ address: string; entry: EscrowEntryState } | null> {
  const commitment = claimCommitment(claimSecret)
  for (const address of KNOWN_ESCROWS) {
    try {
      const entry = await readEscrowEntryAt(address, commitment)
      if (entry && entry.exists) return { address, entry }
    } catch {
      // An escrow that cannot be read is not the one holding this link.
    }
  }
  return null
}

export function escrowEnabled(): boolean {
  return ESCROW_ADDRESS.length > 0
}

/** Must match `CLAIM_TAG` / `REFUND_TAG` in `contracts/src/escrow.cairo`. */
const CLAIM_TAG = shortString.encodeShortString('LUMEN_ESCROW_CLAIM:V1')
const REFUND_TAG = shortString.encodeShortString('LUMEN_ESCROW_REFUND:V1')

/** Cairo enum discriminants for `EscrowOperation`. */
const OP = { DEPOSIT: '0x0', CLAIM: '0x1', REFUND: '0x2', DEPOSIT_MANY: '0x3' } as const

/** Matches `MAX_BATCH` in escrow.cairo. Kept in step by a test. */
export const MAX_BATCH = 32

/**
 * A fresh 248-bit secret — comfortably inside the felt field, far beyond
 * guessability. Returned as 0x-hex.
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(31)
  crypto.getRandomValues(bytes)
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  if (value === 0n) value = 1n
  return `0x${value.toString(16)}`
}

export function claimCommitment(secret: string): string {
  return hash.computePoseidonHashOnElements([CLAIM_TAG, secret])
}

export function refundCommitment(secret: string): string {
  return hash.computePoseidonHashOnElements([REFUND_TAG, secret])
}

const hex = (value: bigint) => `0x${value.toString(16)}`

/**
 * Fund a claim link: one atomic pool transaction.
 *
 *   1. withdraw `amount` of `token` to the escrow (public leg: pool → escrow)
 *   2. invoke Deposit — the escrow records the commitment and keeps the value
 *
 * The withdraw recipient is the escrow contract itself, which
 * `assertNeverUnshields` must be told about via its allowlist.
 */
export function buildEscrowFund(input: {
  token: string
  amount: bigint
  claimSecret: string
  refundSecret: string
  /** Seconds since epoch when the refund path opens. */
  expiry: number
}): STRK20_ACTION[] {
  if (!escrowEnabled()) throw new Error('Claim links are not enabled on this deployment yet.')
  return [
    {
      type: 'withdraw',
      token: walletFelt(input.token),
      amount: hex(input.amount),
      recipient: ESCROW_ADDRESS,
    },
    {
      type: 'invoke',
      contract: ESCROW_ADDRESS,
      calldata: [
        OP.DEPOSIT,
        claimCommitment(input.claimSecret),
        refundCommitment(input.refundSecret),
        hex(BigInt(Math.max(0, Math.trunc(input.expiry)))),
        walletFelt(input.token),
        hex(input.amount),
        '0x0',
        '0x0',
        // No batch payload: Cairo reads an empty `Span<EscrowLeg>` as a zero
        // length and nothing after it.
        '0x0',
      ],
    },
  ]
}

export interface BatchLeg {
  /** Raw units for this recipient. */
  amount: bigint
  claimSecret: string
  refundSecret: string
}

/**
 * Fund N claim links in one pool operation.
 *
 * One Withdraw leg carries the whole total to the escrow, and one invoke
 * records every commitment against it — so N people who are not set up yet
 * each have money waiting, and the chain sees a single operation with a single
 * fee and a single timestamp. Paying them one at a time would publish N
 * operations whose sizes and spacing are a pattern in themselves.
 *
 * Each recipient still joins the pool in their own wallet before collecting;
 * verified on mainnet, a never-registered account is refused with 118. What
 * they do not need is to be set up when the money is *sent*, which is what a
 * private transfer requires and what nothing else on this board offers.
 *
 * The contract requires `amount` to equal the sum of the legs, so a caller
 * cannot hand out more claims than the pool actually delivered.
 */
export function buildEscrowFundMany(input: {
  token: string
  legs: readonly BatchLeg[]
  /** Seconds since epoch when every refund path in this batch opens. */
  expiry: number
}): STRK20_ACTION[] {
  if (!escrowEnabled()) throw new Error('Claim links are not enabled on this deployment yet.')
  if (input.legs.length === 0) throw new Error('A batch needs at least one recipient.')
  if (input.legs.length > MAX_BATCH) {
    throw new Error(`A batch holds at most ${MAX_BATCH} recipients.`)
  }

  const total = input.legs.reduce((sum, leg) => sum + leg.amount, 0n)
  if (total <= 0n) throw new Error('A batch needs a positive total.')

  // `Span<EscrowLeg>` serialises as a length followed by each field in
  // declaration order: claim, refund, amount.
  const legs: string[] = [hex(BigInt(input.legs.length))]
  for (const leg of input.legs) {
    legs.push(
      claimCommitment(leg.claimSecret),
      refundCommitment(leg.refundSecret),
      hex(leg.amount),
    )
  }

  return [
    {
      type: 'withdraw',
      token: walletFelt(input.token),
      amount: hex(total),
      recipient: ESCROW_ADDRESS,
    },
    {
      type: 'invoke',
      contract: ESCROW_ADDRESS,
      calldata: [
        OP.DEPOSIT_MANY,
        '0x0',
        '0x0',
        hex(BigInt(Math.max(0, Math.trunc(input.expiry)))),
        walletFelt(input.token),
        hex(total),
        '0x0',
        '0x0',
        ...legs,
      ],
    },
  ]
}

/**
 * Claim (or refund) a link: open a note for the value, then invoke with the
 * secret. The wallet resolves `${openNoteIds[0]}` to the freshly opened note.
 */
/**
 * Build a claim or a refund against the escrow that actually holds the entry.
 *
 * `escrowAddress` is not optional decoration. Escrows are superseded but never
 * emptied, so a link minted last week can be sitting in an older one while the
 * app has moved on — and an exit built against the current address finds no
 * entry and reverts with nothing to explain itself. Callers resolve the holder
 * with `findEscrowHolding` and pass it in. Every deployed version shares this
 * nine-felt `privacy_invoke` shape, so only the address differs.
 */
function buildEscrowExit(
  operation: (typeof OP)['CLAIM' | 'REFUND'],
  input: { token: string; recipient: string; secret: string; escrowAddress?: string },
): STRK20_ACTION[] {
  if (!escrowEnabled()) throw new Error('Claim links are not enabled on this deployment yet.')
  return [
    {
      type: 'transfer',
      token: walletFelt(input.token),
      amount: 'OPEN',
      recipient: walletFelt(input.recipient),
    },
    {
      type: 'invoke',
      contract: input.escrowAddress ?? ESCROW_ADDRESS,
      calldata: [
        operation,
        '0x0',
        '0x0',
        '0x0',
        '0x0',
        '0x0',
        input.secret,
        openNoteRef(0),
        // Empty batch payload.
        '0x0',
      ],
    },
  ]
}

export function buildEscrowClaim(input: {
  token: string
  recipient: string
  secret: string
  escrowAddress?: string
}): STRK20_ACTION[] {
  return buildEscrowExit(OP.CLAIM, input)
}

export function buildEscrowRefund(input: {
  token: string
  recipient: string
  secret: string
  escrowAddress?: string
}): STRK20_ACTION[] {
  return buildEscrowExit(OP.REFUND, input)
}

/* ------------------------------------------------------------------ */
/* the link itself                                                     */
/* ------------------------------------------------------------------ */

export interface ClaimLinkPayload {
  v: 1
  /** Claim secret, 0x-hex. */
  s: string
  /** Token address. */
  t: string
  /** Raw amount, decimal string. */
  a: string
  /** Optional display name of the sender ("From Shariq"). */
  f?: string
  /** Optional note. */
  n?: string
}

/** Legacy JSON links only — new links use the compact codec. */
function fromBase64url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(escape(atob(padded)))
}

/**
 * The shareable URL. Everything lives in the fragment: fragments are never
 * sent in HTTP requests, so no server — including ours — ever sees a secret.
 */
export function encodeClaimLink(origin: string, payload: ClaimLinkPayload): string {
  const token = TOKEN_LIST.find((t) => sameAddress(t.address, payload.t))
  if (!token) throw new Error('Unknown token for claim link.')
  const compact = encodeClaim({
    secret: payload.s,
    token: token.symbol,
    amount: BigInt(payload.a),
    ...(payload.f ? { from: payload.f } : {}),
    ...(payload.n ? { note: payload.n } : {}),
  })
  return `${origin}/claim#${compact}`
}

export function decodeClaimLink(fragment: string): ClaimLinkPayload | null {
  // Compact form first; links minted before the codec still decode below.
  const compact = decodeClaim(fragment)
  if (compact) {
    return {
      v: 1,
      s: compact.secret,
      t: TOKENS[compact.token].address,
      a: compact.amount.toString(),
      ...(compact.from ? { f: compact.from } : {}),
      ...(compact.note ? { n: compact.note } : {}),
    }
  }
  try {
    const raw: unknown = JSON.parse(fromBase64url(fragment.replace(/^#/, '')))
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    if (r.v !== 1) return null
    if (typeof r.s !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.s)) return null
    if (typeof r.t !== 'string') return null
    if (typeof r.a !== 'string') return null
    BigInt(r.s)
    BigInt(r.t)
    BigInt(r.a)
    return {
      v: 1,
      s: r.s,
      t: r.t,
      a: r.a,
      ...(typeof r.f === 'string' && r.f ? { f: r.f.slice(0, 40) } : {}),
      ...(typeof r.n === 'string' && r.n ? { n: r.n.slice(0, 80) } : {}),
    }
  } catch {
    return null
  }
}

export function tokenForClaim(payload: ClaimLinkPayload): TokenConfig | undefined {
  return TOKEN_LIST.find((token) => sameAddress(token.address, payload.t))
}

/* ------------------------------------------------------------------ */
/* on-chain status                                                     */
/* ------------------------------------------------------------------ */

/**
 * The public door: collect a claim straight to an address.
 *
 * This is an ordinary Starknet call, not a pool action — no shielded balance,
 * no registration, no pool fee. Returned as a plain call so the caller decides
 * how it is submitted: by the recipient's own wallet, or by a relayer or
 * paymaster on behalf of someone who has no gas at all.
 *
 * Honest about the trade, everywhere it is offered: the recipient's address
 * and the amount become public, and the secret travels in calldata rather than
 * inside a proof. The sender stays hidden either way — the escrow was funded
 * by a pool withdrawal that names nobody.
 */
export function buildPublicClaim(input: {
  escrowAddress: string
  secret: string
  recipient: string
}): { contractAddress: string; entrypoint: string; calldata: string[] } {
  if (!input.recipient || BigInt(input.recipient) === 0n) {
    throw new Error('A public claim needs an address to pay.')
  }
  return {
    contractAddress: walletFelt(input.escrowAddress),
    entrypoint: 'claim_to_address',
    calldata: [walletFelt(input.secret), walletFelt(input.recipient)],
  }
}

export interface EscrowEntryState {
  exists: boolean
  claimed: boolean
  token: string
  amount: bigint
  expiry: number
}

/**
 * Read a link's live status straight from the contract — the claim page uses
 * this to distinguish "waiting for you" from "already claimed".
 */
export async function readEscrowEntryAt(
  escrowAddress: string,
  commitment: string,
  rpcUrl: string = RPC_URL,
): Promise<EscrowEntryState | null> {
  try {
    const provider = rpcUrl === RPC_URL ? rpc() : new RpcProvider({ nodeUrl: rpcUrl })
    const result = await provider.callContract({
      contractAddress: escrowAddress,
      entrypoint: 'get_entry',
      calldata: [commitment],
    })
    // EscrowEntry { token, amount: u128, refund_commitment, expiry: u64, claimed: bool }
    if (!Array.isArray(result) || result.length < 5) return null
    const token = result[0]
    const amount = BigInt(result[1])
    const expiry = Number(BigInt(result[3]))
    const claimed = BigInt(result[4]) === 1n
    return { exists: BigInt(token) !== 0n, claimed, token, amount, expiry }
  } catch {
    return null
  }
}

export async function readEscrowEntry(
  claimSecret: string,
  rpcUrl: string = RPC_URL,
): Promise<EscrowEntryState | null> {
  if (!escrowEnabled()) return null
  return readEscrowEntryAt(ESCROW_ADDRESS, claimCommitment(claimSecret), rpcUrl)
}

/** Default refund window: the sender can reclaim after seven days. */
export const DEFAULT_REFUND_WINDOW_S = 7 * 24 * 60 * 60

/**
 * Selectable reclaim windows.
 *
 * Short windows are safe by design: a claim stays valid after expiry right up
 * until the sender actually reclaims, so an early window only grants the
 * sender the *option* to take it back — it never strands a late recipient.
 * That is what makes the ten-minute option usable for a live demo.
 */
export const REFUND_WINDOWS: ReadonlyArray<{
  label: string
  seconds: number
  hint?: string
}> = [
  { label: '10 min', seconds: 600, hint: 'for testing a reclaim' },
  { label: '1 day', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: DEFAULT_REFUND_WINDOW_S },
  { label: '30 days', seconds: 30 * 24 * 60 * 60 },
]

/** Floor the contract and the store agree on. */
export const MIN_REFUND_WINDOW_S = 300
