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
import { loadInbox, waitingLinks, type InboxLink } from '@/lib/lumen/inbox'
import { summarize } from '@/lib/lumen/journal'
import { encodeClaimLink } from '@/lib/strk20/escrow'
import type { Receipt } from '@/lib/lumen/receipts'
import { SendComposer } from './send'
import { NotRegistered, NothingToSend } from './first-run'
import type { LedgerEntry } from '@/lib/history'
import { formatUnits } from '@/lib/strk20/wallet'
import { explorerTx, TOKENS } from '@/lib/strk20/config'
import {
  ArrowDown,
  Eye,
  Globe,
  LinkIcon,
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

/**
 * The observer's panel: this account redacted to what any explorer can ever
 * know. On a wide screen it sits permanently beside your view, so the thesis
 * needs no interaction; on a phone it replaces the screen.
 */
export function ObserverPanel({
  publicEntries,
  privateCount,
  onBack,
  onMirror,
}: {
  publicEntries: LedgerEntry[]
  privateCount: number
  onBack?: () => void
  /** Opens the self-only reading of the account's own public address. */
  onMirror?: () => void
}) {
  return (
    <div className="unblur">
      <section className="rounded-[24px] border border-dashed border-rule-strong bg-card px-6 py-6">
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

      {/* The same reading, run against the address that is not private, so
          the contrast is measured rather than asserted. */}
      {onMirror ? (
        <button onClick={onMirror} className="card card-press mt-4 w-full px-5 py-4 text-left">
          <p className="text-[14px] font-semibold">Now read your public address</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            The same heuristics, pointed at the wallet you already had. Only yours, only what
            is already published.
          </p>
        </button>
      ) : null}

      <section className="mt-5">
        <SectionLabel>Visible on-chain</SectionLabel>
        {publicEntries.length === 0 ? (
          <div className="card px-5 py-5">
            <p className="text-[13.5px] leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink">Lumen has published nothing</span> from
              this account.
            </p>
            {/* This panel can only speak for what Lumen did. A deposit made in
                the wallet itself is public, is not in this ledger, and claiming
                otherwise would be the exact dishonesty the panel exists to
                expose. */}
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
              It cannot see what your wallet did on its own. If you shielded or withdrew there,
              that is public and is not listed here — read your public address below for
              everything the chain actually holds.
            </p>
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
                  <span className="block truncate text-[12.5px] text-ink-muted">
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
                <span className="tabular flex-none whitespace-nowrap text-[14.5px] font-semibold">
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
              {privateCount} private {privateCount === 1 ? 'operation' : 'operations'} — invisible
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              Payments, amounts and recipients settled through the pool with no public sender,
              recipient or amount. They were never published at all.
            </p>
          </div>
        ) : null}
      </section>

      {onBack ? (
        <button onClick={onBack} className="btn btn-ink mt-8 w-full">
          <Eye size={16} />
          Back to your view
        </button>
      ) : null}
    </div>
  )
}

export function Home({
  open,
  observer,
  onObserver,
  onReceipt,
}: {
  open: (route: SheetRoute) => void
  observer: boolean
  onObserver: (next: boolean) => void
  onReceipt: (receipt: Receipt) => void
}) {
  const {
    balances,
    balancesLoading,
    balancesRevealedAt,
    registered,
    revealBalances,
    prices,
    ledger,
    arrivals,
    journal,
    error,
    clearError,
    lastTx,
    walletName,
  } = useLumen()

  const [inbox, setInbox] = useState<InboxLink[]>([])

  // The inbox is device-global — links land here before any wallet exists —
  // so it is read directly rather than through the account-keyed store.
  useEffect(() => {
    setInbox(loadInbox())
  }, [])

  const waiting = useMemo(() => waitingLinks(inbox), [inbox])
  const totalUsd = useMemo(() => portfolioUsd(balances, prices), [balances, prices])
  const nonZero = balances.filter((b) => b.raw > 0n)
  // Waiting links count: money is here even before it is claimed.
  const hasBalance = nonZero.length > 0 || waiting.length > 0
  const revealed = balancesRevealedAt !== null
  const digest = useMemo(() => summarize(journal, Date.now()), [journal])

  const publicEntries = ledger.filter((entry) => entry.observer !== '—')
  const privateCount = ledger.length - publicEntries.length


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
    <>
      {error && !observer ? (
        <div className="mt-4">
          <ErrorNote message={error} onDismiss={clearError} />
        </div>
      ) : null}

      {observer ? (
        <div className="mt-5 lg:hidden">
          <ObserverPanel
            publicEntries={publicEntries}
            privateCount={privateCount}
            onBack={() => onObserver(false)}
            onMirror={() => open({ kind: 'mirror' })}
          />
        </div>
      ) : (
        <>
          {/* One thing at a time. A composer that cannot submit and a deposit
              button that will fail are worse than a single sentence. */}
          {registered === false ? (
            <div className="mt-1">
              <NotRegistered walletName={walletName} />
            </div>
          ) : !hasBalance ? (
            <div className="mt-1">
              <NothingToSend
                onAdd={() => open({ kind: 'add' })}
                onGetPaid={() => open({ kind: 'my-page' })}
              />
            </div>
          ) : (
            <div className="mt-1">
              <SendComposer
                onObserver={() => onObserver(true)}
                onReceipt={onReceipt}
                onNeedsLink={() => open({ kind: 'pay' })}
              />
            </div>
          )}

          {/* the balance — an object here, not the brand */}
          {registered === false ? null : (
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

          )}

          {/* waiting for you — the heartbeat */}
          {waiting.length > 0 ? (
            <section className="rise rise-2 mt-5">
              <SectionLabel>Waiting for you</SectionLabel>
              <div className="space-y-2">
                {waiting.map((link) => (
                  <a
                    key={link.claimSecret}
                    href={claimHref(link)}
                    className="glass card-press flex items-center gap-3.5 px-5 py-4"
                  >
                    <span className="grid size-9 flex-none place-items-center rounded-full bg-white/10">
                      <LinkIcon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular block text-[17px] font-semibold leading-tight">
                        {formatUnits(BigInt(link.amountRaw), TOKENS[link.token].decimals, 4)}{' '}
                        {link.token}
                      </span>
                      <span className="block truncate text-[12.5px] text-glass-muted">
                        {link.fromName ? `from ${link.fromName}` : 'from someone'}
                        {link.note ? ` · ${link.note}` : ''}
                      </span>
                    </span>
                    <span className="flex-none rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold">
                      Claim
                    </span>
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          {/* arrivals we cannot attribute — and say so, once */}
          {revealed && arrivals.length > 0 ? (
            <section className="rise rise-2 mt-6">
              <SectionLabel>Arrived</SectionLabel>
              <div className="card divide-y divide-rule">
                {arrivals.slice(0, 4).map((arrival) => (
                  <div key={arrival.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-7 flex-none place-items-center rounded-full bg-sunk text-ink">
                      <ArrowDown size={14} />
                    </span>
                    <span className="tabular flex-1 text-[15px] font-semibold">
                      +{formatUnits(BigInt(arrival.amountRaw), TOKENS[arrival.token].decimals, 4)}{' '}
                      <span className="text-[12.5px] font-medium text-ink-muted">
                        {arrival.token}
                      </span>
                    </span>
                    <span className="flex-none text-[12px] text-ink-faint">
                      {relativeTime(arrival.detectedAt)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink-faint">
                Nobody published who sent these — so nobody can read them, including us.
              </p>
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

          {/* Everything else is utility now — Send is above, and it is the
              product. These stay quiet and equal, and they stay hidden until
              they can do anything. */}
          {registered === false ? null : (
          <section className="rise rise-4 mt-4">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => open({ kind: 'my-page' })}
                className="card card-press flex items-center gap-2.5 px-4 py-3.5"
              >
                <span className="grid size-8 flex-none place-items-center rounded-full bg-sunk text-ink">
                  <ReceiptIcon size={16} />
                </span>
                <span className="text-[13.5px] font-semibold">Get paid</span>
              </button>
              <button
                onClick={() => open({ kind: 'add' })}
                className="card card-press flex items-center gap-2.5 px-4 py-3.5"
              >
                <span className="grid size-8 flex-none place-items-center rounded-full bg-sunk text-ink">
                  <Plus size={16} />
                </span>
                <span className="text-[13.5px] font-semibold">Add money</span>
              </button>
            </div>
          </section>
          )}

          {lastTx && lastTx.status === 'submitted' ? (
            <p className="mt-3 flex items-center gap-2 px-1 text-[12.5px] text-ink-muted">
              <span className="size-1.5 animate-pulse rounded-full bg-ink" />
              Settling on Starknet — usually under a minute.
            </p>
          ) : null}




          <button
            onClick={() => onObserver(true)}
            className="card card-press mt-10 flex w-full items-center gap-3.5 px-5 py-4 text-left lg:hidden"
          >
            <span className="grid size-10 flex-none place-items-center rounded-full bg-ink text-white">
              <Globe size={18} />
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold">See what the world sees</span>
              <span className="block text-[12.5px] leading-snug text-ink-muted">
                Your account, redacted to what any explorer can ever know.
              </span>
            </span>
          </button>

          <footer className="mt-8 px-1 text-center text-[12px] leading-relaxed text-ink-faint">
            Deposits and cash-outs are public by nature.
            <br />
            Everything between them is not.
          </footer>
        </>
      )}
    </>
  )
}
