'use client'

/**
 * The application shell.
 *
 * Three panes on a wide screen: a quiet sidebar that replaces every hamburger
 * in the product, the content, and the observer's view kept permanently on the
 * right so the thesis needs no interaction. On a phone the sidebar becomes a
 * bottom bar and the observer moves behind the top pill.
 *
 * Deliberately not a dashboard: no widget grid, no tables, no dense toolbar.
 * The sidebar is typography and hairlines rather than a slab of chrome, the
 * content keeps a reading measure instead of stretching edge to edge, and the
 * one dark object on screen is still the money. Infrastructure underneath,
 * something a person wants to open on top.
 */

import type { ReactNode } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { shortAddress } from '@/lib/lumen/people'
import {
  ArrowUpRight,
  Clock,
  Eye,
  Globe,
  LinkIcon,
  LumenMark,
  Plus,
  Receipt as ReceiptIcon,
  ShieldCheck,
  Sparkle,
} from './icons'
import type { SheetRoute } from './routes'

export interface NavItem {
  id: string
  label: string
  /** Bottom-bar label — chosen, not derived, so nothing truncates to "What". */
  short: string
  icon: ReactNode
  /** Sheets open over the content; `home` just clears any open sheet. */
  route?: SheetRoute
  /** Shown as a count chip when non-zero. */
  badge?: number
}

/**
 * The primary navigation. Money in, money out, then the two surfaces that are
 * the product's own argument — what it did, and what it did not publish.
 */
