'use client'

/**
 * What an analyst could infer about you right now.
 *
 * The rest of the app reports what Lumen *did*. This reports what your history
 * *says*, which is a different and less comfortable question — and the one that
 * decides whether any of it worked. It runs the same seven heuristics a real
 * observer would, over your actual ledger, against the pool's actual depth.
 *
 * It is allowed to return a bad answer about you. A footprint panel that only
 * ever reassures is decoration, and the moment it flatters once it is worth
 * nothing on every other screen.
 */

import { useMemo } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { usePoolPulse } from '@/lib/observatory/use-pulse'
import { footprintHeadline, standingFootprint } from '@/lib/observatory/adversary'
import type { Severity } from '@/lib/deanon/types'
import { Eye, ShieldCheck } from './icons'

const TONE: Record<Severity, string> = {
  critical: 'bg-ink text-white',
  high: 'bg-ink text-white',
  medium: 'bg-sunk text-ink',
  low: 'bg-card-soft text-ink-muted',
}

export function FootprintPanel() {
  const ledger = useLumen((state) => state.ledger)
  const pulse = usePoolPulse()

  const footprint = useMemo(
    () => standingFootprint({ ledger, pulse, now: Date.now() }),
    [ledger, pulse],
  )

  if (!footprint) return null

  const { result, poolIsLive, publicLegs } = footprint
  const worst = result.findings[0]
  const clean = result.findings.length === 0

  return (
    <section className="card mt-4 px-5 py-4">
      <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        <Eye size={14} />
        What an analyst could infer
      </p>

      <p className="mt-3 text-[15px] font-semibold leading-snug">
        {footprintHeadline(footprint)}
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{result.summary}</p>

      {worst ? (
        <div className="mt-4 rounded-[14px] border border-rule bg-card-soft px-4 py-3">
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold">{worst.title}</span>
            <span
              className={`flex-none rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE[worst.severity]}`}
            >
              {worst.severity}
            </span>
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">{worst.explanation}</p>
          {worst.evidence.length > 0 ? (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
              {worst.evidence.join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}

      {clean ? (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted">
          <span className="mt-px flex-none">
            <ShieldCheck size={14} />
          </span>
          <span>
            Nothing in your history lines up — no matching amounts, no rhythm, no exit that
            echoes an entry.
          </span>
        </p>
      ) : null}

      <p className="mt-3 px-0.5 text-[11.5px] leading-relaxed text-ink-faint">
        Read from {publicLegs} public {publicLegs === 1 ? 'moment' : 'moments'} in your history
        {poolIsLive
          ? ', against the pool’s measured depth right now.'
          : '. The pool could not be read, so crowd size is not part of this verdict.'}
      </p>
    </section>
  )
}
