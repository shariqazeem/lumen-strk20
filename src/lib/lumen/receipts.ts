'use client'

/**
 * Private receipts — selective proof of payment.
 *
 * A private transfer publishes nothing, which is the point — and the problem,
 * the moment you need to show a landlord or an accountant that you paid. The
 * receipt is Lumen's answer: a document the *payer* chooses to hand over,
 * carrying exactly one fact (this amount, at this time, settled in this
 * transaction) and nothing else. The settlement transaction is public and
 * verifiable on any explorer, yet names no sender, no recipient and no
 * amount — the receipt itself is the disclosure, scoped to one relationship.
 *
 * Receipts live only on this device. Sharing one is always an explicit act.
 */

import { formatUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS, type TokenSymbol } from '@/lib/strk20/config'

export interface Receipt {
  id: string
  txHash: string
  token: TokenSymbol
  /** Raw amount, bigint as decimal string (JSON has no bigint). */
  amountRaw: string
  toName?: string
  toAddress: string
  note?: string
  /** ms epoch */
  timestamp: number
}

const KEY_PREFIX = 'lumen:receipts:v1:'
const RECEIPT_CAP = 200

function receiptsKey(account: string): string {
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

function revive(raw: unknown): Receipt | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.txHash !== 'string') return null
  if (typeof r.token !== 'string' || !(r.token in TOKENS)) return null
  if (typeof r.amountRaw !== 'string') return null
  if (typeof r.toAddress !== 'string') return null
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) return null
  try {
    BigInt(r.amountRaw)
  } catch {
    return null
  }
  return {
    id: r.id,
    txHash: r.txHash,
    token: r.token as TokenSymbol,
    amountRaw: r.amountRaw,
    toAddress: r.toAddress,
    timestamp: r.timestamp,
    ...(typeof r.toName === 'string' ? { toName: r.toName } : {}),
    ...(typeof r.note === 'string' ? { note: r.note } : {}),
  }
}

export function loadReceipts(account: string): Receipt[] {
  const store = storage()
  if (!store) return []
  try {
    const text = store.getItem(receiptsKey(account))
    if (!text) return []
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map(revive).filter((r): r is Receipt => r !== null)
  } catch {
    return []
  }
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `receipt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function addReceipt(account: string, input: Omit<Receipt, 'id'>): Receipt {
  const receipt: Receipt = { ...input, id: newId() }
  const next = [receipt, ...loadReceipts(account)].slice(0, RECEIPT_CAP)
  const store = storage()
  if (store) {
    try {
      store.setItem(receiptsKey(account), JSON.stringify(next))
    } catch {
      // The returned receipt is still valid for this session.
    }
  }
  return receipt
}

/**
 * The shareable form. Contains exactly what the payer is choosing to
 * disclose: amount, time, settlement transaction. Nothing about balances,
 * other relationships, or any other activity.
 */
export function formatReceiptText(receipt: Receipt): string {
  const amount = formatUnits(BigInt(receipt.amountRaw), TOKENS[receipt.token].decimals)
  const when = new Date(receipt.timestamp).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const who = receipt.toName ? ` to ${receipt.toName}` : ''
  return [
    `Payment receipt — ${amount} ${receipt.token}${who}`,
    `Settled privately on Starknet · ${when}`,
    receipt.note ? `Note: ${receipt.note}` : null,
    `Settlement: ${explorerTx(receipt.txHash)}`,
    `This receipt discloses only this payment. The transaction on-chain reveals no sender, recipient or amount.`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}
