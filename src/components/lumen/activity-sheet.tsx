'use client'

/**
 * Activity — the full ledger, moved off the home screen.
 *
 * Incoming already answers the question people actually open the app with
 * ("did anything arrive?"), so the complete history belongs one level down.
 * Every row still tells the truth twice: what you did, and what the chain saw.
 */

import { useLumen } from '@/lib/lumen/store'
import { personByAddress, shortAddress } from '@/lib/lumen/people'
import type { LedgerEntry } from '@/lib/history'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { ArrowDown, ArrowUpRight, Globe, LinkIcon, Plus, Sparkle } from './icons'
import type { Receipt } from '@/lib/lumen/receipts'

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ActivitySheet({
  open,
  onClose,
  onReceipt,
}: {
  open: boolean
  onClose: () => void
  onReceipt: (receipt: Receipt) => void
}) {
  const { ledger, people, receipts } = useLumen()

  const openEntry = (entry: LedgerEntry) => {
    if (entry.type !== 'TRANSFER' || !entry.txHash) return
    const receipt = receipts.find((r) => r.txHash === entry.txHash)
    if (receipt) onReceipt(receipt)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Activity">
      {ledger.length === 0 ? (
        <div className="card px-5 py-6 text-center">
          <p className="text-[15px] font-semibold">Nothing here yet</p>
          <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-ink-muted">
            Your history lives only on this device. There is no server holding a copy of it.
          </p>
        </div>
      ) : (
        <>
          <div className="card divide-y divide-rule">
            {ledger.map((entry) => {
              const person = entry.counterparty
                ? personByAddress(people, entry.counterparty)
                : undefined
              const outbound =
                entry.type === 'TRANSFER' || entry.type === 'UNSHIELD' || entry.type === 'LINK'
              const title =
                entry.type === 'TRANSFER'
                  ? `Paid ${person?.name ?? (entry.counterparty ? shortAddress(entry.counterparty) : 'privately')}`
                  : entry.type === 'SHIELD'
                    ? 'Added money'
                    : entry.type === 'UNSHIELD'
                      ? 'Cashed out'
                      : entry.type === 'LINK'
                        ? 'Sent a claim link'
                        : entry.type === 'CLAIM'
                          ? entry.observer.startsWith('reclaim')
                            ? 'Reclaimed a link'
                            : 'Claimed money'
                          : 'Private move'
              const isPublic = entry.observer !== '—'
              const clickable = entry.type === 'TRANSFER' && entry.txHash
              return (
                <button
                  key={entry.id}
                  onClick={() => openEntry(entry)}
                  disabled={!clickable}
                  className={`flex w-full items-center gap-3.5 px-5 py-3.5 text-left ${
                    clickable ? 'transition-colors hover:bg-card-soft' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`grid size-9 flex-none place-items-center rounded-full ${
                      isPublic ? 'bg-ink text-white' : 'bg-sunk text-ink-soft'
                    }`}
                  >
                    {entry.type === 'TRANSFER' ? (
                      <ArrowUpRight size={16} />
                    ) : entry.type === 'SHIELD' ? (
                      <Plus size={16} />
                    ) : entry.type === 'UNSHIELD' ? (
                      <Globe size={16} />
                    ) : entry.type === 'LINK' ? (
                      <LinkIcon size={16} />
                    ) : entry.type === 'CLAIM' ? (
                      <ArrowDown size={16} />
                    ) : (
                      <Sparkle size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{title}</span>
                    <span className="block truncate text-[12.5px] text-ink-muted">
                      {relativeTime(entry.timestamp)} ·{' '}
                      {isPublic ? (
                        <span className="font-semibold text-ink">{entry.observer}</span>
                      ) : (
                        'nothing public'
                      )}
                    </span>
                  </span>
                  <span className="tabular flex-none whitespace-nowrap text-[14.5px] font-semibold">
                    {outbound ? '−' : '+'}
                    {formatUnits(entry.amount, TOKENS[entry.asset].decimals, 4)}{' '}
                    <span className="text-[12px] font-medium text-ink-muted">{entry.asset}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-faint">
            Kept on this device only. The rows marked public are the boundary crossings — every
            other line published nothing at all.
          </p>
        </>
      )}
    </Sheet>
  )
}
