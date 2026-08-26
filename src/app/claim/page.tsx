'use client'

/**
 * The claim page — where a recipient meets private money for the first time.
 *
 * The URL fragment carries the claim secret; fragments never reach a server,
 * so the page reads it locally, checks the escrow's live state over RPC, and
 * walks the recipient from "what is this" to "it's yours, privately" —
 * including the case where they have no wallet at all, which is exactly the
 * person this flow exists for.
 */

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { WalletWithStarknetFeatures } from '@starknet-io/get-starknet-wallet-standard/features'
import {
  decodeClaimLink,
  readEscrowEntry,
  tokenForClaim,
  type ClaimLinkPayload,
  type EscrowEntryState,
} from '@/lib/strk20/escrow'
import { formatUnits, listWallets, subscribeToWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { markInboxClaimed, reconcileInbox, rememberLink } from '@/lib/lumen/inbox'
import { useLumen } from '@/lib/lumen/store'
import { ErrorNote, SuccessMark, TxLink } from '@/components/lumen/bits'
import { ArrowRight, LumenMark, Lock, ShieldCheck, Wallet } from '@/components/lumen/icons'

type PageState =
  | { kind: 'reading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; payload: ClaimLinkPayload; entry: EscrowEntryState | null }
  | { kind: 'claimed-by-me'; payload: ClaimLinkPayload; txHash: string }

export default function ClaimPage() {
  const { status, connect, claimFromLink, submitting, error, clearError, lastTx, preview } =
    useLumen()
  const [state, setState] = useState<PageState>({ kind: 'reading' })
  const [wallets, setWallets] = useState<readonly WalletWithStarknetFeatures[]>([])
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setWallets(listWallets())
    return subscribeToWallets(setWallets)
  }, [])

  const refresh = useCallback(async (payload: ClaimLinkPayload) => {
    setChecking(true)
    const entry = await readEscrowEntry(payload.s)
    // The chain is the truth: if it was claimed elsewhere, stop showing it as
    // waiting in this device's inbox.
    if (entry?.claimed) reconcileInbox(payload.s, true)
    setState((current) =>
      current.kind === 'claimed-by-me' ? current : { kind: 'ready', payload, entry },
    )
    setChecking(false)
  }, [])

  useEffect(() => {
    const payload = decodeClaimLink(window.location.hash)
    if (!payload) {
      setState({ kind: 'invalid' })
      return
    }
    // Remember it before anything else: this device now holds money, and
    // Incoming should say so even if the visitor closes the tab and returns
    // later without the original message.
    const token = tokenForClaim(payload)
    if (token) {
      rememberLink({
        claimSecret: payload.s,
        token: token.symbol,
        amountRaw: payload.a,
        ...(payload.f ? { fromName: payload.f } : {}),
        ...(payload.n ? { note: payload.n } : {}),
      })
    }
    void refresh(payload)
  }, [refresh])

  const claim = async (payload: ClaimLinkPayload) => {
    try {
      const txHash = await claimFromLink(payload)
      markInboxClaimed(payload.s, txHash)
      setState({ kind: 'claimed-by-me', payload, txHash })
    } catch {
      // The store surfaced the wallet's explanation.
    }
  }

  const ready = wallets.filter(supportsStrk20)
  const connected = status === 'connected' && !preview

  const token = state.kind === 'ready' || state.kind === 'claimed-by-me' ? tokenForClaim(state.payload) : undefined
  const amountText =
    token && (state.kind === 'ready' || state.kind === 'claimed-by-me')
      ? `${formatUnits(BigInt(state.payload.a), token.decimals, 6)} ${token.symbol}`
      : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-6 pb-10 pt-[max(40px,6vh)]">
      <Link href="/" className="rise flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
          <LumenMark size={20} />
        </span>
        <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
      </Link>

      <div className="flex flex-1 flex-col justify-center py-10">
        {state.kind === 'reading' ? (
          <div className="card shimmer h-64 rounded-[24px]" />
        ) : null}

        {state.kind === 'invalid' ? (
          <div className="rise card px-6 py-8 text-center">
            <p className="text-[20px] font-semibold tracking-[-0.02em]">
              This link isn&rsquo;t a claim link
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
              It may be incomplete — the secret lives after the <span className="font-mono">#</span>,
              and some apps cut it off. Ask the sender to copy it again.
            </p>
            <Link href="/" className="btn btn-quiet mt-6">
              What is Lumen?
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="rise">
            <div className="card overflow-hidden">
              <div className="h-1.5 bg-ink" />
              <div className="px-6 py-7 text-center">
                <p className="text-[13px] font-semibold text-ink-muted">
                  {state.payload.f ? `${state.payload.f} sent you` : 'Someone sent you'}
                </p>
                <p className="tabular mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em]">
                  {amountText ?? 'money'}
                </p>
                {state.payload.n ? (
                  <p className="mt-3 text-[14px] text-ink-soft">&ldquo;{state.payload.n}&rdquo;</p>
                ) : null}
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-sunk px-3 py-1 text-[12px] font-semibold">
                  <ShieldCheck size={13} />
                  Claims privately — no public trace of you
                </p>
              </div>
            </div>

            {state.entry === null ? (
              <p className="mt-4 text-center text-[13px] text-ink-muted">
                Couldn&rsquo;t reach the chain to check this link.{' '}
                <button
                  onClick={() => refresh(state.payload)}
                  disabled={checking}
                  className="font-semibold underline underline-offset-2"
                >
                  {checking ? 'Checking…' : 'Try again'}
                </button>
              </p>
            ) : !state.entry.exists ? (
              <p className="mx-auto mt-4 max-w-[320px] text-center text-[13px] leading-relaxed text-ink-muted">
                Not on-chain yet. If it was just sent, the pool needs a minute —{' '}
                <button
                  onClick={() => refresh(state.payload)}
                  disabled={checking}
                  className="font-semibold underline underline-offset-2"
                >
                  {checking ? 'checking…' : 'check again'}
                </button>
                .
              </p>
            ) : state.entry.claimed ? (
              <div className="card mt-4 px-5 py-4 text-center text-[14px] text-ink-muted">
                Already claimed. If that wasn&rsquo;t you, the money is gone from this link —
                only the first claim counts.
              </div>
            ) : (
              <div className="mt-5">
                {error ? (
                  <div className="mb-4">
                    <ErrorNote message={error} onDismiss={clearError} />
                  </div>
                ) : null}

                {connected ? (
                  <button
                    onClick={() => claim(state.payload)}
                    disabled={submitting}
                    className="btn btn-ink w-full"
                  >
                    {submitting ? 'Waiting for your wallet…' : 'Claim privately'}
                  </button>
                ) : ready.length > 0 ? (
                  <div className="space-y-2.5">
                    <p className="px-1 text-[13px] font-semibold text-ink-muted">
                      Connect to claim
                    </p>
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
                  <div className="card px-5 py-5">
                    <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                      <Wallet size={16} />
                      Two minutes to your first private balance
                    </p>
                    <ol className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-muted">
                      <li>
                        <span className="font-mono text-[11px] text-ink-faint">01</span>{' '}
                        Install{' '}
                        <a
                          href="https://www.ready.co/"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-ink underline underline-offset-2"
                        >
                          Ready
                        </a>{' '}
                        — a Starknet wallet with private balances built in.
                      </li>
                      <li>
                        <span className="font-mono text-[11px] text-ink-faint">02</span> Come back
                        to this link and refresh.
                      </li>
                      <li>
                        <span className="font-mono text-[11px] text-ink-faint">03</span> Claim.
                        The money arrives already private.
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}

        {state.kind === 'claimed-by-me' ? (
          <div className="rise text-center">
            <SuccessMark />
            <p className="mt-5 text-[24px] font-semibold tracking-[-0.02em]">
              {amountText ?? 'It'} is yours
            </p>
            <p className="mx-auto mt-2 max-w-[300px] text-[14.5px] leading-relaxed text-ink-muted">
              Claimed into your private balance. No one — including the sender — can see what you
              do with it next.
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
        The secret in this link never left your device — Lumen has no server to send it to.
      </p>
    </main>
  )
}