export function navItems(): NavItem[] {
  return [
    // Send leads because Send is the product; everything under it is support.
    { id: 'home', label: 'Send', short: 'Send', icon: <ArrowUpRight size={17} /> },
    { id: 'pay', label: 'Send a link', short: 'Link', icon: <LinkIcon size={17} />, route: { kind: 'pay' } },
    {
      id: 'my-page',
      label: 'Get paid',
      short: 'Get paid',
      icon: <ReceiptIcon size={17} />,
      route: { kind: 'my-page' },
    },
    { id: 'add', label: 'Add money', short: 'Add', icon: <Plus size={17} />, route: { kind: 'add' } },
    {
      id: 'stake',
      label: 'Earn on Bitcoin',
      short: 'Earn',
      icon: <ShieldCheck size={17} />,
      route: { kind: 'stake' },
    },
    {
      id: 'journal',
      label: 'What Lumen did',
      short: 'Log',
      icon: <Sparkle size={17} />,
      route: { kind: 'journal' },
    },
    {
      id: 'links',
      label: 'Links you sent',
      short: 'Links',
      icon: <LinkIcon size={17} />,
      route: { kind: 'links' },
    },
    { id: 'activity', label: 'Activity', short: 'Activity', icon: <Clock size={17} />, route: { kind: 'activity' } },
  ]
}

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: NavItem
  active: boolean
  onSelect: (item: NavItem) => void
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      aria-current={active ? 'page' : undefined}
      className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors ${
        active
          ? 'bg-card text-ink shadow-[0_1px_2px_rgba(18,18,20,0.06)]'
          : 'text-ink-muted hover:bg-card/60 hover:text-ink'
      }`}
    >
      <span className="flex-none">{item.icon}</span>
      <span className="flex-1 text-left">{item.label}</span>
      {item.badge ? (
        <span className="tabular grid h-5 min-w-5 flex-none place-items-center rounded-full bg-ink px-1.5 text-[11px] font-semibold text-white">
          {item.badge}
        </span>
      ) : null}
    </button>
  )
}

export function AppShell({
  children,
  rail,
  activeId,
  observer,
  onObserver,
  open,
}: {
  children: ReactNode
  /** The observer panel, rendered in the right rail on wide screens. */
  rail: ReactNode
  activeId: string
  observer: boolean
  onObserver: (next: boolean) => void
  open: (route: SheetRoute) => void
}) {
  const { address, walletName, registered } = useLumen()
  const items = navItems()

  const select = (item: NavItem) => {
    if (item.route) open(item.route)
    else onObserver(false)
  }

  return (
    <div className="min-h-dvh">
      {/* ---------------- sidebar (wide screens only) ---------------- */}
      <aside className="fixed inset-y-0 left-0 hidden w-[236px] flex-col border-r border-rule px-4 py-6 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-white">
            <LumenMark size={17} />
          </span>
          <span className="text-[16px] font-semibold tracking-[-0.02em]">Lumen</span>
        </div>

        <nav className="mt-8 flex flex-col gap-0.5">
          {items.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={!observer && activeId === item.id}
              onSelect={select}
            />
          ))}
        </nav>

        <div className="mt-auto">
          <button
            onClick={() => open({ kind: 'out' })}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-ink-muted transition-colors hover:bg-card/60 hover:text-ink"
          >
            <Globe size={17} />
            <span className="flex-1 text-left">Cash out</span>
          </button>

          <button
            onClick={() => open({ kind: 'menu' })}
            className="mt-2 flex w-full items-center gap-2.5 rounded-2xl border border-rule bg-card px-3 py-2.5 text-left transition-colors hover:bg-card-soft"
          >
            <span className="grid size-7 flex-none place-items-center rounded-full bg-sunk text-ink">
              <ShieldCheck size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold">
                {walletName ?? 'Wallet'}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-ink-muted">
                {address ? shortAddress(address) : ''}
              </span>
            </span>
          </button>

          {registered === false ? (
            <p className="mt-2 px-3 text-[11px] leading-snug text-ink-faint">
              Not active yet — it starts the first time money moves.
            </p>
          ) : null}
        </div>
      </aside>

      {/* ---------------- main column ---------------- */}
      <div className="lg:pl-[236px]">
        {/* the top pill: the product's own argument, always one tap away */}
        <div className="sticky top-0 z-30 nav-blur">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-5 py-3.5 lg:px-8">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-white">
                <LumenMark size={16} />
              </span>
              <span className="hidden text-[15px] font-semibold tracking-[-0.02em] sm:inline">
                Lumen
              </span>
            </div>

            <div className="mx-auto grid flex-none grid-cols-2 gap-1 rounded-full bg-sunk p-1">
              <button
                onClick={() => onObserver(false)}
                aria-pressed={!observer}
                className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-all duration-300 sm:px-4 ${
                  !observer ? 'bg-card shadow-[0_1px_3px_rgba(18,18,20,0.1)]' : 'text-ink-muted'
                }`}
              >
                <Eye size={12} />
                Your view
              </button>
              <button
                onClick={() => onObserver(true)}
                aria-pressed={observer}
                className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-all duration-300 sm:px-4 ${
                  observer
                    ? 'bg-ink text-white shadow-[0_1px_3px_rgba(18,18,20,0.2)]'
                    : 'text-ink-muted'
                }`}
              >
                <Globe size={12} />
                <span className="hidden sm:inline">What the world sees</span>
                <span className="sm:hidden">World</span>
              </button>
            </div>

            <button
              onClick={() => open({ kind: 'menu' })}
              aria-label="Account"
              className="grid size-8 flex-none place-items-center rounded-full bg-card text-ink-soft shadow-[0_1px_2px_rgba(18,18,20,0.06)] lg:invisible"
            >
              <ShieldCheck size={15} />
            </button>
          </div>
        </div>

        {/* content + the observer rail */}
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 pb-28 pt-2 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 lg:pb-16">
          <main className="w-full min-w-0 max-w-[560px]">{children}</main>
          <aside className="hidden lg:block">
            <div className="sticky top-[76px]">
              <p className="mb-3 flex items-center gap-2 px-1 text-[12.5px] font-semibold text-ink-muted">
                <Globe size={13} />
                What the world sees
              </p>
              {rail}
            </div>
          </aside>
        </div>
      </div>

      {/* ---------------- bottom bar (phones) ---------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-rule nav-blur lg:hidden">
        <div className="mx-auto flex max-w-[560px] items-stretch justify-between px-2 py-1.5">
          {items.slice(0, 5).map((item) => {
            const active = !observer && activeId === item.id
            return (
              <button
                key={item.id}
                onClick={() => select(item)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-medium transition-colors ${
                  active ? 'text-ink' : 'text-ink-faint'
                }`}
              >
                <span className="relative">
                  {item.icon}
                  {item.badge ? (
                    <span className="tabular absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[9.5px] font-semibold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="truncate">{item.short}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
