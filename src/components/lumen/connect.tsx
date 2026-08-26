'use client'

/**
 * The front door — onboarding as a single confident page.
 *
 * Three situations, one screen: a privacy-enabled wallet is present (connect
 * in one tap), only ordinary wallets are present (explain, point at Ready),
 * or nothing is present (walk the three steps). The sample walkthrough is
 * always one tap away, so nobody bounces off an empty state.
 *
 * Capability is detected from the advertised Wallet API version, never by
 * probing a data method (that would trigger a consent prompt).
 */

import { useEffect, useState } from 'react'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import { listWallets, subscribeToWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { useLumen } from '@/lib/lumen/store'
import { ArrowRight, LumenMark, Lock, Plus, ShieldCheck, Wallet } from './icons'
import { ErrorNote } from './bits'

const STEPS = [
  {
    icon: <Wallet size={17} />,
    title: 'Get a privacy wallet',
    body: (
      <>
        Install{' '}
        <a
          href="https://www.ready.co/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-ink underline underline-offset-2"
        >
          Ready
        </a>{' '}
        — a Starknet wallet with private balances built in. Two minutes, free.
      </>
    ),
  },
  {
    icon: <Lock size={17} />,
    title: 'Connect it here',
    body: <>Refresh this page and your wallet appears above. One tap, no account, no email.</>,
  },
  {
    icon: <Plus size={17} />,
    title: 'Add money once',
    body: (
      <>
        One deposit activates your private account. From then on, everything you do is invisible.
      </>
    ),
  },
] as const

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
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6 pb-10 pt-[max(44px,7vh)]">
      <div className="rise flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
          <LumenMark size={20} />
        </span>
        <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
      </div>

      <div className="rise rise-1 mt-12">
        <h1 className="text-[42px] font-semibold leading-[1.04] tracking-[-0.035em]">
          Your money,
          <br />
          nobody&rsquo;s business.
        </h1>
        <p className="mt-4 max-w-[36ch] text-[16px] leading-relaxed text-ink-muted">
          Pay, receive and save on Starknet without publishing a financial profile. Private is the
          default — not a feature you switch on.
        </p>
      </div>

      <div className="rise rise-2 mt-9 flex-1">
        {error ? (
          <div className="mb-4">
            <ErrorNote message={error} onDismiss={clearError} />
          </div>
        ) : null}

        {ready.length > 0 ? (
          <>
            <p className="mb-2.5 px-1 text-[13px] font-semibold text-ink-muted">
              Your wallet is ready
            </p>
            <div className="space-y-2.5">
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
                    <span className="block text-[16px] font-semibold">{wallet.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-ink-muted">
                      <ShieldCheck size={12} />
                      Private balances built in
                    </span>
                  </span>
                  <span className="grid size-9 place-items-center rounded-full bg-ink text-white">
                    {status === 'connecting' ? (
                      <span className="size-3.5 animate-pulse rounded-full bg-white/70" />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mb-2.5 px-1 text-[13px] font-semibold text-ink-muted">
              Three steps, once
            </p>
            <div className="card divide-y divide-rule">
              {STEPS.map((step, index) => (
                <div key={step.title} className="flex gap-4 px-5 py-4">
                  <span className="grid size-9 flex-none place-items-center rounded-full bg-ink text-white">
                    {step.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-semibold">
                      <span className="mr-1.5 font-mono text-[11px] text-ink-faint">
                        0{index + 1}
                      </span>
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}


        {others.length > 0 ? (
          <div className="mt-4 space-y-2">
            {others.map((wallet) => (
              <div
                key={wallet.name}
                className="flex items-center gap-3 rounded-2xl border border-rule px-4 py-3 opacity-55"
              >
                {wallet.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallet.icon} alt="" className="size-7 rounded-lg" />
                ) : (
                  <span className="size-7 rounded-lg bg-sunk" />
                )}
                <span className="flex-1 text-[14px] font-medium">{wallet.name}</span>
                <span className="text-[12px] text-ink-muted">No private balances yet</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <p className="rise rise-4 mt-10 text-[12.5px] leading-relaxed text-ink-faint">
        Non-custodial, on Starknet mainnet inside the STRK20 privacy pool. Your wallet holds every
        key and approves every move — Lumen never sees private state.
      </p>
    </main>
  )
}
