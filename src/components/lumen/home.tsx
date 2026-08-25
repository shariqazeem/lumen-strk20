'use client'

/**
 * Home — "Your money."
 *
 * One dark glass object holds the private balance; everything else is
 * porcelain. Three verbs: Pay, Receive, Add. Spaces and People are one row
 * each. The activity list tells the truth twice — what you did, and what the
 * public chain saw (almost always: nothing).
 */

import { useMemo, useState } from 'react'
import { useLumen, portfolioUsd } from '@/lib/lumen/store'
import { personByAddress, shortAddress } from '@/lib/lumen/people'
import { allocationOf, SPACE_TINTS, type Space } from '@/lib/lumen/spaces'
import type { LedgerEntry } from '@/lib/history'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, type TokenSymbol } from '@/lib/strk20/config'
import {
  ArrowDown,
  ArrowUpRight,
  Dots,
  Eye,
  Globe,
  LumenMark,
  Plus,
  ShieldCheck,
  Sparkle,
} from './icons'
import { Avatar, ErrorNote, MoneyDisplay, SectionLabel, usdText } from './bits'
import type { SheetRoute } from './routes'

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

function spaceUsd(
  space: Space,
  prices: Partial<Record<TokenSymbol, number>>,
): number {
  let total = 0
  for (const symbol of Object.keys(space.allocations) as TokenSymbol[]) {
    const price = prices[symbol]
    if (price === undefined) continue
    const raw = allocationOf(space, symbol)
    total += Number(formatUnits(raw, TOKENS[symbol].decimals, 6).replace(/,/g, '')) * price
  }
  return total
}

