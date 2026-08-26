'use client'

/**
 * Incoming — the first screen, and the product's heartbeat.
 *
 * Two things are honestly knowable and both are here: links this device holds
 * but has not claimed, and balance growth this device's own actions cannot
 * explain. Nothing claims to know who paid, because a private transfer
 * publishes no sender — which is the product working, not a gap.
 *
 * Below that: the balance as an object rather than the brand, three verbs, the
 * decision log (what the engine did while nobody was looking), and the view
 * switch that redacts everything to what a chain observer can ever see.
 */

import { useEffect, useMemo, useState } from 'react'
import { useLumen, portfolioUsd } from '@/lib/lumen/store'
import { personByAddress, shortAddress } from '@/lib/lumen/people'
import { loadInbox, waitingLinks, type InboxLink } from '@/lib/lumen/inbox'
import { summarize } from '@/lib/lumen/journal'
import { encodeClaimLink } from '@/lib/strk20/escrow'
import type { LedgerEntry } from '@/lib/history'
import { formatUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS } from '@/lib/strk20/config'
import {
  ArrowDown,
  ArrowUpRight,
  Dots,
  Eye,
  Globe,
  LinkIcon,
  LumenMark,
  Plus,
  Receipt as ReceiptIcon,
  ShieldCheck,
  Sparkle,
} from './icons'
import { ErrorNote, MoneyDisplay, SectionLabel } from './bits'
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

/** A redacted line: what an observer gets instead of a fact. */
function Redacted({ width = 'w-24' }: { width?: string }) {
  return (
    <span
      className={`inline-block h-3 ${width} rounded-sm bg-sunk align-middle`}
      aria-label="hidden"
    />
  )
}

