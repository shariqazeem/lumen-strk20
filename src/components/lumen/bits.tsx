'use client'

/**
 * Shared small pieces of the Lumen surface: money display, the amount field,
 * the guard panel, avatars, section labels, and the post-submit banner.
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { GuardReport } from '@/lib/lumen/guard'
import { initials } from '@/lib/lumen/people'
import { formatUnits, parseUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS, type TokenSymbol } from '@/lib/strk20/config'
import { Check, ChevronDown, Globe, ShieldCheck, Sparkle, Warning } from './icons'

/* ------------------------------------------------------------------ */
/* money                                                               */
/* ------------------------------------------------------------------ */

export function usdText(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    // Whole amounts read as buttons; ".00" reads as a total.
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
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

/**
 * A monogram, derived from the name.
 *
 * This was an emoji, chosen from a picker. Nobody wants to pick an emoji to
 * receive money, and the result made a payments product read like a chat app.
 * Initials cost the user no decision at all, stay inside the monochrome
 * palette, and read as a person rather than as decoration.
 */
export function Avatar({
  name,
  size = 44,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={`grid flex-none select-none place-items-center rounded-full bg-sunk font-semibold uppercase leading-none tracking-[0.02em] text-ink-soft ${className}`}
      aria-hidden
    >
      {initials(name)}
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

      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
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

// Monochrome severity: calm states sit on grey, attention inverts to black.
const GUARD_TONE: Record<
  GuardReport['level'],
  { label: string; pill: string; icon: ReactNode }
> = {
  protected: {
    label: 'Private — nothing links',
    pill: 'bg-sunk text-ink',
    icon: <ShieldCheck size={15} />,
  },
  tuned: {
    label: 'Tuned for privacy',
    pill: 'bg-sunk text-ink',
    icon: <Sparkle size={15} />,
  },
  attention: {
    label: 'Worth a look',
    pill: 'bg-ink text-white',
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
                  check.status === 'warn' ? 'bg-ink text-white' : 'bg-sunk text-ink'
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
  // An operation the chain confirmed while the wallet stayed silent has no
  // hash of ours to link to. It still happened; there is just nothing to open.
  if (!hash) {
    return (
      <span className="text-[12.5px] text-ink-muted">
        Confirmed on-chain — your wallet never returned a transaction hash.
      </span>
    )
  }
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
    <div className="pop mx-auto grid size-16 place-items-center rounded-full bg-ink text-white">
      <Check size={30} strokeWidth={2.4} />
    </div>
  )
}

/**
 * The trust moment: immediately after an action, show what was actually
 * published. Per action, honestly — a private transfer publishes nothing,
 * while a deposit publishes an amount and cannot pretend otherwise.
 */
export function WorldSaw({
  kind,
  amount,
}: {
  kind: 'private' | 'deposit' | 'claim' | 'withdraw'
  amount?: string
}) {
  const copy = {
    private: {
      headline: 'One private operation',
      detail: 'No sender, no recipient, no amount. Nothing that points at you.',
    },
    deposit: {
      headline: amount ? `A deposit of ${amount}` : 'A deposit',
      detail:
        'The amount and the depositor are public — that is the boundary. Nothing you do next is.',
    },
    claim: {
      headline: amount ? `A claim of ${amount} from an escrow` : 'A claim from an escrow',
      detail: 'The escrow paid out. Nothing links that payout to you, or to who funded it.',
    },
    withdraw: {
      headline: amount ? `A withdrawal of ${amount}` : 'A withdrawal',
      detail: 'Public by nature — the amount, the destination, the moment.',
    },
  }[kind]

  return (
    <div className="glass mt-6 px-5 py-4 text-left">
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-glass-muted">
        <Globe size={12} />
        What the world just saw
      </p>
      <p className="mt-2 text-[15px] font-semibold text-glass-ink">{copy.headline}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-glass-muted">{copy.detail}</p>
    </div>
  )
}

export function ErrorNote({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="rise flex items-start gap-2.5 rounded-2xl bg-ink px-4 py-3 text-white">
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
