'use client'

/**
 * What the pool looks like for the asset you are about to move.
 *
 * Deliberately an opinion beside the action, never a dialog in front of it.
 * Lumen's posture is that nobody opened a privacy app — they are moving money —
 * so this informs and never blocks. The button next to it stays enabled even
 * when the reading is bad.
 */

import type { TokenSymbol } from '@/lib/strk20/config'
import { usePoolPulse } from '@/lib/observatory/use-pulse'
import { adviceFor, readCrowd } from '@/lib/observatory/posture'
import { Globe } from './icons'

export function CrowdNote({ token }: { token: TokenSymbol }) {
  const pulse = usePoolPulse()
  // No reading is not a neutral reading. Say nothing.
  if (!pulse) return null

  const reading = readCrowd(pulse, token)
  const strong = reading.stance === 'exposed'

  return (
    <div
      className={`mt-3 rounded-[14px] border px-4 py-3 ${
        strong ? 'border-rule-strong bg-sunk' : 'border-rule bg-card-soft'
      }`}
    >
      <span className="flex items-start gap-2.5">
        <span className="mt-px flex-none text-ink-muted">
          <Globe size={14} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold leading-snug">
            {reading.headline}
          </span>
          <span className="mt-1 block text-[12px] leading-relaxed text-ink-muted">
            {adviceFor(reading, token)}
          </span>
          <span className="mt-1.5 block text-[11.5px] leading-relaxed text-ink-faint">
            {reading.because}
          </span>
        </span>
      </span>
    </div>
  )
}

/**
 * The pool's standing state, in one line.
 *
 * For the home surface, where a card would be one card too many. It names the
 * deepest asset and the thinnest of the ones the user actually holds, because
 * those are the only two that change a decision.
 */
export function CrowdLine({ holdings }: { holdings: readonly TokenSymbol[] }) {
  const pulse = usePoolPulse()
  if (!pulse || holdings.length === 0) return null

  const readings = holdings.map((token) => ({ token, reading: readCrowd(pulse, token) }))
  const exposed = readings.filter((r) => r.reading.stance === 'exposed')
  const deepest = readings.reduce((a, b) => (b.reading.peers > a.reading.peers ? b : a))

  // Nothing worth saying when everything you hold is well covered — silence is
  // the correct output, not a green tick.
  if (exposed.length === 0) return null

  const thin = exposed.map((r) => r.token).join(' and ')
  const busy = deepest.reading.stance === 'crowded' ? deepest.token : null

  return (
    <p className="mt-3 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-ink-muted">
      <span className="mt-px flex-none">
        <Globe size={13} />
      </span>
      <span>
        <span className="font-semibold text-ink-soft">In the pool right now:</span>{' '}
        {thin} {exposed.length === 1 ? 'has' : 'have'} almost no company
        {busy ? `, ${busy} has plenty` : ''}. Moving{' '}
        {exposed.length === 1 ? 'it' : 'them'} today is more distinctive than usual.
      </span>
    </p>
  )
}
