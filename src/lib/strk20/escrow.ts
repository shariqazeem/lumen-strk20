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
import type { STRK20_ACTION } from '@starknet-io/types-js'
import { RPC_URL, sameAddress, TOKEN_LIST, type TokenConfig } from './config'
import { openNoteRef } from './actions'

/** Deployed LumenEscrow instance; empty until the mainnet deploy lands. */
export const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS ?? ''

export function escrowEnabled(): boolean {
  return ESCROW_ADDRESS.length > 0
}

/** Must match `CLAIM_TAG` / `REFUND_TAG` in `contracts/src/escrow.cairo`. */
const CLAIM_TAG = shortString.encodeShortString('LUMEN_ESCROW_CLAIM:V1')
const REFUND_TAG = shortString.encodeShortString('LUMEN_ESCROW_REFUND:V1')

/** Cairo enum discriminants for `EscrowOperation`. */
const OP = { DEPOSIT: '0x0', CLAIM: '0x1', REFUND: '0x2' } as const

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
      token: input.token,
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
        input.token,
        hex(input.amount),
        '0x0',
        '0x0',
      ],
    },
  ]
}

/**
 * Claim (or refund) a link: open a note for the value, then invoke with the
 * secret. The wallet resolves `${openNoteIds[0]}` to the freshly opened note.
 */
function buildEscrowExit(
  operation: (typeof OP)['CLAIM' | 'REFUND'],
  input: { token: string; recipient: string; secret: string },
): STRK20_ACTION[] {
  if (!escrowEnabled()) throw new Error('Claim links are not enabled on this deployment yet.')
  return [
    { type: 'transfer', token: input.token, amount: 'OPEN', recipient: input.recipient },
    {
      type: 'invoke',
      contract: ESCROW_ADDRESS,
      calldata: [operation, '0x0', '0x0', '0x0', '0x0', '0x0', input.secret, openNoteRef(0)],
    },
  ]
}

export function buildEscrowClaim(input: {
  token: string
  recipient: string
  secret: string
}): STRK20_ACTION[] {
  return buildEscrowExit(OP.CLAIM, input)
}

export function buildEscrowRefund(input: {
  token: string
  recipient: string
  secret: string
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

function base64url(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(escape(atob(padded)))
}

/**
 * The shareable URL. Everything lives in the fragment: fragments are never
 * sent in HTTP requests, so no server — including ours — ever sees a secret.
 */
export function encodeClaimLink(origin: string, payload: ClaimLinkPayload): string {
  return `${origin}/claim#${base64url(JSON.stringify(payload))}`
}

export function decodeClaimLink(fragment: string): ClaimLinkPayload | null {
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
export async function readEscrowEntry(
  claimSecret: string,
  rpcUrl: string = RPC_URL,
): Promise<EscrowEntryState | null> {
  if (!escrowEnabled()) return null
  try {
    const provider = new RpcProvider({ nodeUrl: rpcUrl })
    const result = await provider.callContract({
      contractAddress: ESCROW_ADDRESS,
      entrypoint: 'get_entry',
      calldata: [claimCommitment(claimSecret)],
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
