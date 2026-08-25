'use client'

/**
 * The front door. One promise, one action: connect a privacy-enabled wallet.
 *
 * Wallets without STRK20 support are listed but disabled with an honest
 * explanation — capability is detected from the advertised Wallet API version,
 * never by probing a data method (that would trigger a consent prompt).
 */

import { useEffect, useState } from 'react'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import { listWallets, subscribeToWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { useLumen } from '@/lib/lumen/store'
import { LumenMark, Lock, ShieldCheck, Sparkle } from './icons'
import { ErrorNote } from './bits'

export function ConnectScreen() {
  const { connect, status, error, clearError, enterPreview } = useLumen()
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([])

  useEffect(() => {
    setWallets(listWallets())
    return subscribeToWallets(setWallets)
  }, [])

  const ready = wallets.filter(supportsStrk20)
  const others = wallets.filter((w) => !supportsStrk20(w))

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6 pb-10 pt-[max(48px,8vh)]">
      <div className="rise flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
          <LumenMark size={20} />
        </span>
        <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
      </div>

      <div className="rise rise-1 mt-14">
        <h1 className="text-[40px] font-semibold leading-[1.06] tracking-[-0.035em]">
          Your money,
          <br />
          <span className="lumen-text">nobody&rsquo;s business.</span>
        </h1>
        <p className="mt-4 max-w-[34ch] text-[16px] leading-relaxed text-ink-muted">
          Pay, receive and save on Starknet without publishing a financial profile. Private is the
          default — not a feature you switch on.
        </p>
      </div>

      <ul className="rise rise-2 mt-8 space-y-2.5 text-[14px] text-ink-soft">
        <li className="flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-good" />
          Payments with no public sender, recipient or amount
        </li>
        <li className="flex items-center gap-2.5">
          <Sparkle size={16} className="text-good" />A silent engine keeps your history unlinkable
        </li>
        <li className="flex items-center gap-2.5">
          <Lock size={16} className="text-good" />
          Keys and balances stay in your wallet — never here
        </li>
      </ul>

      <div className="rise rise-3 mt-10 flex-1">
        {error ? (
          <div className="mb-4">
            <ErrorNote message={error} onDismiss={clearError} />
          </div>
        ) : null}

        {ready.length > 0 ? (
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
                  <img src={wallet.icon} alt="" className="size-9 rounded-xl" />
                ) : (
                  <span className="size-9 rounded-xl bg-sunk" />
                )}
                <span className="flex-1">
                  <span className="block text-[16px] font-semibold">{wallet.name}</span>
                  <span className="block text-[13px] text-ink-muted">Privacy-enabled</span>
                </span>
                <span className="text-[14px] font-semibold text-ink-muted">
                  {status === 'connecting' ? 'Connecting…' : 'Connect'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="card px-5 py-5">
            <p className="text-[15px] font-semibold">No privacy-enabled wallet found</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
              Lumen needs a Starknet wallet with private balances built in. Install{' '}
              <a
                href="https://www.ready.co/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-ink underline underline-offset-2"
              >
                Ready
              </a>{' '}
              and refresh this page.
            </p>
          </div>
        )}

        <button
          onClick={enterPreview}
          className="mt-4 w-full rounded-2xl border border-dashed border-rule-strong px-5 py-3.5 text-left text-[13.5px] text-ink-muted transition-colors hover:bg-card"
        >
          <span className="font-semibold text-ink">Just looking?</span> Walk through Lumen with
          sample data — nothing to install.
        </button>

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
        Lumen runs on Starknet mainnet inside the STRK20 privacy pool. Your wallet holds every key
        and approves every move.
      </p>
    </main>
  )
}
