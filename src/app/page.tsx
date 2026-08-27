'use client'

/**
 * The Lumen landing — one promise, told in black and white.
 *
 * The page sells the product by being the product: the hero phone is the real
 * home surface (same design system, demo data), the receipt is the real
 * receipt card, the guard pill is the real guard pill. Strict monochrome —
 * the only color on the page comes from emoji.
 *
 * Motion: a count-up balance, a pointer-tilted device, floating props, an
 * endless marquee, a climbing "public chain" feed, staggered reveals, and a
 * how-it-works line that draws itself. All CSS-driven; every loop honors
 * prefers-reduced-motion.
 */

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { useReveal } from '@/lib/hooks/use-motion'
import { FilmBackdrop, FilmStill, ScrollFilm, type Beat } from '@/components/landing/film'
import {
  ArrowDown,
  ArrowRight,
  Check,
  Globe,
  LumenMark,
  Plus,
  ShieldCheck,
  Sparkle,
} from '@/components/lumen/icons'

/* ------------------------------------------------------------------ */
/* the film script                                                     */
/* ------------------------------------------------------------------ */

function Line({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto max-w-[19ch] text-[40px] font-semibold leading-[1.03] tracking-[-0.035em] sm:max-w-[22ch] sm:text-[58px]">
      {children}
    </p>
  )
}

function Sub({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-5 max-w-[42ch] text-[16px] leading-relaxed opacity-70 sm:text-[17px]">
      {children}
    </p>
  )
}

const FILM_BEATS: Beat[] = [
  {
    at: [-0.05, 0.1],
    children: (
      <>
        <span className="mb-8 grid size-14 place-items-center rounded-2xl bg-ink text-white">
          <LumenMark size={28} />
        </span>
        <Line>
          Your payments shouldn&rsquo;t become{' '}
          <span className="stroke-text">a map of your life.</span>
        </Line>
        <p className="mt-10 flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Scroll
          <ArrowDown size={13} className="float-hint" />
        </p>
      </>
    ),
  },
  {
    at: [0.12, 0.28],
    children: (
      <>
        <Line>One payment tells nobody anything.</Line>
        <Sub>
          A coffee. Rent. Someone paying you back. On a public chain each one is a permanent,
          searchable fact — and on its own, harmless.
        </Sub>
      </>
    ),
  },
  {
    at: [0.3, 0.46],
    children: (
      <>
        <Line>They don&rsquo;t stay on their own.</Line>
        <Sub>
          Every address you touch is a line drawn between two facts. Nobody has to break anything.
          The graph builds itself, in public, forever.
        </Sub>
      </>
    ),
  },
  {
    at: [0.5, 0.62],
    children: (
      <>
        <Line>And then it can speak.</Line>
        <Sub>
          These are not the amounts. These are the sentences a stranger can write about you once
          the amounts are joined up.
        </Sub>
      </>
    ),
  },
  {
    at: [0.655, 0.72],
    invert: true,
    children: <Line>Lumen holds the whole picture.</Line>,
  },
  {
    at: [0.735, 0.85],
    invert: true,
    children: (
      <>
        <Line>So nothing else can.</Line>
        <Sub>
          Money still reaches you from links, pages and other apps. It arrives into one account
          whose only job is making sure those arrivals never line up.
        </Sub>
      </>
    ),
  },
  {
    at: [0.93, 1.0],
    children: (
      <>
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          The same account, seen from outside
        </p>
        <Line>Nothing to read.</Line>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/app" className="btn btn-ink">
            Open Lumen
            <ArrowRight size={17} />
          </Link>
          <a href="#how" className="btn btn-quiet">
            How it works
          </a>
        </div>
        <p className="mt-5 text-[13px] text-ink-faint">
          Non-custodial, on Starknet mainnet. Your wallet holds every key.
        </p>
      </>
    ),
  },
]

/* ------------------------------------------------------------------ */
/* motion helpers                                                      */
/* ------------------------------------------------------------------ */