export function Home({ open }: { open: (route: SheetRoute) => void }) {
  const {
    balances,
    balancesLoading,
    balancesRevealedAt,
    revealBalances,
    prices,
    ledger,
    people,
    spaces,
    receipts,
    error,
    clearError,
    lastTx,
    preview,
  } = useLumen()

  const [showAllActivity, setShowAllActivity] = useState(false)

  const totalUsd = useMemo(() => portfolioUsd(balances, prices), [balances, prices])
  const nonZero = balances.filter((b) => b.raw > 0n)
  const revealed = balancesRevealedAt !== null

  const visibleLedger = showAllActivity ? ledger : ledger.slice(0, 5)

  const openEntry = (entry: LedgerEntry) => {
    if (entry.type !== 'TRANSFER' || !entry.txHash) return
    const receipt = receipts.find((r) => r.txHash === entry.txHash)
    if (receipt) open({ kind: 'receipt', receipt })
  }

  return (
    <main className="mx-auto w-full max-w-[460px] px-5 pb-16 pt-6">
      {/* header */}
      <header className="rise flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-white">
            <LumenMark size={17} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Lumen</span>
        </div>
        <button
          onClick={() => open({ kind: 'menu' })}
          aria-label="Menu"
          className="grid size-9 place-items-center rounded-full bg-card text-ink-soft shadow-[0_1px_2px_rgba(18,18,20,0.06)] transition-transform active:scale-95"
        >
          <Dots size={18} />
        </button>
      </header>

      {preview ? (
        <p className="mt-4 flex items-center justify-center gap-2 rounded-full border border-rule bg-card px-4 py-2 text-[12.5px] font-medium text-ink-muted">
          <Eye size={13} />
          Sample data — connect a privacy wallet to make it real
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <ErrorNote message={error} onDismiss={clearError} />
        </div>
      ) : null}

      {/* the private balance */}
      <section className="rise rise-1 mt-5">
        <div className="glass px-6 pb-6 pt-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-glass-muted">Your money</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-2 pr-2.5 text-[11.5px] font-semibold text-glass-ink">
              <ShieldCheck size={12} />
              Private
            </span>
          </div>

          {revealed ? (
            <div className="unblur">
              <div className="mt-3">
                {totalUsd !== null ? (
                  <MoneyDisplay
                    value={totalUsd}
                    className="text-[46px] font-semibold leading-none tracking-[-0.03em]"
                  />
                ) : nonZero.length > 0 ? (
                  <p className="text-[34px] font-semibold leading-none tracking-[-0.02em]">
                    {formatUnits(nonZero[0].raw, nonZero[0].decimals, 4)}{' '}
                    <span className="text-[20px] text-glass-muted">{nonZero[0].symbol}</span>
                  </p>
                ) : (
                  <p className="text-[34px] font-semibold leading-none tracking-[-0.02em]">
                    $0<span className="text-glass-muted">.00</span>
                  </p>
                )}
              </div>

              {nonZero.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {nonZero.map((balance) => (
                    <span
                      key={balance.symbol}
                      className="tabular rounded-full bg-white/8 px-2.5 py-1 text-[12px] font-medium text-glass-muted"
                    >
                      {formatUnits(balance.raw, balance.decimals, 4)} {balance.symbol}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[13.5px] text-glass-muted">
                  Nothing here yet — add money to begin.
                </p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <p className="text-[12px] text-glass-faint">Only you can see this.</p>
                <button
                  onClick={() => revealBalances()}
                  disabled={balancesLoading}
                  className="text-[12px] font-semibold text-glass-muted underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {balancesLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => revealBalances()}
              disabled={balancesLoading}
              className="mt-3 block w-full text-left"
            >
              <span className="text-[46px] font-semibold leading-none tracking-[0.1em] text-glass-ink/90">
                ••••••
              </span>
              <span className="mt-4 flex items-center gap-1.5 text-[13.5px] text-glass-muted">
                <Eye size={15} />
                {balancesLoading ? 'Asking your wallet…' : 'Tap to reveal — your wallet will ask first'}
              </span>
            </button>
          )}
        </div>
      </section>

      {/* actions */}
      <section className="rise rise-2 mt-4 grid grid-cols-3 gap-2.5">
        {(
          [
            { label: 'Pay', icon: <ArrowUpRight size={19} />, route: { kind: 'pay' } as const },
            { label: 'Receive', icon: <ArrowDown size={19} />, route: { kind: 'receive' } as const },
            { label: 'Add', icon: <Plus size={19} />, route: { kind: 'add' } as const },
          ] as const
        ).map((action) => (
          <button
            key={action.label}
            onClick={() => open(action.route)}
            className="card card-press flex flex-col items-center gap-2 py-4"
          >
            <span className="grid size-10 place-items-center rounded-full bg-ink text-white">
              {action.icon}
            </span>
            <span className="text-[13.5px] font-semibold">{action.label}</span>
          </button>
        ))}
      </section>

      {lastTx && lastTx.status === 'submitted' ? (
        <p className="mt-3 flex items-center gap-2 px-1 text-[12.5px] text-ink-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-good" />
          Settling on Starknet — usually under a minute.
        </p>
      ) : null}

      {/* spaces */}
      <section className="rise rise-3 mt-8">
        <SectionLabel
          action={
            <button
              onClick={() => open({ kind: 'new-space' })}
              className="text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              New space
            </button>
          }
        >
          Spaces
        </SectionLabel>

        {spaces.length === 0 ? (
          <button
            onClick={() => open({ kind: 'new-space' })}
            className="card card-press flex w-full items-center gap-3.5 px-5 py-4 text-left"
          >
            <span className="grid size-10 flex-none place-items-center rounded-full bg-sunk text-[18px]">
              🌱
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold">Set money aside</span>
              <span className="block text-[13px] leading-snug text-ink-muted">
                Rent, travel, a rainy day — organized privately, visible to no one.
              </span>
            </span>
            <Plus size={16} className="text-ink-faint" />
          </button>
        ) : (
          <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
            {spaces.map((space) => {
              const tint = SPACE_TINTS[space.tint % SPACE_TINTS.length]
              const value = spaceUsd(space, prices)
              const progress =
                space.goalUsd && space.goalUsd > 0 ? Math.min(1, value / space.goalUsd) : null
              return (
                <button
                  key={space.id}
                  onClick={() => open({ kind: 'space', id: space.id })}
                  className="card card-press w-[150px] flex-none snap-start px-4 py-4 text-left"
                >
                  <span
                    className="grid size-9 place-items-center rounded-full text-[16px]"
                    style={{ background: tint.bg }}
                  >
                    {space.emoji}
                  </span>
                  <p className="mt-2.5 truncate text-[13.5px] font-semibold">{space.name}</p>
                  <p className="tabular mt-0.5 text-[13px] text-ink-muted">
                    {revealed ? usdText(value) : '•••'}
                  </p>
                  {progress !== null ? (
                    <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-sunk">
                      <span
                        className="block h-full rounded-full transition-[width] duration-700"
                        style={{ width: `${progress * 100}%`, background: tint.fg }}
                      />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* people */}
      <section className="rise rise-4 mt-8">
        <SectionLabel
          action={
            <button
              onClick={() => open({ kind: 'new-person' })}
              className="text-[13px] font-semibold text-ink-muted hover:text-ink"
            >
              Add
            </button>
          }
        >
          People
        </SectionLabel>

        {people.length === 0 ? (
          <button
            onClick={() => open({ kind: 'new-person' })}
            className="card card-press flex w-full items-center gap-3.5 px-5 py-4 text-left"
          >
            <span className="grid size-10 flex-none place-items-center rounded-full bg-sunk text-[18px]">
              👋
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold">Add someone you pay</span>
              <span className="block text-[13px] leading-snug text-ink-muted">
                Each relationship gets its own privacy boundary, kept apart automatically.
              </span>
            </span>
            <Plus size={16} className="text-ink-faint" />
          </button>
        ) : (
          <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1">
            {people.map((person) => (
              <button
                key={person.id}
                onClick={() => open({ kind: 'pay', person })}
                className="flex w-[64px] flex-none flex-col items-center gap-1.5 transition-transform active:scale-95"
              >
                <Avatar emoji={person.emoji} size={52} className="bg-card shadow-[0_1px_2px_rgba(18,18,20,0.06)]" />
                <span className="w-full truncate text-center text-[12px] font-medium text-ink-soft">
                  {person.name}
                </span>
              </button>
            ))}
            <button
              onClick={() => open({ kind: 'new-person' })}
              aria-label="Add person"
              className="flex w-[64px] flex-none flex-col items-center gap-1.5 transition-transform active:scale-95"
            >
              <span className="grid size-[52px] place-items-center rounded-full border border-dashed border-rule-strong text-ink-faint">
                <Plus size={18} />
              </span>
              <span className="text-[12px] font-medium text-ink-faint">New</span>
            </button>
          </div>
        )}
      </section>

      {/* activity */}
      <section className="rise rise-5 mt-8">
        <SectionLabel
          action={
            ledger.length > 5 ? (
              <button
                onClick={() => setShowAllActivity((v) => !v)}
                className="text-[13px] font-semibold text-ink-muted hover:text-ink"
              >
                {showAllActivity ? 'Less' : 'All'}
              </button>
            ) : undefined
          }
        >
          Activity
        </SectionLabel>

        {ledger.length === 0 ? (
          <div className="card px-5 py-5 text-[13.5px] leading-relaxed text-ink-muted">
            Your history lives only on this device. Even we can&rsquo;t read it — there is no
            server to read it from.
          </div>
        ) : (
          <div className="card divide-y divide-rule">
            {visibleLedger.map((entry) => {
              const person = entry.counterparty
                ? personByAddress(people, entry.counterparty)
                : undefined
              const outbound = entry.type === 'TRANSFER' || entry.type === 'UNSHIELD'
              const title =
                entry.type === 'TRANSFER'
                  ? `Paid ${person?.name ?? (entry.counterparty ? shortAddress(entry.counterparty) : 'privately')}`
                  : entry.type === 'SHIELD'
                    ? 'Added money'
                    : entry.type === 'UNSHIELD'
                      ? 'Cashed out'
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
                      isPublic ? 'bg-warn-soft text-warn' : 'bg-sunk text-ink-soft'
                    }`}
                  >
                    {entry.type === 'TRANSFER' ? (
                      <ArrowUpRight size={16} />
                    ) : entry.type === 'SHIELD' ? (
                      <Plus size={16} />
                    ) : entry.type === 'UNSHIELD' ? (
                      <Globe size={16} />
                    ) : (
                      <Sparkle size={16} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{title}</span>
                    <span className="block text-[12.5px] text-ink-muted">
                      {relativeTime(entry.timestamp)} ·{' '}
                      {isPublic ? (
                        <span className="text-warn">{entry.observer}</span>
                      ) : (
                        'nothing public'
                      )}
                    </span>
                  </span>
                  <span className="tabular flex-none text-[14.5px] font-semibold">
                    {outbound ? '−' : '+'}
                    {formatUnits(entry.amount, TOKENS[entry.asset].decimals, 4)}{' '}
                    <span className="text-[12px] font-medium text-ink-muted">{entry.asset}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <footer className="mt-12 px-1 text-center text-[12px] leading-relaxed text-ink-faint">
        Every move settles on Starknet mainnet inside the STRK20 privacy pool.
        <br />
        Deposits and cash-outs are public by nature; everything between is not.
      </footer>
    </main>
  )
}
