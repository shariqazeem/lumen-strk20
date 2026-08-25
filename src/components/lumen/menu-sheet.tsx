'use client'

/**
 * The menu — account, honesty, and the public exit.
 *
 * Cash out lives here rather than on the home surface: leaving the private
 * side is an opt-out, so it sits one deliberate step further away than Pay.
 */

import { useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { shortAddress } from '@/lib/lumen/people'
import { formatUnits } from '@/lib/strk20/wallet'
import { explorerContract, POOL_ADDRESS } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import {
  Check,
  ChevronRight,
  Copy,
  Globe,
  LinkIcon,
  Lock,
  Receipt,
  ShieldCheck,
  Sparkle,
} from './icons'

export function MenuSheet({
  open,
  onClose,
  onCashOut,
  onLinks,
  onMyPage,
  onConvert,
}: {
  open: boolean
  onClose: () => void
  onCashOut: () => void
  onLinks: () => void
  onMyPage: () => void
  onConvert: () => void
}) {
  const { address, walletName, poolFee, poolFeeLive, disconnect } = useLumen()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Nothing to do.
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="You">
      <div className="card divide-y divide-rule">
        <button
          onClick={copy}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink-soft">
            <Lock size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">{walletName ?? 'Wallet'}</span>
            <span className="block font-mono text-[11.5px] text-ink-muted">
              {address ? shortAddress(address) : ''}
            </span>
          </span>
          {copied ? (
            <Check size={15} className="text-good" />
          ) : (
            <Copy size={15} className="text-ink-faint" />
          )}
        </button>

        <a
          href={explorerContract(POOL_ADDRESS)}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink-soft">
            <ShieldCheck size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">The privacy pool</span>
            <span className="block text-[12px] text-ink-muted">
              Starknet mainnet · {formatUnits(poolFee, 18, 0)} STRK per private move
              {poolFeeLive ? '' : ' (last known)'}
            </span>
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </a>

        <button
          onClick={() => {
            onClose()
            onMyPage()
          }}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink-soft">
            <Receipt size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">Get paid — your page</span>
            <span className="block text-[12px] text-ink-muted">
              One link for bios and invoices; payments arrive privately
            </span>
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </button>

        <button
          onClick={() => {
            onClose()
            onConvert()
          }}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink-soft">
            <Sparkle size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">Convert between tokens</span>
            <span className="block text-[12px] text-ink-muted">
              Swap inside the pool — observers never see you
            </span>
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </button>

        <button
          onClick={() => {
            onClose()
            onLinks()
          }}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-sunk text-ink-soft">
            <LinkIcon size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">Links you sent</span>
            <span className="block text-[12px] text-ink-muted">
              Copy again, check statuses, reclaim expired ones
            </span>
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </button>

        <button
          onClick={() => {
            onClose()
            onCashOut()
          }}
          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-card-soft"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-ink text-white">
            <Globe size={16} />
          </span>
          <span className="flex-1">
            <span className="block text-[14.5px] font-semibold">Cash out</span>
            <span className="block text-[12px] text-ink-muted">
              Leave the private side — public, checked first
            </span>
          </span>
          <ChevronRight size={15} className="text-ink-faint" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl bg-card-soft px-4 py-4 text-[12.5px] leading-relaxed text-ink-muted">
        <p className="font-semibold text-ink">What is private here?</p>
        <p className="mt-1.5">
          Payments, balances, spaces and people — none of it appears on-chain or on any server.
          Deposits and cash-outs are public by nature; Lumen checks them so they don&rsquo;t point
          back at the rest. Your wallet holds every key and approves every move.
        </p>
      </div>

      <button
        onClick={() => {
          disconnect()
          onClose()
        }}
        className="btn btn-quiet mt-5 w-full"
      >
        Disconnect
      </button>
    </Sheet>
  )
}
