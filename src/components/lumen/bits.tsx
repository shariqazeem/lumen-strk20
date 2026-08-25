'use client'

/**
 * Shared small pieces of the Lumen surface: money display, the amount field,
 * the guard panel, avatars, section labels, and the post-submit banner.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { GuardReport } from '@/lib/lumen/guard'
import { formatUnits, parseUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS, type TokenSymbol } from '@/lib/strk20/config'
import { Check, ChevronDown, ShieldCheck, Sparkle, Warning } from './icons'

/* ------------------------------------------------------------------ */
/* money                                                               */
/* ------------------------------------------------------------------ */

export function usdText(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  })
}

/** Big display money: dollars large, cents small, always tabular. */
export function MoneyDisplay({ value, className = '' }: { value: number; className?: string }) {
  const [whole, cents] = value.toFixed(2).split('.')
  const grouped = Number(whole).toLocaleString('en-US')
  return (
    <span className={`tabular ${className}`}>
      <span>${grouped}</span>
      <span className="align-top text-[0.52em] font-semibold opacity-60">.{cents}</span>
    </span>
  )
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between px-1">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h3>
      {action}
    </div>
  )
}

export function Avatar({
  emoji,
  size = 44,
  className = '',
}: {
  emoji: string
  size?: number
  className?: string
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.44 }}
      className={`grid flex-none place-items-center rounded-full bg-sunk ${className}`}
      aria-hidden
    >
      {emoji}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* amount input                                                        */
/* ------------------------------------------------------------------ */

interface AmountFieldProps {
  value: string
  onChange: (next: string) => void
  token: TokenSymbol
  onToken: (token: TokenSymbol) => void
  tokens: TokenSymbol[]
  prices: Partial<Record<TokenSymbol, number>>
  /** Raw max the flow allows for the active token, when known. */
  maxRaw?: bigint
  autoFocus?: boolean
}

/** Keep only digits and one dot; trim to the token's decimals. */
function cleanAmount(raw: string, decimals: number): string {
  let text = raw.replace(/[^\d.]/g, '')
  const firstDot = text.indexOf('.')
  if (firstDot !== -1) {
    text = text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, '')
    const [whole, fraction = ''] = text.split('.')
    text = `${whole}.${fraction.slice(0, decimals)}`
  }
  if (text.length > 1 && text[0] === '0' && text[1] !== '.') text = text.replace(/^0+/, '') || '0'
  return text
}

export function AmountField({
  value,
  onChange,
  token,
  onToken,
  tokens,
  prices,
  maxRaw,
  autoFocus,
}: AmountFieldProps) {
  const decimals = TOKENS[token].decimals
  const price = prices[token]

  const usd = useMemo(() => {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed) || parsed <= 0 || price === undefined) return null
    return parsed * price
  }, [value, price])

  const fontSize = value.length > 12 ? 34 : value.length > 8 ? 44 : 56

  return (
    <div>
      <div className="flex items-baseline justify-center gap-1 py-6">
        <input
          value={value}
          onChange={(event) => onChange(cleanAmount(event.target.value, decimals))}
          inputMode="decimal"
          autoFocus={autoFocus}
          placeholder="0"
          aria-label="Amount"
          size={Math.max(1, value.length || 1)}
          style={{ fontSize }}
          className="tabular max-w-full bg-transparent text-center font-semibold tracking-[-0.03em] outline-none placeholder:text-ink-faint"
        />
        <span className="text-[17px] font-medium text-ink-muted">{token}</span>
      </div>

      <div className="mb-5 flex h-5 items-center justify-center text-[14px] text-ink-muted">
        {usd !== null ? <span className="tabular">≈ {usdText(usd)}</span> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5 overflow-x-auto">
          {tokens.map((symbol) => (
            <button
              key={symbol}
              onClick={() => onToken(symbol)}
              className={`h-9 flex-none rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                symbol === token ? 'bg-ink text-white' : 'bg-sunk text-ink-soft hover:bg-rule'
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>
        {maxRaw !== undefined ? (
          <button
            onClick={() => onChange(formatUnits(maxRaw, decimals, 6).replace(/,/g, ''))}
            className="flex-none text-[13px] font-semibold text-ink-muted underline-offset-2 hover:underline"
          >
            Max {formatUnits(maxRaw, decimals, 4)}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function parseAmount(value: string, token: TokenSymbol): bigint {
  return parseUnits(value, TOKENS[token].decimals)
}

/* ------------------------------------------------------------------ */
/* the guard panel                                                     */
/* ------------------------------------------------------------------ */

const GUARD_TONE: Record<
  GuardReport['level'],
  { label: string; pill: string; icon: ReactNode }
> = {
  protected: {
    label: 'Private — nothing links',
    pill: 'bg-good-soft text-good',
    icon: <ShieldCheck size={15} />,
  },
  tuned: {
    label: 'Tuned for privacy',
    pill: 'bg-good-soft text-good',
    icon: <Sparkle size={15} />,
  },
  attention: {
    label: 'Worth a look',
    pill: 'bg-warn-soft text-warn',
    icon: <Warning size={15} />,
  },
}

/**
 * The silent engine's one visible affordance: a quiet pill. Expanding it shows
 * the individual checks in plain sentences. It never blocks; it explains.
 */
export function GuardPanel({ report }: { report: GuardReport }) {
  const [open, setOpen] = useState(report.level === 'attention')
  const tone = GUARD_TONE[report.level]

  return (
    <div className="rounded-2xl border border-rule bg-card-soft">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3"
        aria-expanded={open}
      >
        <span
          className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-3 text-[13px] font-semibold ${tone.pill}`}
        >
          {tone.icon}
          {tone.label}
        </span>
        <ChevronDown
          size={16}
          className={`text-ink-faint transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        <ul className="space-y-2.5 border-t border-rule px-4 pb-4 pt-3">
          {report.checks.map((check) => (
            <li key={check.id} className="flex gap-2.5">
              <span
                className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full ${
                  check.status === 'warn'
                    ? 'bg-warn-soft text-warn'
                    : 'bg-good-soft text-good'
                }`}
              >
                {check.status === 'warn' ? (
                  <Warning size={11} strokeWidth={2.2} />
                ) : check.status === 'fixed' ? (
                  <Sparkle size={11} strokeWidth={2.2} />
                ) : (
                  <Check size={11} strokeWidth={2.6} />
                )}
              </span>
              <div>
                <p className="text-[13.5px] font-semibold leading-tight">{check.label}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* post-submit                                                         */
/* ------------------------------------------------------------------ */

export function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[12.5px] text-ink-muted underline decoration-rule-strong underline-offset-2 hover:text-ink"
    >
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </a>
  )
}

export function SuccessMark() {
  return (
    <div className="pop mx-auto grid size-16 place-items-center rounded-full bg-good-soft text-good">
      <Check size={30} strokeWidth={2.4} />
    </div>
  )
}

export function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="rise flex items-start gap-2.5 rounded-2xl bg-warn-soft px-4 py-3 text-warn">
      <Warning size={16} className="mt-0.5 flex-none" />
      <p className="flex-1 text-[13.5px] leading-snug">{message}</p>
      {onDismiss ? (
        <button onClick={onDismiss} className="text-[13px] font-semibold underline-offset-2 hover:underline">
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
