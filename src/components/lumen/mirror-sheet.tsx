'use client'

/**
 * Your own address, read the way a stranger reads it.
 *
 * Deliberately **self-only**: it takes the connected account's address and
 * nothing else. There is no field to paste someone else's. A page that scans
 * any wallet you name would be a doxxing toy wearing this brand — growth by
 * fear, from a product whose whole moat is not lying about what is knowable.
 * Pointed at your own address it is the opposite: consent is the mechanic, and
 * it is the one honest way to show rather than describe why this account
 * exists.
 *
 * The reading itself claims only what it measured. Patterns, the heuristic
 * that found each one, and the numbers underneath — never a job, a place or a
 * reason. See `story.ts`.
 */

import { useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { readPublicHistory } from '@/lib/mirror/read'
import { readAddress, summary, type Sentence } from '@/lib/mirror/story'
import { shortAddress } from '@/lib/lumen/people'
import { Sheet } from './sheet'
import { Globe, ShieldCheck } from './icons'

const DAYS = 7

type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; done: number; total: number; found: number }
  | { kind: 'done'; sentences: Sentence[]; counts: ReturnType<typeof summary>; truncated: boolean }
  | { kind: 'error'; message: string }

export function MirrorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useLumen()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const run = async () => {
    if (!address) return
    setPhase({ kind: 'reading', done: 0, total: 8, found: 0 })
    try {
      const read = await readPublicHistory(address, DAYS, (partial, done, total) =>
        setPhase({ kind: 'reading', done, total, found: partial.length }),
      )
      setPhase({
        kind: 'done',
        sentences: readAddress(read.transfers),
        counts: summary(read.transfers),
        truncated: read.truncated,
      })
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not reach the chain.',
      })
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your public address">
      <p className="text-[14.5px] leading-relaxed text-ink-muted">
        This reads {DAYS} days of your <span className="font-semibold text-ink">public</span>{' '}
        Starknet address — {address ? shortAddress(address) : 'the connected one'} — from an
        ordinary RPC, and reports what a stranger&rsquo;s heuristics would flag. It reads only
        your own address, stores nothing, and sends nothing anywhere.
      </p>

      {phase.kind === 'idle' ? (
        <button onClick={() => void run()} className="btn btn-ink mt-6 w-full">
          <Globe size={17} />
          Read my public address
        </button>
      ) : null}

      {phase.kind === 'reading' ? (
        <div className="mt-6">
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-sunk">
            <div
              className="h-full bg-ink transition-[width] duration-500 ease-out"
              style={{ width: `${(phase.done / phase.total) * 100}%` }}
            />
          </div>
          <p className="mt-3 text-[13px] text-ink-muted">
            {phase.found} transfer{phase.found === 1 ? '' : 's'} so far — asset{' '}
            {Math.min(phase.done + 1, phase.total)} of {phase.total}.
          </p>
        </div>
      ) : null}

      {phase.kind === 'error' ? (
        <p className="mt-6 rounded-2xl border border-rule bg-card-soft px-4 py-3.5 text-[13.5px]">
          {phase.message}
        </p>
      ) : null}

      {phase.kind === 'done' ? (
        <div className="mt-6">
          <p className="text-[12.5px] text-ink-faint">
            {phase.counts.transfers} transfers · {phase.counts.counterparties} counterpart
            {phase.counts.counterparties === 1 ? 'y' : 'ies'} · {phase.counts.received} in ·{' '}
            {phase.counts.sent} out
          </p>

          {phase.sentences.length === 0 ? (
            <div className="mt-4 card px-5 py-5">
              <p className="text-[15px] font-semibold">Nothing to report yet.</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
                {phase.counts.transfers === 0
                  ? `No public transfers of the assets Lumen watches in the last ${DAYS} days. That is quiet, which is not the same as private — the record starts the moment it stops being quiet.`
                  : `${phase.counts.transfers} transfers is too thin to claim a pattern from, and inventing one is the exact dishonesty this exists to expose.`}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {phase.sentences.map((sentence) => (
                <div key={sentence.id} className="card px-5 py-4">
                  <p className="text-[15.5px] font-semibold leading-snug tracking-[-0.012em]">
                    {sentence.text}
                  </p>
                  <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                    {sentence.heuristic}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {sentence.evidence.map((line) => (
                      <li key={line} className="text-[12.5px] text-ink-muted">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 px-1 text-[12px] leading-relaxed text-ink-faint">
            {phase.truncated
              ? 'This address is busy enough that the read stopped early, so the real picture is larger than the above. '
              : ''}
            Times are estimated from block height.
          </p>

          <div className="mt-5 glass px-5 py-5">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-glass-ink">
              <ShieldCheck size={14} />
              None of this leaked
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-glass-muted">
              Everything above was already published, by design, and it stays published. What
              moves through Lumen does not join it.
            </p>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
