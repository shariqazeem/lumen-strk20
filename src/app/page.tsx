'use client'

/**
 * The Lumen landing — one promise told calmly.
 *
 * The page sells the product by *being* the product: the hero phone is the
 * real home surface (same design system, demo data), the receipt is the real
 * receipt card, the guard pill is the real guard pill. No screenshots.
 */

import Link from 'next/link'
import { useReveal } from '@/lib/hooks/use-motion'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Globe,
  LumenMark,
  People,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkle,
} from '@/components/lumen/icons'
import type { ReactNode } from 'react'

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { ref, shown } = useReveal<HTMLDivElement>({ threshold: 0.18 })
  return (
    <div ref={ref} className={`reveal ${shown ? 'shown' : ''} ${className}`}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* hero phone — the real home surface with demo data                   */
/* ------------------------------------------------------------------ */

function PhoneMock() {
  return (
    <div className="w-[330px] rounded-[44px] border border-rule bg-canvas p-2.5 shadow-[0_40px_100px_-20px_rgba(18,18,20,0.35)]">
      <div className="overflow-hidden rounded-[36px] bg-canvas px-4 pb-6 pt-4">
        {/* header */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <span className="grid size-6 place-items-center rounded-lg bg-ink text-white">
              <LumenMark size={13} />
            </span>
            <span className="text-[13px] font-semibold">Lumen</span>
          </div>
          <span className="size-6 rounded-full bg-card shadow-[0_1px_2px_rgba(18,18,20,0.08)]" />
        </div>

        {/* glass card */}
        <div className="glass mt-3 px-5 pb-5 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-medium text-glass-muted">Your money</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-glass-ink">
              <ShieldCheck size={9} />
              Private
            </span>
          </div>
          <p className="tabular mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em]">
            $2,841<span className="align-top text-[17px] opacity-60">.36</span>
          </p>
          <div className="mt-3 flex gap-1">
            <span className="tabular rounded-full bg-white/8 px-2 py-0.5 text-[9.5px] text-glass-muted">
              2,412.7 USDC
            </span>
            <span className="tabular rounded-full bg-white/8 px-2 py-0.5 text-[9.5px] text-glass-muted">
              1,203.8 STRK
            </span>
          </div>
          <p className="mt-3 text-[9.5px] text-glass-faint">Only you can see this.</p>
        </div>

        {/* actions */}
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {[
            { label: 'Pay', icon: <ArrowUpRight size={13} /> },
            { label: 'Receive', icon: <ArrowDown size={13} /> },
            { label: 'Add', icon: <Plus size={13} /> },
          ].map((a) => (
            <div key={a.label} className="card flex flex-col items-center gap-1 py-2.5">
              <span className="grid size-7 place-items-center rounded-full bg-ink text-white">
                {a.icon}
              </span>
              <span className="text-[10px] font-semibold">{a.label}</span>
            </div>
          ))}
        </div>

        {/* activity */}
        <p className="mt-4 px-1 text-[11px] font-semibold">Activity</p>
        <div className="card mt-1.5 divide-y divide-rule">
          {[
            { title: 'Paid Amara', sub: '2h ago · nothing public', amount: '−212.47 USDC', pub: false },
            { title: 'Paid landlord', sub: 'Yesterday · nothing public', amount: '−938.12 USDC', pub: false },
            { title: 'Added money', sub: 'Mon · deposit · public', amount: '+987.31 USDC', pub: true },
          ].map((row) => (
            <div key={row.title} className="flex items-center gap-2.5 px-3 py-2.5">
              <span
                className={`grid size-6 flex-none place-items-center rounded-full ${
                  row.pub ? 'bg-warn-soft text-warn' : 'bg-sunk text-ink-soft'
                }`}
              >
                {row.pub ? <Plus size={11} /> : <ArrowUpRight size={11} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px] font-semibold">{row.title}</span>
                <span className={`block text-[9px] ${row.pub ? 'text-warn' : 'text-ink-muted'}`}>
                  {row.sub}
                </span>
              </span>
              <span className="tabular text-[10.5px] font-semibold">{row.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* floating props                                                      */
/* ------------------------------------------------------------------ */

function FloatingReceipt() {
  return (
    <div className="card w-[210px] overflow-hidden">
      <div className="lumen-strip h-1" />
      <div className="px-4 py-3.5">
        <p className="flex items-center gap-1 text-[9px] font-semibold text-ink-muted">
          <LumenMark size={10} />
          Private payment
        </p>
        <p className="tabular mt-2 text-center text-[19px] font-semibold tracking-[-0.02em]">
          938.12 USDC
        </p>
        <div className="mt-2.5 space-y-1 border-t border-dashed border-rule-strong pt-2 text-[8.5px]">
          <p className="flex justify-between">
            <span className="text-ink-muted">To</span>
            <span className="font-semibold">Landlord</span>
          </p>
          <p className="flex justify-between">
            <span className="text-ink-muted">Settlement</span>
            <span className="font-mono">0x04d2…9e1a</span>
          </p>
        </div>
      </div>
    </div>
  )
}

function FloatingGuard() {
  return (
    <div className="card w-[240px] px-3.5 py-3">
      <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2 py-0.5 text-[9.5px] font-semibold text-good">
        <Sparkle size={10} />
        Tuned for privacy
      </span>
      <ul className="mt-2.5 space-y-1.5">
        {[
          'No public record',
          'Amount blends in — adjusted',
          'No schedule published',
        ].map((line) => (
          <li key={line} className="flex items-center gap-1.5 text-[9.5px] font-medium text-ink-soft">
            <span className="grid size-3.5 place-items-center rounded-full bg-good-soft text-good">
              <Check size={8} strokeWidth={3} />
            </span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: <People size={20} />,
    title: 'Every relationship, its own boundary',
    body: 'Your landlord, your friends, your clients — each sees only what you send them. Nothing connects one relationship to another, and none of them can see your balance, your history, or each other.',
  },
  {
    icon: <Receipt size={20} />,
    title: 'Prove a payment. Nothing else.',
    body: 'Every payment mints a receipt you can hand to exactly one person: this amount, this moment, settled on-chain. It discloses that single fact — never your balance, never your other life.',
  },
  {
    icon: <Sparkle size={20} />,
    title: 'A silent engine watches the leaks',
    body: 'Round amounts, mirrored entries and exits, rhythms that become signatures — the patterns that undo private money. Lumen checks every move against them and quietly fixes what it can. You never see a score. You just stay private.',
  },
] as const

const TRUTHS = {
  private: [
    'Who you pay, and how much',
    'Your balance and everything in it',
    'Your spaces, people and history',
    'Receiving money',
  ],
  public: [
    'Adding money (a deposit, checked for hygiene)',
    'Cashing out (warned, tuned, timed)',
    'That the pool itself processed something',
  ],
} as const

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      {/* faint aurora at the very top of the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-60"
        style={{
          background:
            'radial-gradient(60% 100% at 30% 0%, rgba(255, 217, 168, 0.35), transparent 60%), radial-gradient(50% 90% at 70% 0%, rgba(216, 203, 255, 0.32), transparent 60%), radial-gradient(40% 80% at 50% 0%, rgba(255, 201, 214, 0.22), transparent 55%)',
        }}
      />

      <div className="relative mx-auto max-w-[1080px] px-6">
        {/* nav */}
        <nav className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
              <LumenMark size={20} />
            </span>
            <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
          </div>
          <Link href="/app" className="btn btn-ink btn-small">
            Open Lumen
          </Link>
        </nav>

        {/* hero */}
        <header className="grid items-center gap-14 pb-24 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-rule bg-card px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-soft">
              <span className="size-1.5 rounded-full bg-good" />
              Live on Starknet mainnet · STRK20
            </p>
            <h1 className="rise rise-1 mt-6 text-[52px] font-semibold leading-[1.02] tracking-[-0.038em] sm:text-[64px]">
              Your money,
              <br />
              <span className="lumen-text">nobody&rsquo;s business.</span>
            </h1>
            <p className="rise rise-2 mt-6 max-w-[44ch] text-[17px] leading-relaxed text-ink-muted">
              Every payment you make on a public chain becomes a permanent record anyone can read.
              Lumen is money that doesn&rsquo;t do that — pay, receive and save with privacy as the
              default, not a feature.
            </p>
            <div className="rise rise-3 mt-8 flex flex-wrap items-center gap-3">
              <Link href="/app" className="btn btn-ink">
                Open Lumen
                <ArrowRight size={17} />
              </Link>
              <a href="#how" className="btn btn-quiet">
                How it works
              </a>
            </div>
            <p className="rise rise-4 mt-5 text-[13px] text-ink-faint">
              Non-custodial. Your wallet holds every key. No account, no server, no tracking.
            </p>
          </div>

          <div className="relative mx-auto">
            <div className="rise rise-2">
              <PhoneMock />
            </div>
            <div className="rise rise-4 absolute -left-28 top-44 hidden -rotate-6 lg:block">
              <FloatingReceipt />
            </div>
            <div className="rise rise-5 absolute -right-20 bottom-24 hidden rotate-3 lg:block">
              <FloatingGuard />
            </div>
          </div>
        </header>

        {/* the problem */}
        <Reveal>
          <section className="border-t border-rule py-20 text-center">
            <p className="mx-auto max-w-[26ch] text-[30px] font-semibold leading-snug tracking-[-0.025em] sm:text-[36px]">
              Ordinary money movement should not publish a{' '}
              <span className="text-ink-muted line-through decoration-warn/60 decoration-2">
                financial profile
              </span>
              .
            </p>
            <p className="mx-auto mt-5 max-w-[52ch] text-[15.5px] leading-relaxed text-ink-muted">
              Salaries, rent, friends, savings — on a transparent chain they form one connected
              graph with your name on it. Cryptographic pools hide the transaction, but research
              keeps showing the rest leaks anyway: amounts, timing, and habits re-identify users
              even inside shielded systems. The fix has to live in the app layer. This is it.
            </p>
          </section>
        </Reveal>

        {/* features */}
        <section className="grid gap-5 border-t border-rule py-20 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <Reveal key={feature.title}>
              <div className="card h-full px-7 py-8">
                <span className="grid size-11 place-items-center rounded-2xl bg-ink text-white">
                  {feature.icon}
                </span>
                <h3 className="mt-5 text-[19px] font-semibold leading-snug tracking-[-0.02em]">
                  {feature.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{feature.body}</p>
              </div>
            </Reveal>
          ))}
        </section>

        {/* how it works */}
        <Reveal>
          <section id="how" className="border-t border-rule py-20">
            <h2 className="text-center text-[30px] font-semibold tracking-[-0.025em]">
              Three moves. One of them is public.
            </h2>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                {
                  n: '01',
                  icon: <Plus size={18} />,
                  title: 'Add money once',
                  body: 'One deposit into the STRK20 privacy pool. It’s the public step — so Lumen tunes the amount and keeps it separate from everything after.',
                },
                {
                  n: '02',
                  icon: <ShieldCheck size={18} />,
                  title: 'Live privately',
                  body: 'Pay people, get paid, set money aside. No sender, recipient or amount ever appears on-chain. Receipts prove single payments when you choose.',
                },
                {
                  n: '03',
                  icon: <Globe size={18} />,
                  title: 'Cash out rarely',
                  body: 'Leaving is opt-out, warned and checked — the engine breaks amount and timing links before the public sees anything.',
                },
              ].map((step) => (
                <div key={step.n} className="rounded-3xl border border-rule bg-card-soft px-7 py-8">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_1px_2px_rgba(18,18,20,0.06)]">
                      {step.icon}
                    </span>
                    <span className="font-mono text-[12px] text-ink-faint">{step.n}</span>
                  </div>
                  <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.015em]">{step.title}</h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-ink-muted">{step.body}</p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>

        {/* honesty */}
        <Reveal>
          <section className="border-t border-rule py-20">
            <h2 className="text-center text-[30px] font-semibold tracking-[-0.025em]">
              Honest about the boundary
            </h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-center text-[15px] text-ink-muted">
              Privacy tools that overclaim get people hurt. Here is exactly where the line sits.
            </p>
            <div className="mx-auto mt-10 grid max-w-[760px] gap-5 sm:grid-cols-2">
              <div className="glass px-7 py-7">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-glass-ink">
                  <ShieldCheck size={15} />
                  Never public
                </p>
                <ul className="mt-4 space-y-2.5">
                  {TRUTHS.private.map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[14px] text-glass-muted">
                      <Check size={14} className="mt-0.5 flex-none text-glass-ink" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card px-7 py-7">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-warn">
                  <Globe size={15} />
                  Public, by nature
                </p>
                <ul className="mt-4 space-y-2.5">
                  {TRUTHS.public.map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[14px] text-ink-muted">
                      <span className="mt-[7px] size-1.5 flex-none rounded-full bg-warn/50" />
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 border-t border-rule pt-4 text-[12.5px] leading-relaxed text-ink-faint">
                  Both boundary steps run through the silent engine first, so what is public
                  cannot be matched to what is not.
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* closing */}
        <Reveal>
          <section className="border-t border-rule py-24 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink text-white">
              <LumenMark size={24} />
            </span>
            <h2 className="mt-6 text-[36px] font-semibold tracking-[-0.03em]">
              Make privacy your default.
            </h2>
            <p className="mx-auto mt-3 max-w-[40ch] text-[15.5px] text-ink-muted">
              Open Lumen with a privacy-enabled Starknet wallet and move money like it&rsquo;s
              yours alone. Because it is.
            </p>
            <Link href="/app" className="btn btn-ink mt-8">
              Open Lumen
              <ArrowRight size={17} />
            </Link>
          </section>
        </Reveal>

        {/* footer */}
        <footer className="flex flex-col items-center justify-between gap-4 border-t border-rule py-10 text-[13px] text-ink-faint sm:flex-row">
          <p className="flex items-center gap-2">
            <LumenMark size={15} />
            Lumen — private money, by default
          </p>
          <p>
            Built on{' '}
            <a
              href="https://strk20-by-example.org"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-rule-strong underline-offset-2 hover:text-ink"
            >
              STRK20
            </a>{' '}
            · Starknet mainnet · Private Sprint 2026
          </p>
        </footer>
      </div>
    </div>
  )
}
