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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { usePrefersReducedMotion, useReveal } from '@/lib/hooks/use-motion'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Eye,
  Globe,
  LumenMark,
  Plus,
  ShieldCheck,
  Sparkle,
} from '@/components/lumen/icons'

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

/** Count from 0 to `target` once the element is on screen. */
function useCountUp(target: number, ms = 1400): { ref: (node: HTMLElement | null) => void; value: number } {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(0)
  const started = useRef(false)

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || started.current) return
      if (typeof IntersectionObserver === 'undefined' || reduced) {
        started.current = true
        setValue(target)
        return
      }
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return
        started.current = true
        observer.disconnect()
        const t0 = performance.now()
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / ms)
          const eased = 1 - Math.pow(1 - p, 4)
          setValue(target * eased)
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      observer.observe(node)
    },
    [target, ms, reduced],
  )

  return { ref, value }
}

/** Pointer-follow tilt for the hero device. Inert under reduced motion. */
function useTilt(max = 7) {
  const reduced = usePrefersReducedMotion()
  const [style, setStyle] = useState<{ transform: string }>({ transform: '' })

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduced || event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    setStyle({
      transform: `perspective(1100px) rotateY(${x * max}deg) rotateX(${-y * max}deg)`,
    })
  }

  const onLeave = () => setStyle({ transform: '' })
  return { style, onMove, onLeave }
}

/* ------------------------------------------------------------------ */
/* hero device — the real home surface with demo data                  */
/* ------------------------------------------------------------------ */

