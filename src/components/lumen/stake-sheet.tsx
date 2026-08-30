'use client'

/**
 * Earn — put shielded Bitcoin to work without unshielding it.
 *
 * strkBTC goes to LumenVault, LumenVault deposits it into Endur, and the
 * xstrkBTC comes back into a fresh private note. One pool operation. The
 * alternative on offer today is unshield, deposit in public, re-shield: two
 * public legs of matching size, seconds apart, on one account.
 *
 * The rate previews through the helper rather than straight from Endur, so the
 * number shown here and the number the transaction produces come down the same
 * path.
 */

import { useEffect, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { floorFromPreview, previewStake, STAKE_ASSET, STAKE_RECEIPT } from '@/lib/strk20/vault'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, ErrorNote, parseAmount, SuccessMark, TxLink } from './bits'
import { ArrowDown, ArrowUpRight, Check, Clock, ShieldCheck } from './icons'
import type { SheetRoute } from './routes'

const ASSET_DECIMALS = TOKENS[STAKE_ASSET].decimals

export function StakeSheet({
  open,
  onClose,
  onRoute,
}: {
  open: boolean
  onClose: () => void
  /** Unstaking is a private swap back, so this sheet hands off to Convert. */
  onRoute?: (route: SheetRoute) => void
}) {
  const { balances, prices, submitting, stakeBitcoin, error, clearError, lastTx } = useLumen()

  const [amountText, setAmountText] = useState('')
  const [shares, setShares] = useState<bigint | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [done, setDone] = useState<{ staked: string } | null>(null)

  const amount = parseAmount(amountText, STAKE_ASSET)
  const balance = balances.find((b) => b.symbol === STAKE_ASSET)
  const staked = balances.find((b) => b.symbol === STAKE_RECEIPT)
  const enough = balance === undefined || (amount > 0n && amount <= balance.raw)

  // Debounced preview. A failed read leaves the screen usable — the floor just
  // opts out rather than the sheet refusing to render.
  useEffect(() => {
    if (amount <= 0n) {
      setShares(null)
      return
    }
    let live = true
    setQuoting(true)
    const timer = setTimeout(async () => {
      const result = await previewStake(amount)
      if (!live) return
      setShares(result)
      setQuoting(false)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
      setQuoting(false)
    }
  }, [amount])

  const submit = async () => {
    if (amount <= 0n || !enough) return
    try {
      await stakeBitcoin({
        amount,
        minShares: shares === null ? 0n : floorFromPreview(shares),
      })
      setDone({ staked: `${formatUnits(amount, ASSET_DECIMALS, 8)} ${STAKE_ASSET}` })
    } catch {
      // The store surfaced the wallet's explanation.
    }
  }

  const close = () => {
    onClose()
    setDone(null)
    setAmountText('')
    setShares(null)
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      locked={submitting}
      title={done ? 'Earning' : 'Earn on your Bitcoin'}
    >
      {!done ? (
        <div>
          <AmountField
            value={amountText}
            onChange={setAmountText}
            token={STAKE_ASSET}
            tokens={[STAKE_ASSET]}
            prices={prices}
            {...(balance ? { maxRaw: balance.raw } : {})}
            autoFocus
          />

          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-rule" />
            <span className="grid size-9 place-items-center rounded-full border border-rule bg-card text-ink-soft">
              <ArrowDown size={16} />
            </span>
            <div className="h-px flex-1 bg-rule" />
          </div>

          <div className="card mt-4 px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-ink-muted">You receive</span>
              <span className="tabular text-[17px] font-semibold">
                {shares !== null
                  ? `${formatUnits(shares, ASSET_DECIMALS, 8)} ${STAKE_RECEIPT}`
                  : quoting
                    ? '…'
                    : '—'}
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
              Staked with Endur. It earns while you hold it, and stays shielded.
            </p>
          </div>

          {staked && staked.raw > 0n ? (
            <div className="card mt-3 flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  Already earning {formatUnits(staked.raw, ASSET_DECIMALS, 8)} {STAKE_RECEIPT}
                </span>
                <span className="block text-[12px] text-ink-muted">
                  Leaves as a private swap — it never unshields.
                </span>
              </span>
              <button
                onClick={() => onRoute?.({ kind: 'convert', sell: STAKE_RECEIPT, buy: STAKE_ASSET })}
                className="btn btn-quiet btn-small flex-none"
              >
                <ArrowUpRight size={14} />
                Unstake
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          <button
            onClick={submit}
            disabled={submitting || amount <= 0n || !enough}
            className="btn btn-ink mt-6 w-full disabled:opacity-40"
          >
            {submitting
              ? 'Waiting for your wallet…'
              : !enough
                ? `Not enough ${STAKE_ASSET}`
                : 'Stake privately'}
          </button>

          <p className="mx-auto mt-4 max-w-[330px] text-center text-[12px] leading-relaxed text-ink-faint">
            The chain sees one pool operation and the amount. It does not see your address, your
            balance, or that this stake is yours.
          </p>
        </div>
      ) : (
        <div className="py-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[19px] font-semibold">{done.staked} is earning</p>
          <p className="mx-auto mt-2 max-w-[300px] text-[13.5px] leading-relaxed text-ink-muted">
            It never left the pool. No public deposit names you, and nothing links this to your
            balance.
          </p>
          {lastTx ? (
            <p className="mt-4">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}
          <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full bg-card-soft px-4 py-2 text-[12.5px] text-ink-muted">
            <Clock size={14} />
            Spendable in a few minutes, once the pool settles it.
          </div>
          <div className="mx-auto mt-3 flex w-fit items-center gap-2 text-[12.5px] text-ink-muted">
            <ShieldCheck size={14} />
            Exit any time — it never has to unshield.
          </div>
          <button onClick={close} className="btn btn-ink mt-7 w-full">
            <Check size={17} />
            Done
          </button>
        </div>
      )}
    </Sheet>
  )
}