export function Home({ open }: { open: (route: SheetRoute) => void }) {
  const {
    balances,
    balancesLoading,
    balancesRevealedAt,
    registered,
    revealBalances,
    prices,
    ledger,
    people,
    receipts,
    arrivals,
    journal,
    error,
    clearError,
    lastTx,
  } = useLumen()

  const [observer, setObserver] = useState(false)
  const [inbox, setInbox] = useState<InboxLink[]>([])

  // The inbox is device-global — links land here before any wallet exists —
  // so it is read directly rather than through the account-keyed store.
  useEffect(() => {
    setInbox(loadInbox())
  }, [])

  const waiting = useMemo(() => waitingLinks(inbox), [inbox])
  const totalUsd = useMemo(() => portfolioUsd(balances, prices), [balances, prices])
  const nonZero = balances.filter((b) => b.raw > 0n)
  const revealed = balancesRevealedAt !== null
  const digest = useMemo(() => summarize(journal, Date.now()), [journal])

  const publicEntries = ledger.filter((entry) => entry.observer !== '—')
  const privateCount = ledger.length - publicEntries.length

  const openEntry = (entry: LedgerEntry) => {
    if (entry.type !== 'TRANSFER' || !entry.txHash) return
    const receipt = receipts.find((r) => r.txHash === entry.txHash)
    if (receipt) open({ kind: 'receipt', receipt })
  }

  const claimHref = (link: InboxLink) =>
    encodeClaimLink(window.location.origin, {
      v: 1,
      s: link.claimSecret,
      t: TOKENS[link.token].address,
      a: link.amountRaw,
      ...(link.fromName ? { f: link.fromName } : {}),
      ...(link.note ? { n: link.note } : {}),
    })

  return (
    <main className="mx-auto w-full max-w-[460px] px-5 pb-16 pt-6">
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

      <div className="rise rise-1 mt-4 grid grid-cols-2 gap-1 rounded-full bg-sunk p-1">
        <button
          onClick={() => setObserver(false)}
          aria-pressed={!observer}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-all duration-300 ${
            !observer ? 'bg-card shadow-[0_1px_3px_rgba(18,18,20,0.1)]' : 'text-ink-muted'
          }`}
        >
          <Eye size={13} />
          Your view
        </button>
        <button
          onClick={() => setObserver(true)}
          aria-pressed={observer}
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-all duration-300 ${
            observer ? 'bg-ink text-white shadow-[0_1px_3px_rgba(18,18,20,0.2)]' : 'text-ink-muted'
          }`}
        >
          <Globe size={13} />
          What the world sees
        </button>
      </div>

      {error && !observer ? (
        <div className="mt-4">
          <ErrorNote message={error} onDismiss={clearError} />
        </div>
      ) : null}

      {observer ? (
        <div className="unblur">
          <section className="mt-5 rounded-[24px] border border-dashed border-rule-strong bg-card px-6 py-6">
            <p className="text-[13px] font-medium text-ink-muted">Some wallet</p>
            <div className="mt-3 space-y-2.5 text-[15px]">
              {[
                ['Private balance', 'w-28'],
                ['Who paid them', 'w-20'],
                ['Who they pay', 'w-24'],
                ['Payment history', 'w-16'],
              ].map(([label, width]) => (
                <p key={label} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-muted">{label}</span>
                  <Redacted width={width} />
                </p>
              ))}
            </div>
            <p className="mt-5 border-t border-rule pt-4 text-[12.5px] leading-relaxed text-ink-faint">
              This is your account as any explorer, indexer or analyst sees it — forever.
            </p>
          </section>

          <section className="mt-6">
            <SectionLabel>Visible on-chain</SectionLabel>
            {publicEntries.length === 0 ? (
              <div className="card px-5 py-5 text-[13.5px] leading-relaxed text-ink-muted">
                Nothing. This account has never crossed the public boundary.
              </div>
            ) : (
              <div className="card divide-y divide-rule">
                {publicEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3.5 px-5 py-3.5">
                    <span className="grid size-9 flex-none place-items-center rounded-full bg-ink text-white">
                      {entry.type === 'SHIELD' ? <Plus size={16} /> : <Globe size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold">
                        {entry.type === 'SHIELD'
                          ? 'A deposit into the pool'
                          : entry.type === 'LINK'
                            ? 'A deposit into an escrow'
                            : entry.type === 'CLAIM'
                              ? 'A claim from an escrow'
                              : 'A withdrawal from the pool'}
                      </span>
                      <span className="block text-[12.5px] text-ink-muted">
                        {relativeTime(entry.timestamp)}
                        {entry.txHash ? (
                          <>
                            {' · '}
                            <a
                              href={explorerTx(entry.txHash)}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-rule-strong underline-offset-2"
                            >
                              on the explorer
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="tabular flex-none text-[14.5px] font-semibold">
                      {formatUnits(entry.amount, TOKENS[entry.asset].decimals, 4)}{' '}
                      <span className="text-[12px] font-medium text-ink-muted">{entry.asset}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {privateCount > 0 ? (
              <div className="mt-3 rounded-[24px] border border-rule bg-card-soft px-5 py-4">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <ShieldCheck size={15} />
                  {privateCount} private {privateCount === 1 ? 'operation' : 'operations'} —
                  invisible
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                  Your payments, amounts and recipients settled through the pool with no public
                  sender, recipient or amount. They were never published at all.
                </p>
              </div>
            ) : null}
          </section>

          <button onClick={() => setObserver(false)} className="btn btn-ink mt-8 w-full">
            <Eye size={16} />
            Back to your view
          </button>
        </div>
      ) : (
        <>
          {/* waiting for you — the heartbeat */}
          {waiting.length > 0 ? (
            <section className="rise rise-2 mt-5">
              <SectionLabel>Waiting for you</SectionLabel>
              <div className="card divide-y divide-rule">
                {waiting.map((link) => (
                  <a
                    key={link.claimSecret}
                    href={claimHref(link)}
                    className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-card-soft"
                  >
                    <span className="grid size-10 flex-none place-items-center rounded-full bg-ink text-white">
                      <LinkIcon size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold">
                        {link.fromName ? `${link.fromName} sent you` : 'Someone sent you'}{' '}
                        <span className="tabular">
                          {formatUnits(BigInt(link.amountRaw), TOKENS[link.token].decimals, 4)}{' '}
                          {link.token}
                        </span>
                      </span>
                      <span className="block text-[12.5px] text-ink-muted">
                        {link.note ? `“${link.note}” · ` : ''}Tap to claim privately
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {/* arrivals we cannot attribute — and say so */}
          {revealed && arrivals.length > 0 ? (
            <section className="rise rise-2 mt-6">
              <SectionLabel>Arrived</SectionLabel>
              <div className="card divide-y divide-rule">
                {arrivals.slice(0, 4).map((arrival) => (
                  <div key={arrival.id} className="flex items-center gap-3.5 px-5 py-3.5">
                    <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink">
                      <ArrowDown size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular block text-[14.5px] font-semibold">
                        +{formatUnits(BigInt(arrival.amountRaw), TOKENS[arrival.token].decimals, 4)}{' '}
                        {arrival.token}
                      </span>
                      <span className="block text-[12.5px] leading-snug text-ink-muted">
                        We can&rsquo;t see who sent it — and neither can anyone else.
                      </span>
                    </span>
                    <span className="flex-none text-[12px] text-ink-faint">
                      {relativeTime(arrival.detectedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* the balance — an object here, not the brand */}
          <section className="rise rise-3 mt-6">
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
                        className="text-[42px] font-semibold leading-none tracking-[-0.03em]"
                      />
                    ) : nonZero.length > 0 ? (
                      <p className="text-[32px] font-semibold leading-none tracking-[-0.02em]">
                        {formatUnits(nonZero[0].raw, nonZero[0].decimals, 4)}{' '}
                        <span className="text-[19px] text-glass-muted">{nonZero[0].symbol}</span>
                      </p>
                    ) : (
                      <p className="text-[32px] font-semibold leading-none tracking-[-0.02em]">
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
                    <p className="mt-3 text-[13.5px] leading-relaxed text-glass-muted">
                      Nothing here yet.
                      {registered === false
                        ? ' Your private account activates with your first deposit.'
                        : ''}
                    </p>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-[12px] text-glass-faint">Only you can see this.</p>
                    <span className="flex items-center gap-3">
                      {nonZero.length > 0 ? (
                        <button
                          onClick={() => open({ kind: 'convert' })}
                          className="text-[12px] font-semibold text-glass-muted underline-offset-2 hover:underline"
                        >
                          Convert
                        </button>
                      ) : null}
                      <button
                        onClick={() => revealBalances()}
                        disabled={balancesLoading}
                        className="text-[12px] font-semibold text-glass-muted underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        {balancesLoading ? 'Checking…' : 'Refresh'}
                      </button>
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => revealBalances()}
                  disabled={balancesLoading}
                  className="mt-3 block w-full text-left"
                >
                  <span className="text-[42px] font-semibold leading-none tracking-[0.1em] text-glass-ink/90">
                    ••••••
                  </span>
                  <span className="mt-4 flex items-center gap-1.5 text-[13.5px] text-glass-muted">
                    <Eye size={15} />
                    {balancesLoading
                      ? 'Asking your wallet…'
                      : 'Tap to reveal — your wallet will ask first'}
                  </span>
                </button>
              )}
            </div>
          </section>

          {/* the three verbs */}
          <section className="rise rise-4 mt-4 grid grid-cols-3 gap-2.5">
            {(
              [
                { label: 'Pay', icon: <ArrowUpRight size={19} />, route: { kind: 'pay' } as const },
                {
                  label: 'Get paid',
                  icon: <ReceiptIcon size={19} />,
                  route: { kind: 'my-page' } as const,
                },
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
              <span className="size-1.5 animate-pulse rounded-full bg-ink" />
              Settling on Starknet — usually under a minute.
            </p>
          ) : null}

          {/* nothing yet at all */}
          {waiting.length === 0 && ledger.length === 0 ? (
            <section className="rise rise-5 mt-8">
              <div className="card px-5 py-6 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-full bg-sunk text-ink">
                  <ArrowDown size={19} />
                </span>
                <p className="mt-3 text-[15px] font-semibold">Nothing has arrived yet</p>
                <p className="mx-auto mt-1.5 max-w-[300px] text-[13px] leading-relaxed text-ink-muted">
                  Share your page and get paid privately — or add money once to start paying
                  people.
                </p>
                <button
                  onClick={() => open({ kind: 'my-page' })}
                  className="btn btn-ink btn-small mt-4"
                >
                  Get your page
                </button>
              </div>
            </section>
          ) : null}

          {/* what the engine did */}
          {digest.actions > 0 ? (
            <section className="rise rise-5 mt-8">
              <SectionLabel
                action={
                  <button
                    onClick={() => open({ kind: 'journal' })}
                    className="text-[13px] font-semibold text-ink-muted hover:text-ink"
                  >
                    All
                  </button>
                }
              >
                What Lumen did
              </SectionLabel>
              <button
                onClick={() => open({ kind: 'journal' })}
                className="card card-press w-full px-5 py-4 text-left"
              >
                <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <Sparkle size={15} />
                  Last 30 days
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {[
                    { n: digest.actions, label: 'moves made privately' },
                    { n: digest.rewritten, label: 'amounts rewritten' },
                    { n: digest.flagged, label: 'flagged for you' },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <p className="tabular text-[22px] font-semibold leading-none">{stat.n}</p>
                      <p className="mt-1 text-[11.5px] leading-tight text-ink-muted">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
              </button>
            </section>
          ) : null}

          {/* activity */}
          {ledger.length > 0 ? (
            <section className="rise rise-5 mt-8">
              <SectionLabel>Activity</SectionLabel>
              <div className="card divide-y divide-rule">
                {ledger.slice(0, 6).map((entry) => {
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
                        <span className="block text-[12.5px] text-ink-muted">
                          {relativeTime(entry.timestamp)} ·{' '}
                          {isPublic ? (
                            <span className="font-semibold text-ink">{entry.observer}</span>
                          ) : (
                            'nothing public'
                          )}
                        </span>
                      </span>
                      <span className="tabular flex-none text-[14.5px] font-semibold">
                        {outbound ? '−' : '+'}
                        {formatUnits(entry.amount, TOKENS[entry.asset].decimals, 4)}{' '}
                        <span className="text-[12px] font-medium text-ink-muted">
                          {entry.asset}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

          <footer className="mt-12 px-1 text-center text-[12px] leading-relaxed text-ink-faint">
            Money arrives privately. Deposits and cash-outs are public by nature;
            <br />
            everything between them is not.
          </footer>
        </>
      )}
    </main>
  )
}