function PhoneMock() {
  const balance = useCountUp(2841.36)
  const [whole, cents] = balance.value.toFixed(2).split('.')

  return (
    <div className="w-[330px] rounded-[44px] border border-rule bg-canvas p-2.5 shadow-[0_48px_110px_-24px_rgba(18,18,20,0.4)]">
      <div className="overflow-hidden rounded-[36px] bg-canvas px-4 pb-6 pt-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <span className="grid size-6 place-items-center rounded-lg bg-ink text-white">
              <LumenMark size={13} />
            </span>
            <span className="text-[13px] font-semibold">Lumen</span>
          </div>
          <span className="size-6 rounded-full bg-card shadow-[0_1px_2px_rgba(18,18,20,0.08)]" />
        </div>

        <div className="glass mt-3 px-5 pb-5 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[10.5px] font-medium text-glass-muted">Your money</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-glass-ink">
              <ShieldCheck size={9} />
              Private
            </span>
          </div>
          <p
            ref={balance.ref}
            className="tabular mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em]"
          >
            ${Number(whole).toLocaleString('en-US')}
            <span className="align-top text-[17px] opacity-60">.{cents}</span>
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
                  row.pub ? 'bg-ink text-white' : 'bg-sunk text-ink-soft'
                }`}
              >
                {row.pub ? <Plus size={11} /> : <ArrowUpRight size={11} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10.5px] font-semibold">{row.title}</span>
                <span className={`block text-[9px] ${row.pub ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
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

function FloatingReceipt() {
  return (
    <div className="card w-[212px] overflow-hidden">
      <div className="h-1 bg-ink" />
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
    <div className="card w-[236px] px-3.5 py-3">
      <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[9.5px] font-semibold text-ink">
        <Sparkle size={10} />
        Tuned for privacy
      </span>
      <ul className="mt-2.5 space-y-1.5">
        {['No public record', 'Amount blends in — adjusted', 'No schedule published'].map((line) => (
          <li key={line} className="flex items-center gap-1.5 text-[9.5px] font-medium text-ink-soft">
            <span className="grid size-3.5 place-items-center rounded-full bg-ink text-white">
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
/* the exposure feed — what a transparent chain publishes              */
/* ------------------------------------------------------------------ */

const FEED_ROWS = [
  { from: '0x7a31…04ec', to: '0x99d2…b7f1', amount: '$3,200.00', tag: 'salary?' },
  { from: '0x99d2…b7f1', to: '0x40c8…11aa', amount: '$938.12', tag: 'rent, again' },
  { from: '0x99d2…b7f1', to: '0x8be1…77cd', amount: '$212.47', tag: 'same friend, weekly' },
  { from: '0x99d2…b7f1', to: '0xcc09…3d21', amount: '$85.00', tag: 'clinic' },
  { from: '0x99d2…b7f1', to: '0x40c8…11aa', amount: '$938.12', tag: 'rent, again' },
  { from: '0x99d2…b7f1', to: '0x1f77…9e02', amount: '$1,500.00', tag: 'moved to savings' },
  { from: '0x2d40…8c1b', to: '0x99d2…b7f1', amount: '$450.00', tag: 'side income' },
  { from: '0x99d2…b7f1', to: '0x8be1…77cd', amount: '$212.47', tag: 'same friend, weekly' },
] as const

function ExposureFeed() {
  const rows = [...FEED_ROWS, ...FEED_ROWS]
  return (
    <div className="feed-mask h-[330px] overflow-hidden">
      <div className="feed-scroll space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-3 rounded-2xl border border-rule bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] text-ink-soft">
                {row.from} <span className="text-ink-faint">→</span> {row.to}
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-ink-muted">{row.tag}</p>
            </div>
            <span className="tabular flex-none text-[13px] font-semibold">{row.amount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* feature artifacts                                                   */
/* ------------------------------------------------------------------ */

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
          <p className="mt-1 text-[9px] text-ink-muted">&ldquo;Coffee money ☕️&rdquo;</p>
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

function BoundaryArtifact() {
  return (
    <div className="card px-6 py-6">
      <div className="flex items-center justify-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-ink text-white">
          <LumenMark size={22} />
        </span>
        <span className="text-[12px] font-semibold text-ink-muted">you, once</span>
      </div>
      <div className="mx-auto mt-4 h-6 w-px bg-rule-strong" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          { emoji: '🏠', name: 'Landlord', sees: 'rent only' },
          { emoji: '🌊', name: 'Amara', sees: 'dinners only' },
          { emoji: '💼', name: 'Client', sees: 'invoices only' },
        ].map((person) => (
          <div key={person.name} className="rounded-2xl border border-rule bg-card-soft px-3 py-4 text-center">
            <span className="text-[22px]">{person.emoji}</span>
            <p className="mt-1.5 text-[12.5px] font-semibold">{person.name}</p>
            <p className="text-[10.5px] text-ink-muted">sees {person.sees}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        None of them can see each other, your balance, or your history.
      </p>
    </div>
  )
}

function TuningArtifact() {
  return (
    <div className="card px-6 py-6">
      <div className="flex items-center justify-center gap-4">
        <div className="text-center">
          <p className="text-[10.5px] font-semibold text-ink-muted">You type</p>
          <p className="tabular mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink-faint line-through decoration-2">
            100
          </p>
        </div>
        <ArrowRight size={18} className="text-ink-muted" />
        <div className="text-center">
          <p className="text-[10.5px] font-semibold text-ink-muted">Lumen sends</p>
          <p className="tabular mt-1 text-[26px] font-semibold tracking-[-0.02em]">99.889991</p>
        </div>
      </div>
      <div className="mx-auto mt-5 w-fit">
        <FloatingGuard />
      </div>
      <p className="mt-4 text-center text-[11px] text-ink-faint">
        Round numbers, mirrored exits and rigid rhythms are how private money gets traced. The
        engine fixes them before your wallet ever signs.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

const TICKER = [
  'No public sender',
  'No public amount',
  'No public history',
  'No account',
  'No server',
  'No tracking',
  'Starknet mainnet',
] as const

export default function Landing() {
  const tilt = useTilt()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="relative overflow-hidden">
      {/* nav */}
      <nav
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled ? 'nav-blur border-b border-rule' : ''
        }`}
      >
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-ink text-white">
              <LumenMark size={20} />
            </span>
            <span className="text-[19px] font-semibold tracking-[-0.02em]">Lumen</span>
          </div>
          <Link href="/app" className="btn btn-ink btn-small">
            Open Lumen
          </Link>
        </div>
      </nav>

      <div className="relative mx-auto max-w-[1120px] px-6">
        {/* hero */}
        <header className="grid min-h-[92vh] items-center gap-16 pb-16 pt-32 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-rule bg-card px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-soft">
              <span className="size-1.5 rounded-full bg-ink" />
              Live on Starknet mainnet · STRK20
            </p>
            <h1 className="rise rise-1 mt-7 text-[56px] font-semibold leading-[0.98] tracking-[-0.04em] sm:text-[76px]">
              Your money,
              <br />
              <span className="stroke-text">nobody&rsquo;s</span>
              <br />
              business.
            </h1>
            <p className="rise rise-2 mt-7 max-w-[44ch] text-[17px] leading-relaxed text-ink-muted">
              Every payment on a public chain becomes a permanent record anyone can read. Lumen is
              money that doesn&rsquo;t do that — pay anyone with a link, even someone with no
              wallet; get paid through your page; save and convert — with privacy as the default,
              not a feature.
            </p>
            <div className="rise rise-3 mt-9 flex flex-wrap items-center gap-3">
              <Link href="/app" className="btn btn-ink">
                Open Lumen
                <ArrowRight size={17} />
              </Link>
              <Link href="/app?preview" className="btn btn-quiet">
                <Eye size={16} />
                Try the walkthrough
              </Link>
            </div>
            <p className="rise rise-4 mt-5 text-[13px] text-ink-faint">
              Non-custodial. Your wallet holds every key. Nothing to sign up for.
            </p>
          </div>

          <div className="relative mx-auto hidden md:block">
            <div
              className="rise rise-2 transition-transform duration-300 ease-out will-change-transform"
              style={tilt.style}
              onPointerMove={tilt.onMove}
              onPointerLeave={tilt.onLeave}
            >
              <PhoneMock />
            </div>
            <div
              className="rise rise-4 float-slow absolute -left-32 top-48 hidden lg:block"
              style={{ '--float-tilt': '-5deg' } as React.CSSProperties}
            >
              <FloatingReceipt />
            </div>
            <div
              className="rise rise-5 float-slower absolute -right-24 bottom-20 hidden lg:block"
              style={{ '--float-tilt': '3deg' } as React.CSSProperties}
            >
              <FloatingGuard />
            </div>
          </div>
        </header>
      </div>

      {/* ticker */}
      <div className="border-y border-rule bg-card py-3.5" aria-hidden>
        <div className="marquee">
          {[0, 1].map((half) => (
            <div key={half} className="flex items-center">
              {TICKER.map((item) => (
                <span
                  key={`${half}-${item}`}
                  className="flex items-center gap-3 whitespace-nowrap px-5 text-[12.5px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
                >
                  {item}
                  <span className="size-1 rounded-full bg-rule-strong" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-[1120px] px-6">
        {/* the exposure demo */}
        <section className="py-28">
          <Reveal>
            <h2 className="mx-auto max-w-[24ch] text-center text-[34px] font-semibold leading-tight tracking-[-0.03em] sm:text-[42px]">
              A public chain is a feed of your life.
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-center text-[15.5px] leading-relaxed text-ink-muted">
              Salaries, rent, friends, savings — one connected graph, readable by anyone, forever.
              Here is the same life, twice.
            </p>
          </Reveal>

          <Reveal stagger className="mt-14 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[28px] border border-rule bg-card-soft p-6">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
                <Globe size={15} />
                On a transparent chain
              </p>
              <div className="mt-5">
                <ExposureFeed />
              </div>
              <p className="mt-4 text-[12px] text-ink-faint">
                Live guesswork like this is an industry. Address labels, exchange records and one
                slip connect it to your name.
              </p>
            </div>

            <div className="glass flex flex-col p-6">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-glass-ink">
                <ShieldCheck size={15} />
                The same life on Lumen
              </p>
              <div className="mt-5 flex flex-1 flex-col justify-center space-y-2.5">
                {[
                  { label: 'Salary received', value: 'not visible' },
                  { label: 'Rent, paid monthly', value: 'not visible' },
                  { label: 'Friends, savings, clinic', value: 'not visible' },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between rounded-2xl bg-white/6 px-4 py-3.5"
                  >
                    <span className="text-[13.5px] text-glass-muted">{row.label}</span>
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-glass-ink">
                      {row.value}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl border border-white/12 px-4 py-3.5">
                  <span className="text-[13.5px] text-glass-muted">A deposit, once</span>
                  <span className="tabular text-[13px] font-semibold text-glass-ink">public</span>
                </div>
              </div>
              <p className="mt-4 text-[12px] text-glass-faint">
                One boundary crossing — checked and tuned so even it points nowhere.
              </p>
            </div>
          </Reveal>
        </section>

        {/* features */}
        <section className="border-t border-rule py-28">
          <Reveal>
            <h2 className="text-center text-[34px] font-semibold tracking-[-0.03em] sm:text-[42px]">
              What no wallet does.
            </h2>
          </Reveal>

          <div className="mt-16 space-y-24">
            <Reveal className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="font-mono text-[12px] text-ink-faint">01</p>
                <h3 className="mt-2 text-[26px] font-semibold leading-snug tracking-[-0.02em]">
                  Pay anyone on Earth. Wallet optional.
                </h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
                  A claim link parks money behind a secret that travels only inside the link —
                  no server ever sees it. Whoever you send it to claims privately whenever they
                  arrive, with a brand-new wallet if they like, and lands already private.
                  Unclaimed after a week? Take it back. The one wall every crypto payment hits —
                  &ldquo;first, install all of this&rdquo; — is gone.
                </p>
              </div>
              <ClaimArtifact />
            </Reveal>

            <Reveal className="grid items-center gap-10 lg:grid-cols-2">
              <div className="lg:order-2">
                <p className="font-mono text-[12px] text-ink-faint">02</p>
                <h3 className="mt-2 text-[26px] font-semibold leading-snug tracking-[-0.02em]">
                  Every relationship gets its own boundary.
                </h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
                  Your landlord, your friends, your clients — each sees only what you send them.
                  Nothing connects one relationship to another, and the engine keeps it that way
                  behaviourally too: a distinctive amount or a rigid rhythm that would bridge two
                  boundaries gets caught before it happens.
                </p>
              </div>
              <BoundaryArtifact />
            </Reveal>

            <Reveal className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="font-mono text-[12px] text-ink-faint">03</p>
                <h3 className="mt-2 text-[26px] font-semibold leading-snug tracking-[-0.02em]">
                  Prove a payment. Publish nothing.
                </h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
                  Every payment mints a receipt carrying exactly one fact — this amount, this
                  moment, settled on-chain — that you hand to exactly one person. The settlement
                  transaction is publicly verifiable yet names no sender, no recipient, no amount.
                  Private money you can still do business with.
                </p>
              </div>
              <div className="mx-auto">
                <FloatingReceipt />
              </div>
            </Reveal>

            <Reveal className="grid items-center gap-10 lg:grid-cols-2">
              <div className="lg:order-2">
                <p className="font-mono text-[12px] text-ink-faint">04</p>
                <h3 className="mt-2 text-[26px] font-semibold leading-snug tracking-[-0.02em]">
                  A silent engine watches the leaks.
                </h3>
                <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
                  Research on shielded pools keeps finding the same thing: the cryptography holds,
                  and behaviour betrays people anyway. Lumen runs those exact attacks against your
                  own next move — and quietly rewrites what would leak. You never see a score. You
                  just stay private.
                </p>
              </div>
              <TuningArtifact />
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

      {/* closing band */}
      <section className="bg-ink py-28 text-white">
        <Reveal className="mx-auto max-w-[1120px] px-6 text-center">
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
            <Link href="/app?preview" className="btn border border-white/25 text-white hover:bg-white/10">
              Try the walkthrough
            </Link>
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