function Reveal({
  children,
  className = '',
  stagger = false,
}: {
  children: ReactNode
  className?: string
  stagger?: boolean
}) {
  const { ref, shown } = useReveal<HTMLDivElement>({ threshold: 0.16 })
  return (
    <div
      ref={ref}
      className={`${stagger ? 'reveal-stagger' : 'reveal'} ${shown ? 'shown' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

function InboxArtifact() {
  return (
    <div className="card px-6 py-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Incoming
      </p>
      <div className="mt-3 space-y-2">
        {[
          { from: 'A claim link', amount: '52.88 USDC', note: 'from someone with no wallet' },
          { from: 'Your page', amount: '800.00 USDC', note: 'a client paid the invoice' },
          { from: 'A team split', amount: '212.47 USDC', note: 'one of four, nobody sees the rest' },
        ].map((row) => (
          <div
            key={row.from}
            className="flex items-center justify-between gap-3 rounded-2xl border border-rule bg-card-soft px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[11.5px] font-semibold">{row.from}</p>
              <p className="truncate text-[9.5px] text-ink-muted">{row.note}</p>
            </div>
            <span className="tabular flex-none text-[12px] font-semibold">+{row.amount}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-rule pt-3">
        <ShieldCheck size={13} />
        <p className="text-[10.5px] text-ink-muted">
          Three sources. No thread joins them — not even for us.
        </p>
      </div>
    </div>
  )
}

function JournalArtifact() {
  return (
    <div className="card px-6 py-6">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold">
        <Sparkle size={13} />
        What Lumen did
      </p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { n: '12', label: 'moves made privately' },
          { n: '5', label: 'amounts rewritten' },
          { n: '1', label: 'flagged for you' },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="tabular text-[26px] font-semibold leading-none">{stat.n}</p>
            <p className="mt-1 text-[9.5px] leading-tight text-ink-muted">{stat.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 border-t border-rule pt-3">
        {[
          { head: 'Adjusted the amount so the deposit blends in', sub: '100 → 99.889991 USDC' },
          { head: 'Held a cash-out for a quieter window', sub: 'it mirrored Tuesday’s deposit' },
        ].map((row) => (
          <div key={row.head} className="flex gap-2">
            <span className="mt-0.5 grid size-4 flex-none place-items-center rounded-full bg-sunk">
              <Check size={9} strokeWidth={3} />
            </span>
            <div>
              <p className="text-[10.5px] font-semibold leading-tight">{row.head}</p>
              <p className="tabular text-[9.5px] text-ink-muted">{row.sub}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-ink-faint">You were not asked. You were not there.</p>
    </div>
  )
}

function ObserverArtifact() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-rule px-5 py-2.5">
        <Globe size={12} />
        <p className="text-[10.5px] font-semibold">What the world sees</p>
      </div>
      <div className="px-5 py-5">
        <p className="text-[11px] text-ink-muted">Some wallet</p>
        <div className="mt-3 space-y-2.5">
          {['Private balance', 'Who paid them', 'Who they pay', 'Payment history'].map((label) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <span className="text-[11.5px] text-ink-muted">{label}</span>
              <span className="inline-block h-2.5 w-20 rounded-sm bg-sunk" />
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl bg-card-soft px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold">
            <ShieldCheck size={12} />
            14 private operations — invisible
          </p>
          <p className="mt-1 text-[9.5px] leading-snug text-ink-muted">
            Never published. Not hidden in a database — never published at all.
          </p>
        </div>
      </div>
    </div>
  )
}

function ClaimArtifact() {
  return (
    <div className="card px-6 py-6">
      <div className="mx-auto w-fit rounded-2xl border border-rule bg-card-soft px-3 py-2 font-mono text-[10px] text-ink-muted">
        lumen…/claim<span className="text-ink-faint">#s3cr3t-only-in-the-link</span>
      </div>
      <div className="mx-auto mt-3 h-5 w-px bg-rule-strong" />
      <div className="card mx-auto mt-3 w-[230px] overflow-hidden">
        <div className="h-1 bg-ink" />
        <div className="px-4 py-4 text-center">
          <p className="text-[9.5px] font-semibold text-ink-muted">Shariq sent you</p>
          <p className="tabular mt-1 text-[22px] font-semibold tracking-[-0.02em]">52.88 USDC</p>
          <p className="mt-1 text-[9px] text-ink-muted">&ldquo;Coffee money&rdquo;</p>
          <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[8.5px] font-semibold">
            <ShieldCheck size={9} />
            Claims privately — no trace of you
          </span>
          <span className="btn btn-ink mt-3 !h-9 w-full !text-[11px]">Claim privately</span>
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        No wallet? The page walks them through two minutes of setup — then the money is theirs.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="relative overflow-x-clip">
      {/* nav */}
      <nav
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled ? 'nav-blur border-b border-rule' : ''
        }`}
      >
        <div className="film-aware mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="film-mark grid size-9 place-items-center rounded-xl bg-ink text-white transition-colors duration-200">
              <LumenMark size={20} />
            </span>
            <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
          </div>
          <Link href="/app" className="btn btn-ink btn-small transition-colors duration-200">
            Open Lumen
          </Link>
        </div>
      </nav>

      {/* ACT I — the film. Pinned canvas, scrubbed by scroll. */}
      <ScrollFilm viewports={8} beats={FILM_BEATS} />

      {/* ACT II — the same world, quieter, with the product in it. */}
      <div className="relative">
        <FilmBackdrop className="absolute inset-x-0 top-0 -z-10 opacity-70" />
        <div className="relative mx-auto max-w-[1120px] px-6">

        <section className="py-28">
          <Reveal>
            <h2 className="text-center text-[34px] font-semibold tracking-[-0.03em] sm:text-[42px]">
              An account with a job.
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-center text-[15.5px] leading-relaxed text-ink-muted">
              A wallet holds a balance and waits. This holds your unlinkability — across every
              place money reaches you, and across time.
            </p>
          </Reveal>

          <div className="mt-20 space-y-32 sm:space-y-40">
            <Reveal className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
              <div className="lg:sticky lg:top-[26vh]">
                <p className="chapter">01</p>
                <h3 className="mt-3 text-[30px] font-semibold leading-[1.12] tracking-[-0.028em] sm:text-[36px]">
                  Everything lands in one place. Nothing lines up.
                </h3>
                <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-ink-muted">
                  A claim link on Monday, your page on Wednesday, a split from a team on Friday.
                  Each one is private on its own — and together they are exactly how a profile
                  gets built. Lumen is the account that keeps them from adding up.
                </p>
              </div>
              <InboxArtifact />
            </Reveal>

            <Reveal className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
              <div className="lg:sticky lg:top-[26vh] lg:order-2">
                <p className="chapter">02</p>
                <h3 className="mt-3 text-[30px] font-semibold leading-[1.12] tracking-[-0.028em] sm:text-[36px]">
                  It works while you&rsquo;re gone.
                </h3>
                <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-ink-muted">
                  Before anything is signed, the engine checks the move against everything you
                  have already done — round amounts, mirrored exits, rhythms that become a
                  signature — and rewrites what would leak. Then it writes down what it did. No
                  score to read. Just a log of a thing that acted on your behalf.
                </p>
              </div>
              <JournalArtifact />
            </Reveal>

            <Reveal className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
              <div className="lg:sticky lg:top-[26vh]">
                <p className="chapter">03</p>
                <h3 className="mt-3 text-[30px] font-semibold leading-[1.12] tracking-[-0.028em] sm:text-[36px]">
                  See precisely what the world sees.
                </h3>
                <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-ink-muted">
                  One tap redacts the whole account to what any explorer, indexer or analyst can
                  ever know about you. Not a promise about privacy — the thing itself, on screen,
                  after every move you make.
                </p>
              </div>
              <ObserverArtifact />
            </Reveal>

            <Reveal className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
              <div className="lg:sticky lg:top-[26vh] lg:order-2">
                <p className="chapter">04</p>
                <h3 className="mt-3 text-[30px] font-semibold leading-[1.12] tracking-[-0.028em] sm:text-[36px]">
                  Money gets in however it needs to.
                </h3>
                <p className="mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-ink-muted">
                  Send a link to someone with no wallet. Put a page in your bio. Pay four people
                  at once as a single operation nobody can split apart. The plumbing is ordinary
                  on purpose — what matters is where it lands.
                </p>
              </div>
              <ClaimArtifact />
            </Reveal>
          </div>
        </section>

        {/* how it works */}
        <section className="border-t border-rule py-28">
          <Reveal>
            <h2 className="text-center text-[34px] font-semibold tracking-[-0.03em] sm:text-[42px]">
              Three moves. One is public.
            </h2>

            <div className="relative mt-16">
              <svg
                className="absolute left-0 right-0 top-9 hidden h-px w-full md:block"
                aria-hidden
                preserveAspectRatio="none"
                viewBox="0 0 100 1"
              >
                <line
                  x1="8"
                  y1="0.5"
                  x2="92"
                  y2="0.5"
                  stroke="var(--color-rule-strong)"
                  strokeWidth="1"
                  pathLength="1"
                  className="draw-line"
                />
              </svg>
              <div className="relative grid gap-10 md:grid-cols-3">
                {[
                  {
                    icon: <Plus size={20} />,
                    title: 'Add money once',
                    body: 'One deposit into the pool. It’s the public step — so the engine tunes the amount and keeps it separate from everything after.',
                  },
                  {
                    icon: <ShieldCheck size={20} />,
                    title: 'Live privately',
                    body: 'Pay people, get paid, set money aside. No sender, recipient or amount ever appears on-chain.',
                  },
                  {
                    icon: <Globe size={20} />,
                    title: 'Cash out rarely',
                    body: 'Leaving is opt-out, warned and checked — amount and timing links get broken before the public sees anything.',
                  },
                ].map((step, index) => (
                  <div key={step.title} className="text-center">
                    <span className="relative z-10 mx-auto grid size-[72px] place-items-center rounded-full border border-rule bg-card text-ink shadow-[0_1px_2px_rgba(18,18,20,0.05)]">
                      {step.icon}
                    </span>
                    <p className="mt-5 font-mono text-[11px] text-ink-faint">0{index + 1}</p>
                    <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.015em]">
                      {step.title}
                    </h3>
                    <p className="mx-auto mt-2.5 max-w-[34ch] text-[14px] leading-relaxed text-ink-muted">
                      {step.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* honesty */}
        <section className="border-t border-rule py-28">
          <Reveal>
            <h2 className="text-center text-[34px] font-semibold tracking-[-0.03em]">
              Honest about the boundary
            </h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-center text-[15px] text-ink-muted">
              Privacy tools that overclaim get people hurt. Here is exactly where the line sits.
            </p>
          </Reveal>
          <Reveal stagger className="mx-auto mt-12 grid max-w-[780px] gap-6 sm:grid-cols-2">
            <div className="glass px-7 py-7">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-glass-ink">
                <ShieldCheck size={15} />
                Never public
              </p>
              <ul className="mt-4 space-y-2.5">
                {[
                  'Who you pay, and how much',
                  'Your balance and everything in it',
                  'Your spaces, people and history',
                  'Receiving money',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[14px] text-glass-muted">
                    <Check size={14} className="mt-0.5 flex-none text-glass-ink" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card px-7 py-7">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Globe size={15} />
                Public, by nature
              </p>
              <ul className="mt-4 space-y-2.5">
                {[
                  'Adding money (a deposit, checked for hygiene)',
                  'Cashing out (warned, tuned, timed)',
                  'That the pool itself processed something',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[14px] text-ink-muted">
                    <span className="mt-[7px] size-1.5 flex-none rounded-full bg-ink" />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-rule pt-4 text-[12.5px] leading-relaxed text-ink-faint">
                Both boundary steps run through the silent engine first, so what is public cannot
                be matched to what is not.
              </p>
            </div>
          </Reveal>
        </section>
        </div>
      </div>

      {/* closing band — the film's last frame, held under the ask */}
      <section className="relative isolate overflow-hidden bg-ink py-28 text-white">
        <FilmStill
          at={0.7}
          className="pointer-events-none absolute inset-0 -z-10 size-full opacity-60"
        />
        <Reveal className="relative mx-auto max-w-[1120px] px-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-ink">
            <LumenMark size={24} />
          </span>
          <h2 className="mx-auto mt-7 max-w-[18ch] text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[52px]">
            Make privacy your default.
          </h2>
          <p className="mx-auto mt-4 max-w-[40ch] text-[15.5px] leading-relaxed text-white/60">
            Open Lumen with a privacy-enabled Starknet wallet and move money like it&rsquo;s yours
            alone. Because it is.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/app"
              className="btn bg-white text-ink hover:bg-white/90"
            >
              Open Lumen
              <ArrowRight size={17} />
            </Link>
            <a href="#how" className="btn border border-white/25 text-white hover:bg-white/10">
              How it works
            </a>
          </div>
        </Reveal>
      </section>

      {/* footer */}
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1120px] flex-col items-center justify-between gap-4 px-6 py-10 text-[13px] text-ink-faint sm:flex-row">
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
        </div>
      </footer>
    </div>
  )
}
