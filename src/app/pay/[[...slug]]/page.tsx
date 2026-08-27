'use client'

/**
 * A pay page — someone's standing "pay me privately" surface.
 *
 * The path segment is cosmetic; the fragment carries the page. The owner's
 * receiving address is deliberately public here (the same fact their Receive
 * QR shows). The payment is not: it settles as a private transfer with no
 * public sender, no public amount, and no link between one payer and the
 * next. The payer's own silent engine reviews the payment exactly as it
 * would inside the app.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import { decodePayPage, type PayPagePayload } from '@/lib/lumen/paypage'
import { pickEmoji } from '@/lib/lumen/people'
import { reviewPay } from '@/lib/lumen/guard'
import { formatUnits, listWallets, subscribeToWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, tokenByAddress, type TokenSymbol } from '@/lib/strk20/config'
import { useLumen } from '@/lib/lumen/store'
import {
  AmountField,
  Avatar,
  ErrorNote,
  GuardPanel,
  parseAmount,
  SuccessMark,
  TxLink,
  usdText,
} from '@/components/lumen/bits'
import { ArrowRight, LumenMark, Lock, ShieldCheck, Wallet } from '@/components/lumen/icons'
import type { Receipt } from '@/lib/lumen/receipts'

type PageState =
  | { kind: 'reading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; payload: PayPagePayload }
  | { kind: 'paid'; payload: PayPagePayload; receipt: Receipt }

export default function PayPage() {
  const {
    status,
    address,
    connect,
    pay,
    prices,
    ledger,
    loadMarket,
    submitting,
    error,
    clearError,
    lastTx,
  } = useLumen()

  const [state, setState] = useState<PageState>({ kind: 'reading' })
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([])
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')

  useEffect(() => {
    setWallets(listWallets())
    return subscribeToWallets(setWallets)
  }, [])

  useEffect(() => {
    const payload = decodePayPage(window.location.hash)
    if (!payload) {
      setState({ kind: 'invalid' })
      return
    }
    if (payload.r) {
      const requested = tokenByAddress(TOKENS[payload.r.t].address)
      if (requested) setToken(requested.symbol)
    }
    setState({ kind: 'ready', payload })
    void loadMarket()
  }, [loadMarket])

  const payload = state.kind === 'ready' || state.kind === 'paid' ? state.payload : null
  const locked = payload?.r ?? null
  const amount = locked ? BigInt(locked.a) : parseAmount(amountText, token)
  const decimals = TOKENS[locked ? locked.t : token].decimals

  const connected = status === 'connected'
  const ready = wallets.filter(supportsStrk20)

  const report = useMemo(() => {
    if (!connected || !payload || amount <= 0n) return null
    return reviewPay({
      amount,
      decimals,
      token: locked ? locked.t : token,
      recipient: payload.a,
      ledger,
      now: Date.now(),
    })
  }, [connected, payload, amount, decimals, locked, token, ledger])

  const price = prices[token]
  const presets =
    payload && !locked && payload.p && price !== undefined && price > 0 ? payload.p : []

  const applyPreset = (usd: number) => {
    if (price === undefined || price <= 0) return
    const units = usd / price
    setAmountText(units.toFixed(Math.min(6, decimals)).replace(/\.?0+$/, ''))
  }

  const submit = async () => {
    if (!payload || amount <= 0n) return
    try {
      const receipt = await pay({
        token: locked ? locked.t : token,
        amount,
        recipient: payload.a,
        recipientName: payload.n,
        ...(payload.m ? { note: payload.m } : {}),
      })
      setState({ kind: 'paid', payload, receipt })
    } catch {
      // The store surfaced the wallet's explanation.
    }
  }

  const selfPay = connected && payload !== null && address !== null && (() => {
    try {
      return BigInt(address) === BigInt(payload.a)
    } catch {
      return false
    }
  })()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6 pb-10 pt-[max(36px,5vh)] lg:max-w-[900px] lg:px-10">
      <Link href="/" className="rise flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
          <LumenMark size={20} />
        </span>
        <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
      </Link>

      <div className="flex flex-1 flex-col justify-center py-8 lg:grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-center lg:gap-16">
        {state.kind === 'reading' ? <div className="card shimmer h-72 rounded-[24px]" /> : null}

        {state.kind === 'invalid' ? (
          <div className="rise card px-6 py-8 text-center">
            <p className="text-[20px] font-semibold tracking-[-0.02em]">
              This pay page didn&rsquo;t load
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
              The page travels after the <span className="font-mono">#</span> in the link, and
              some apps cut it off. Ask for the link again.
            </p>
            <Link href="/" className="btn btn-quiet mt-6">
              What is Lumen?
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' && payload ? (
          <div className="rise">
            <div className="card overflow-hidden">
              <div className="h-1.5 bg-ink" />
              <div className="px-6 pb-6 pt-7 text-center">
                <Avatar emoji={payload.e ?? pickEmoji(payload.n)} size={64} className="mx-auto" />
                <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">
                  Pay {payload.n}
                </h1>
                {payload.m ? (
                  <p className="mt-1 text-[14px] text-ink-muted">{payload.m}</p>
                ) : null}
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-sunk px-3.5 py-1.5 text-[12.5px] font-semibold">
                  <ShieldCheck size={13} />
                  Private payment
                </p>

                {locked ? (
                  <p className="tabular mt-6 text-[44px] font-semibold leading-none tracking-[-0.03em]">
                    {formatUnits(amount, decimals, 6)}{' '}
                    <span className="text-[22px] font-medium text-ink-muted">{locked.t}</span>
                  </p>
                ) : (
                  <div className="mt-2 text-left">
                    {presets.length > 0 ? (
                      <div className="mb-1 mt-4 flex justify-center gap-2">
                        {presets.map((usd) => (
                          <button
                            key={usd}
                            onClick={() => applyPreset(usd)}
                            className="h-10 rounded-full bg-sunk px-4 text-[14px] font-semibold transition-colors hover:bg-rule"
                          >
                            {usdText(usd)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <AmountField
                      value={amountText}
                      onChange={setAmountText}
                      token={token}
                      onToken={setToken}
                      tokens={TOKEN_LIST.map((t) => t.symbol)}
                      prices={prices}
                    />
                  </div>
                )}
              </div>
            </div>

            {report ? (
              <div className="mt-4">
                <GuardPanel report={report} />
              </div>
            ) : null}

            {error ? (
              <div className="mt-4">
                <ErrorNote message={error} onDismiss={clearError} />
              </div>
            ) : null}

            {selfPay ? (
              <p className="mt-4 text-center text-[13.5px] font-semibold">
                This is your own page — share it, don&rsquo;t pay it.
              </p>
            ) : connected ? (
              <button
                onClick={submit}
                disabled={amount <= 0n || submitting}
                className="btn btn-ink mt-5 w-full"
              >
                {submitting
                  ? 'Waiting for your wallet…'
                  : amount > 0n
                    ? `Pay ${formatUnits(amount, decimals, 4)} ${locked ? locked.t : token} privately`
                    : 'Pay privately'}
              </button>
            ) : ready.length > 0 ? (
              <div className="mt-5 space-y-2.5">
                <p className="px-1 text-[13px] font-semibold text-ink-muted">Connect to pay</p>
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
                    <span className="flex-1 text-[15px] font-semibold">{wallet.name}</span>
                    <ArrowRight size={16} className="text-ink-muted" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="card mt-5 px-5 py-5">
                <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                  <Wallet size={16} />
                  Paying privately takes a wallet
                </p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
                  Install{' '}
                  <a
                    href="https://www.ready.co/"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-ink underline underline-offset-2"
                  >
                    Ready
                  </a>
                  , add money once, and come back — this page will still be here.
                </p>
              </div>
            )}
          </div>
        ) : null}

        {payload && state.kind !== 'paid' ? (
          <aside className="rise rise-3 mt-6 lg:mt-0">
            <p className="text-[13px] font-semibold text-ink-muted">
              What this payment leaves behind
            </p>
            <div className="mt-3 space-y-px overflow-hidden rounded-[20px] border border-rule bg-card">
              {[
                ['Your name', 'Never asked for'],
                ['Your wallet address', 'Not published'],
                ['The amount', 'Not published'],
                [`${payload.n}'s other payers`, 'Invisible to you'],
                ['Your other payments', `Invisible to ${payload.n}`],
              ].map(([label, value]) => (
                <p
                  key={label}
                  className="flex items-baseline justify-between gap-4 border-b border-rule px-5 py-3 text-[14px] last:border-b-0"
                >
                  <span className="text-ink-muted">{label}</span>
                  <span className="flex-none font-medium">{value}</span>
                </p>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-ink-faint">
              Settlement happens inside the STRK20 privacy pool on Starknet mainnet. There is no
              Lumen server in the path — this page ran entirely in your browser.
            </p>
          </aside>
        ) : null}

        {state.kind === 'paid' && payload ? (
          <div className="rise text-center">
            <SuccessMark />
            <p className="mt-5 text-[24px] font-semibold tracking-[-0.02em]">
              {payload.n} has been paid
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-ink-muted">
              Privately. Your receipt is saved in Lumen — the chain saw nothing about you.
            </p>
            {lastTx ? (
              <p className="mt-3">
                <TxLink hash={lastTx.hash} />
              </p>
            ) : null}
            <Link href="/app" className="btn btn-ink mt-7 w-full">
              Open Lumen
              <ArrowRight size={17} />
            </Link>
          </div>
        ) : null}
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-[12px] leading-relaxed text-ink-faint">
        <Lock size={12} />
        {payload ? `${payload.n}'s address is public on this page — your payment is not.` : 'Private money, by default.'}
      </p>
    </main>
  )
}
