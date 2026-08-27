'use client'

/**
 * The front door.
 *
 * Not a marketing page — the landing already did that job, and repeating it
 * here is what made this screen feel like every other wallet connect. It
 * states what this account is for in one line, shows the account's own
 * argument (the observer's empty view) rather than describing it, and gets
 * out of the way.
 *
 * Capability is detected from the advertised Wallet API version, never by
 * probing a data method — probing would trigger a consent prompt for data we
 * have no reason to read.
 */

import { useEffect, useState } from 'react'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import { listWallets, subscribeToWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { useLumen } from '@/lib/lumen/store'
import { ArrowRight, Globe, LumenMark, ShieldCheck } from './icons'
import { ErrorNote } from './bits'
import { FilmStill } from '@/components/landing/film'

/** What an observer holds on an account that has never crossed the boundary. */
const REDACTED = ['Balance', 'Who paid them', 'Who they pay', 'Payment history'] as const

export function ConnectScreen() {
  const { connect, status, error, clearError } = useLumen()
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([])

  useEffect(() => {
    setWallets(listWallets())
    return subscribeToWallets(setWallets)
  }, [])

  const ready = wallets.filter(supportsStrk20)
  const others = wallets.filter((w) => !supportsStrk20(w))

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[980px] items-center gap-14 px-6 py-16 lg:grid-cols-[1fr_360px] lg:gap-20">
      {/* the ask */}
      <div>
        <div className="rise flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
            <LumenMark size={20} />
          </span>
          <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
        </div>

        <h1 className="rise rise-1 mt-10 text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[46px]">
          The account that
          <br />
          keeps your arrivals
          <br />
          <span className="stroke-text">from lining up.</span>
        </h1>

        <p className="rise rise-2 mt-5 max-w-[42ch] text-[16px] leading-relaxed text-ink-muted">
          Money reaches you from links, pages and other apps. Each one is private on its own.
          Together they are how a public profile of you gets built — unless something is holding
          the whole picture.
        </p>

        <div className="rise rise-3 mt-9">
          {error ? (
            <div className="mb-4 max-w-[420px]">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {ready.length > 0 ? (
            <div className="max-w-[420px] space-y-2.5">
              {ready.map((wallet) => (
                <button
                  key={wallet.name}
                  onClick={() => connect(wallet)}
                  disabled={status === 'connecting'}
                  className="card card-press flex w-full items-center gap-3.5 px-5 py-4 text-left disabled:opacity-50"
                >
                  {wallet.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={wallet.icon} alt="" className="size-10 rounded-xl" />
                  ) : (
                    <span className="size-10 rounded-xl bg-sunk" />
                  )}
                  <span className="flex-1">
                    <span className="block text-[16px] font-semibold">
                      Continue with {wallet.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-ink-muted">
                      <ShieldCheck size={12} />
                      Your wallet keeps every key
                    </span>
                  </span>
                  <span className="grid size-9 flex-none place-items-center rounded-full bg-ink text-white">
                    {status === 'connecting' ? (
                      <span className="size-3.5 animate-pulse rounded-full bg-white/70" />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="card max-w-[420px] px-5 py-5">
              <p className="text-[15px] font-semibold">You&rsquo;ll need a privacy wallet</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                Install{' '}
                <a
                  href="https://www.ready.co/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  Ready
                </a>{' '}
                — a Starknet wallet with private balances built in — then refresh this page. Two
                minutes, free, no account.
              </p>
            </div>
          )}

          <p className="mt-5 max-w-[420px] text-[12.5px] leading-relaxed text-ink-faint">
            Non-custodial, on Starknet mainnet inside the STRK20 privacy pool. Lumen never sees a
            key or a balance it wasn&rsquo;t shown.
          </p>

          {others.length > 0 ? (
            <p className="mt-4 max-w-[420px] text-[12.5px] leading-relaxed text-ink-faint">
              {others.map((w) => w.name).join(', ')}{' '}
              {others.length === 1 ? 'is installed but has' : 'are installed but have'} no private
              balances yet.
            </p>
          ) : null}
        </div>
      </div>

      {/* the argument, shown rather than described */}
      <div className="rise rise-4 hidden lg:block">
        <p className="mb-3 flex items-center gap-2 px-1 text-[12.5px] font-semibold text-ink-muted">
          <Globe size={13} />
          What the world sees
        </p>
        <div className="overflow-hidden rounded-[24px] border border-dashed border-rule-strong bg-card">
          {/* The film's closing frame, so the path in reads as one piece. */}
          <FilmStill className="block h-[150px] w-full" />
          <div className="px-6 pb-6">
            <p className="text-[13px] font-medium text-ink-muted">Any Lumen account</p>
            <div className="mt-3 space-y-2.5 text-[15px]">
              {REDACTED.map((label, index) => (
                <p key={label} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-muted">{label}</span>
                  <span
                    className="inline-block h-3 rounded-sm bg-sunk align-middle"
                    style={{ width: [112, 80, 96, 64][index] }}
                    aria-label="hidden"
                  />
                </p>
              ))}
            </div>
            <p className="mt-5 border-t border-rule pt-4 text-[12.5px] leading-relaxed text-ink-faint">
              Not hidden behind a login. Never published in the first place.
            </p>
          </div>
        </div>

      </div>
    </main>
  )
}
