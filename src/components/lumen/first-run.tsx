'use client'

/**
 * The one thing to do next.
 *
 * A new account cannot send: it has no private balance, and on Starknet it
 * cannot even hold one until the wallet has registered it with the pool. The
 * app used to show a composer, a balance and two buttons anyway — four
 * affordances, three of them dead, and the one that looked most inviting
 * failed at the wallet prompt.
 *
 * So before there is money to move, the screen is a single instruction with a
 * single button. The composer appears when it can actually do something.
 *
 * Both walls here are the protocol's, not ours, and neither is hidden:
 * registration is a wallet action no dapp can perform, and the pool's fee is
 * flat, which makes a small first deposit a bad trade rather than a small one.
 */

import { formatUnits } from '@/lib/strk20/wallet'
import { ArrowRight, Plus, ShieldCheck } from './icons'

export function NotRegistered({ walletName }: { walletName: string | null }) {
  return (
    <section className="rise glass px-7 py-7">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-glass-faint">
        <ShieldCheck size={13} />
        One step, once, in your wallet
      </p>
      <h2 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-glass-ink">
        Your wallet has to join the privacy pool before anything can be private.
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-glass-muted">
        {walletName ?? 'Your wallet'} does this the first time you shield something in it. No app
        can do it for you — the wallet API has no method for it, which is exactly why nobody can
        register you behind your back either.
      </p>
      <ol className="mt-5 space-y-2.5 text-[14.5px] text-glass-muted">
        {[
          `Open ${walletName ?? 'your wallet'} and shield some ${''}STRK there.`,
          'Approve it. That approval is the registration.',
          'Come back here. You will never see this screen again.',
        ].map((line, index) => (
          <li key={line} className="flex gap-3">
            <span className="font-mono text-[12px] text-glass-faint">0{index + 1}</span>
            {line}
          </li>
        ))}
      </ol>
      <p className="mt-6 border-t border-white/10 pt-4 text-[13px] leading-relaxed text-glass-faint">
        Shield a real amount rather than a token one. The pool charges a flat fee per operation,
        so a small first deposit loses most of itself to it and a large one barely notices.
      </p>
    </section>
  )
}

export function NothingToSend({
  poolFee,
  onAdd,
  onGetPaid,
}: {
  poolFee: bigint
  onAdd: () => void
  onGetPaid: () => void
}) {
  return (
    <section className="rise glass px-7 py-7">
      <h2 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-glass-ink">
        Add money once. After that, nothing you do here is public.
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-glass-muted">
        Your deposit is the only visible step, and the engine tunes even that so it points at
        nothing you do later. Paying, getting paid and saving publish nothing at all.
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-glass-faint">
        The pool charges a flat {formatUnits(poolFee, 18, 2)} STRK per operation, so one larger
        deposit costs the same as one small one and leaves more to spend.
      </p>
      <div className="mt-6 flex flex-wrap gap-2.5">
        <button onClick={onAdd} className="btn bg-white text-ink hover:bg-white/90">
          <Plus size={17} />
          Add money
        </button>
        <button
          onClick={onGetPaid}
          className="btn border border-white/25 text-glass-ink hover:bg-white/10"
        >
          Or get paid first
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  )
}
