'use client'

/**
 * Links you sent — the sender's view of outstanding claim links.
 *
 * Status is cached locally and re-checked against the escrow on demand: the
 * chain is the truth, this device just remembers the secrets. Reclaim opens
 * once the link's refund window passes and it is still unclaimed.
 */

import { useEffect, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { encodeClaimLink } from '@/lib/strk20/escrow'
import type { SentLink } from '@/lib/lumen/links'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { ErrorNote } from './bits'
import { Check, Clock, Copy, LinkIcon } from './icons'

function linkUrl(link: SentLink): string {
  return encodeClaimLink(window.location.origin, {
    v: 1,
    s: link.claimSecret,
    t: TOKENS[link.token].address,
    a: link.amountRaw,
    ...(link.note ? { n: link.note } : {}),
  })
}

/**
 * Time left, in the largest unit that is still true.
 *
 * Rounding everything up to whole days read "1d" on a ten-minute window, which
 * is the one case where the number is about to matter.
 */
function untilReclaimable(seconds: number): string {
  if (seconds >= 86_400) return `${Math.ceil(seconds / 86_400)}d`
  if (seconds >= 3_600) return `${Math.ceil(seconds / 3_600)}h`
  return `${Math.max(1, Math.ceil(seconds / 60))}m`
}

function statusOf(link: SentLink, now: number): { label: string; strong: boolean } {
  if (link.status === 'claimed') return { label: 'Claimed', strong: false }
  if (link.status === 'refunded') return { label: 'Reclaimed', strong: false }
  if (now / 1000 >= link.expiry) return { label: 'Reclaimable', strong: true }
  return { label: `Waiting · ${untilReclaimable(link.expiry - now / 1000)}`, strong: false }
}

export function LinksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { links, refundLink, syncLinks, submitting, error, clearError } = useLumen()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  // Reconcile on open, not on a button nobody knows to press. Every status
  // here is a local cache, and a stale one offers "Take it back" on money
  // somebody already collected — a transaction that can only revert, after a
  // wallet prompt and a fee.
  useEffect(() => {
    if (!open) return
    let live = true
    setSyncing(true)
    void syncLinks().finally(() => {
      if (live) setSyncing(false)
    })
    return () => {
      live = false
    }
  }, [open, syncLinks])

  const copy = async (link: SentLink) => {
    try {
      await navigator.clipboard.writeText(linkUrl(link))
      setCopiedId(link.id)
      setTimeout(() => setCopiedId(null), 1600)
    } catch {
      // Nothing else to do.
    }
  }

  const now = Date.now()

  return (
    <Sheet open={open} onClose={onClose} title="Links you sent" locked={submitting}>
      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} onDismiss={clearError} />
        </div>
      ) : null}

      {links.length === 0 ? (
        <div className="card px-5 py-6 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-sunk text-ink">
            <LinkIcon size={18} />
          </span>
          <p className="mt-3 text-[14.5px] font-semibold">No links yet</p>
          <p className="mx-auto mt-1 max-w-[300px] text-[13px] leading-relaxed text-ink-muted">
            Pay → &ldquo;Pay with a link&rdquo; sends money to someone who is not set up yet. Every link
            you create lives here, with its reclaim key.
          </p>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-rule">
            {links.map((link) => {
              const status = statusOf(link, now)
              const reclaimable = link.status === 'open' && now / 1000 >= link.expiry
              return (
                <div key={link.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="tabular text-[15px] font-semibold">
                      {formatUnits(BigInt(link.amountRaw), TOKENS[link.token].decimals, 4)}{' '}
                      {link.token}
                    </p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                        status.strong ? 'bg-ink text-white' : 'bg-sunk text-ink-soft'
                      }`}
                    >
                      {status.label}
                    </span>
                  </div>
                  {link.note ? (
                    <p className="mt-1 text-[12.5px] text-ink-muted">&ldquo;{link.note}&rdquo;</p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    {link.status === 'open' ? (
                      <button
                        onClick={() => copy(link)}
                        className="btn btn-quiet btn-small flex-1"
                      >
                        {copiedId === link.id ? <Check size={14} /> : <Copy size={14} />}
                        {copiedId === link.id ? 'Copied' : 'Copy link'}
                      </button>
                    ) : null}
                    {reclaimable ? (
                      <button
                        onClick={() => refundLink(link.id)}
                        disabled={submitting}
                        className="btn btn-ink btn-small flex-1"
                      >
                        {submitting ? 'Waiting…' : 'Take it back'}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            onClick={async () => {
              setSyncing(true)
              await syncLinks()
              setSyncing(false)
            }}
            disabled={syncing}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-[13px] font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <Clock size={14} />
            {syncing ? 'Checking the chain…' : 'Check statuses on-chain'}
          </button>
        </>
      )}
    </Sheet>
  )
}
