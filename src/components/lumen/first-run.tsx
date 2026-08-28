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

import { ArrowRight, Plus, ShieldCheck } from './icons'

export function NotRegistered({ walletName }: { walletName: string | null }) {
  return (
    <section className="rise glass px-7 py-7">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-glass-faint">
        <ShieldCheck size={13} />
        One step, once, in your wallet
      </p>
      <h2 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-glass-ink">
        One step in your wallet, then everything here is private.
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-glass-muted">
        Shield something in {walletName ?? 'your wallet'} once — that is the joining — then come
        back. Make it a real amount: the pool&rsquo;s fee is flat, so a small first deposit
        loses most of itself to it.
      </p>
    </section>
  )
}

export function NothingToSend({
  onAdd,
  onGetPaid,
}: {
  onAdd: () => void
  onGetPaid: () => void
}) {
  return (
    <section className="rise glass px-7 py-7">
      <h2 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-glass-ink">
        Add money once. After that, nothing you do here is public.
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-glass-muted">
        Your deposit is the only visible step, and the engine tunes even that. Everything after
        it publishes nothing.
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
