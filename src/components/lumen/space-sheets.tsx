'use client'

/**
 * Spaces — create one, and move money in or out of one.
 *
 * Honesty note, reflected in the copy: a Space is a private view over your
 * one shielded balance, held on this device. Moving between Spaces is instant
 * and free because nothing touches the chain — a boundary the chain could see
 * would itself leak.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { allocationOf, SPACE_ICONS, SPACE_TINTS, totalAllocated, type SpaceIcon } from '@/lib/lumen/spaces'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, parseAmount, usdText } from './bits'
import { SpaceGlyph } from './icons'

const SPACE_IDEAS = [
  { name: 'Rent', icon: 'home' as const },
  { name: 'Travel', icon: 'travel' as const },
  { name: 'Rainy day', icon: 'rainy' as const },
  { name: 'Freelance', icon: 'work' as const },
] as const

export function NewSpaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addSpace } = useLumen()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<SpaceIcon>('goal')
  const [goal, setGoal] = useState('')

  const save = () => {
    if (!name.trim()) return
    const goalUsd = Number.parseFloat(goal)
    addSpace({
      name,
      icon,
      ...(Number.isFinite(goalUsd) && goalUsd > 0 ? { goalUsd } : {}),
    })
    setName('')
    setIcon('goal')
    setGoal('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="New space">
      <div className="mb-4 flex gap-2">
        {SPACE_IDEAS.map((idea) => (
          <button
            key={idea.name}
            onClick={() => {
              setName(idea.name)
              setIcon(idea.icon)
            }}
            className="flex-1 rounded-2xl bg-sunk px-2 py-2.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-rule"
          >
            <SpaceGlyph icon={idea.icon} size={18} className="mx-auto block" />
            {idea.name}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 30))}
          placeholder="Name — Rent, Travel…"
          autoFocus
          className="h-12 w-full rounded-2xl border border-rule bg-card px-4 text-[15px] outline-none focus:border-rule-strong"
        />
        <div className="flex items-center gap-2">
          {SPACE_ICONS.map((option) => (
            <button
              key={option}
              onClick={() => setIcon(option)}
              aria-label={option}
              aria-pressed={icon === option}
              className={`grid size-10 flex-1 place-items-center rounded-2xl transition-all ${
                icon === option
                  ? 'bg-ink text-white'
                  : 'bg-sunk text-ink-soft hover:bg-rule active:scale-95'
              }`}
            >
              <SpaceGlyph icon={option} size={19} />
            </button>
          ))}
        </div>
        <input
          value={goal}
          onChange={(event) => setGoal(event.target.value.replace(/[^\d.]/g, ''))}
          placeholder="Goal in USD (optional)"
          inputMode="decimal"
          className="h-12 w-full rounded-2xl border border-rule bg-card px-4 text-[15px] outline-none focus:border-rule-strong"
        />
      </div>

      <p className="mt-4 px-1 text-[12.5px] leading-relaxed text-ink-faint">
        Spaces organize your private balance on this device. No one — not the chain, not us — can
        see what you&rsquo;re saving for.
      </p>

      <button onClick={save} disabled={!name.trim()} className="btn btn-ink mt-5 w-full">
        Create space
      </button>
    </Sheet>
  )
}

export function SpaceSheet({
  open,
  onClose,
  spaceId,
}: {
  open: boolean
  onClose: () => void
  spaceId: string | null
}) {
  const { spaces, balances, prices, moveIntoSpace, removeSpace } = useLumen()
  const [direction, setDirection] = useState<'in' | 'out'>('in')
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')

  const space = spaces.find((s) => s.id === spaceId) ?? null

  const held = space ? allocationOf(space, token) : 0n

  /** Unallocated = live balance − every space's claim, floored at zero. */
  const free = useMemo(() => {
    const balance = balances.find((b) => b.symbol === token)
    if (!balance) return 0n
    const allocated = totalAllocated(spaces, token)
    return balance.raw > allocated ? balance.raw - allocated : 0n
  }, [balances, spaces, token])

  if (!space) return null

  const tint = SPACE_TINTS[space.tint % SPACE_TINTS.length]
  const amount = parseAmount(amountText, token)
  const limit = direction === 'in' ? free : held
  const valid = amount > 0n && amount <= limit

  const move = () => {
    if (!valid) return
    moveIntoSpace(space.id, token, direction === 'in' ? amount : -amount)
    setAmountText('')
  }

  const heldUsd = (() => {
    let total = 0
    for (const symbol of Object.keys(space.allocations) as TokenSymbol[]) {
      const price = prices[symbol]
      if (price === undefined) continue
      total +=
        Number(formatUnits(allocationOf(space, symbol), TOKENS[symbol].decimals, 6).replace(/,/g, '')) *
        price
    }
    return total
  })()

  return (
    <Sheet open={open} onClose={onClose} title={space.name}>
      <div
        className="rounded-2xl px-5 py-4"
        style={{ background: tint.bg, color: tint.fg }}
      >
        <p className="text-[12.5px] font-semibold opacity-80">Set aside</p>
        <p className="tabular mt-0.5 text-[30px] font-semibold tracking-[-0.02em]">
          {usdText(heldUsd)}
        </p>
        {space.goalUsd ? (
          <div className="mt-2.5">
            <span className="block h-1.5 overflow-hidden rounded-full bg-white/50">
              <span
                className="block h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${Math.min(100, (heldUsd / space.goalUsd) * 100)}%`,
                  background: tint.fg,
                }}
              />
            </span>
            <p className="mt-1.5 text-[12px] font-medium opacity-80">
              of {usdText(space.goalUsd)} goal
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-1.5 rounded-2xl bg-sunk p-1.5">
        {(['in', 'out'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={`h-9 rounded-xl text-[13.5px] font-semibold transition-colors ${
              direction === d ? 'bg-card shadow-[0_1px_2px_rgba(18,18,20,0.08)]' : 'text-ink-muted'
            }`}
          >
            {d === 'in' ? 'Move in' : 'Move out'}
          </button>
        ))}
      </div>

      <AmountField
        value={amountText}
        onChange={setAmountText}
        token={token}
        onToken={setToken}
        tokens={TOKEN_LIST.map((t) => t.symbol)}
        prices={prices}
        maxRaw={limit}
      />

      <p className="mt-2 text-center text-[12.5px] text-ink-muted">
        {direction === 'in'
          ? `${formatUnits(free, TOKENS[token].decimals, 4)} ${token} unassigned`
          : `${formatUnits(held, TOKENS[token].decimals, 4)} ${token} in this space`}
        {' · instant, nothing touches the chain'}
      </p>

      <button onClick={move} disabled={!valid} className="btn btn-ink mt-4 w-full">
        {direction === 'in' ? 'Move in' : 'Move out'}
      </button>

      <button
        onClick={() => {
          removeSpace(space.id)
          onClose()
        }}
        className="mt-3 w-full text-center text-[13px] font-semibold text-ink-faint hover:text-warn"
      >
        Delete space
      </button>
    </Sheet>
  )
}
