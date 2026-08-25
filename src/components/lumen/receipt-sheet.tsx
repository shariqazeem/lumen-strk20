'use client'

/**
 * The private receipt — selective disclosure as a beautiful object.
 *
 * Carries exactly one fact: this amount, this moment, this settlement
 * transaction. The settlement is publicly verifiable yet names no sender,
 * recipient or amount — the receipt itself is the disclosure, and sharing it
 * is always the payer's explicit act.
 */

import { useState } from 'react'
import { formatReceiptText, type Receipt } from '@/lib/lumen/receipts'
import { formatUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS } from '@/lib/strk20/config'
import { shortAddress } from '@/lib/lumen/people'
import { Sheet } from './sheet'
import { Check, Copy, LumenMark, Share } from './icons'

export function ReceiptSheet({
  open,
  onClose,
  receipt,
}: {
  open: boolean
  onClose: () => void
  receipt: Receipt | null
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!receipt) return
    try {
      await navigator.clipboard.writeText(formatReceiptText(receipt))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard denied; nothing else to do.
    }
  }

  const share = async () => {
    if (!receipt) return
    const text = formatReceiptText(receipt)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text })
        return
      } catch {
        // Cancelled or unsupported payload — fall through to copy.
      }
    }
    await copy()
  }

  if (!receipt) return null

  const amount = formatUnits(BigInt(receipt.amountRaw), TOKENS[receipt.token].decimals, 6)
  const when = new Date(receipt.timestamp)

  return (
    <Sheet open={open} onClose={onClose} title="Receipt">
      <div className="card overflow-hidden">
        <div className="h-1.5 bg-ink" />
        <div className="px-6 py-6">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted">
              <LumenMark size={15} />
              Private payment
            </span>
            <span className="text-[12px] text-ink-faint">
              {when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>

          <p className="tabular mt-6 text-center text-[40px] font-semibold tracking-[-0.03em]">
            {amount} <span className="text-[20px] font-medium text-ink-muted">{receipt.token}</span>
          </p>

          <dl className="mt-7 space-y-3 border-t border-dashed border-rule-strong pt-5 text-[13.5px]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">To</dt>
              <dd className="text-right font-semibold">
                {receipt.toName ?? shortAddress(receipt.toAddress)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">When</dt>
              <dd className="font-semibold">
                {when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </dd>
            </div>
            {receipt.note ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Note</dt>
                <dd className="text-right font-semibold">{receipt.note}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Settlement</dt>
              <dd>
                <a
                  href={explorerTx(receipt.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] underline decoration-rule-strong underline-offset-2 hover:text-ink"
                >
                  {receipt.txHash.slice(0, 8)}…{receipt.txHash.slice(-6)}
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="mt-4 px-2 text-center text-[12px] leading-relaxed text-ink-faint">
        Sharing this discloses only this payment — the settlement transaction reveals no sender,
        recipient or amount. Your balance and history stay yours.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button onClick={copy} className="btn btn-quiet">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={share} className="btn btn-ink">
          <Share size={16} />
          Share
        </button>
      </div>
    </Sheet>
  )
}
