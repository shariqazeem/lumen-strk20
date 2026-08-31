'use client'

/**
 * What Lumen did — the decision log in full.
 *
 * Every row is something the engine decided before a wallet was ever asked to
 * sign. No scores, no charts: one sentence per decision, and the warnings it
 * raised underneath. This is the only surface in the product that requires
 * history, which is exactly why a single-payment tool cannot show it.
 */

import { useMemo } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { summarize, type JournalAction, type JournalEntry } from '@/lib/lumen/journal'
import { Sheet } from './sheet'
import { FootprintPanel } from './footprint'
import { Check, Sparkle, Warning } from './icons'

const ACTION_LABEL: Record<JournalAction, string> = {
  pay: 'Payment',
  add: 'Added money',
  link: 'Claim link',
  out: 'Cash out',
  claim: 'Claim',
}

function when(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Row({ entry }: { entry: JournalEntry }) {
  const tone =
    entry.level === 'attention'
      ? { icon: <Warning size={12} strokeWidth={2.2} />, className: 'bg-ink text-white' }
      : entry.rewritten
        ? { icon: <Sparkle size={12} strokeWidth={2.2} />, className: 'bg-sunk text-ink' }
        : { icon: <Check size={12} strokeWidth={2.6} />, className: 'bg-sunk text-ink' }

  return (
    <div className="flex gap-3 px-5 py-4">
      <span
        className={`mt-0.5 grid size-6 flex-none place-items-center rounded-full ${tone.className}`}
      >
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] font-semibold">{entry.headline}</span>
          <span className="flex-none text-[11.5px] text-ink-faint">{when(entry.timestamp)}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-ink-muted">{ACTION_LABEL[entry.action]}</p>

        {entry.rewritten ? (
          <p className="tabular mt-2 inline-flex items-center gap-2 rounded-full bg-card-soft px-3 py-1 text-[12px]">
            <span className="text-ink-faint line-through">{entry.rewritten.from}</span>
            <span className="font-semibold">{entry.rewritten.to}</span>
            <span className="text-ink-muted">{entry.rewritten.token}</span>
          </p>
        ) : null}

        {entry.warnings.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {entry.warnings.map((warning) => (
              <li key={warning} className="text-[12.5px] leading-snug text-ink-muted">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export function JournalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const journal = useLumen((state) => state.journal)
  const digest = useMemo(() => summarize(journal, Date.now()), [journal])

  return (
    <Sheet open={open} onClose={onClose} title="What Lumen did">
      {journal.length === 0 ? (
        <div className="card px-5 py-6 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-sunk text-ink">
            <Sparkle size={19} />
          </span>
          <p className="mt-3 text-[15px] font-semibold">Nothing to report yet</p>
          <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-ink-muted">
            Every time you move money, the engine checks it against your history first — and
            records what it decided here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 rounded-2xl bg-card-soft px-5 py-4">
            {[
              { n: digest.actions, label: 'moves made privately' },
              { n: digest.rewritten, label: 'amounts rewritten' },
              { n: digest.flagged, label: 'flagged for you' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="tabular text-[24px] font-semibold leading-none">{stat.n}</p>
                <p className="mt-1 text-[11.5px] leading-tight text-ink-muted">{stat.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 px-1 text-[12px] text-ink-faint">Last 30 days</p>

          <FootprintPanel />

          <div className="card mt-4 divide-y divide-rule">
            {journal.slice(0, 60).map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>

          <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-faint">
            Kept on this device only. It records what the engine decided — never the amounts it
            checked against, and never who you paid.
          </p>
        </>
      )}
    </Sheet>
  )
}
