'use client'

/**
 * Pay — the flagship flow. Person → amount → one quiet confirmation.
 *
 * The silent guard reviews the payment before the wallet is ever asked:
 * relationship boundaries, cross-boundary amount reuse, cadence. The user
 * sees a calm pill, not a score. The transfer itself publishes nothing.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { reviewPay } from '@/lib/lumen/guard'
import {
  looksLikeStarknetAddress,
  personByAddress,
  pickEmoji,
  shortAddress,
  type Person,
} from '@/lib/lumen/people'
import type { Receipt } from '@/lib/lumen/receipts'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import {
  AmountField,
  Avatar,
  ErrorNote,
  GuardPanel,
  parseAmount,
  SuccessMark,
  TxLink,
} from './bits'
import { ArrowRight, ChevronRight, Plus, Receipt as ReceiptIcon } from './icons'

type Step = 'to' | 'amount' | 'done'

interface PaySheetProps {
  open: boolean
  onClose: () => void
  person?: Person
  onReceipt: (receipt: Receipt) => void
  onNewPerson: () => void
}

export function PaySheet({ open, onClose, person, onReceipt, onNewPerson }: PaySheetProps) {
  const { people, balances, prices, ledger, submitting, pay, error, clearError, lastTx } =
    useLumen()

  const [step, setStep] = useState<Step>(person ? 'amount' : 'to')
  const [target, setTarget] = useState<Person | null>(person ?? null)
  const [pasted, setPasted] = useState('')
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  // Reset per open. Keyed remount is handled by the parent passing a fresh
  // sheet each time; this guards the in-place person shortcut.
  const [seenPerson, setSeenPerson] = useState(person)
  if (person !== seenPerson) {
    setSeenPerson(person)
    setTarget(person ?? null)
    setStep(person ? 'amount' : 'to')
    setAmountText('')
    setNote('')
    setReceipt(null)
  }

  const recipientAddress = target?.address ?? pasted.trim()
  const recipientName = target?.name ?? personByAddress(people, recipientAddress)?.name
  const validRecipient = looksLikeStarknetAddress(recipientAddress)

  const amount = parseAmount(amountText, token)
  const balance = balances.find((b) => b.symbol === token)
  const enough = balance !== undefined && amount > 0n && amount <= balance.raw
  const balanceKnown = balance !== undefined

  const report = useMemo(() => {
    if (!validRecipient || amount <= 0n) return null
    return reviewPay({
      amount,
      decimals: TOKENS[token].decimals,
      token,
      recipient: recipientAddress,
      ledger,
      now: Date.now(),
    })
  }, [validRecipient, amount, token, recipientAddress, ledger])

  const submit = async () => {
    if (!validRecipient || amount <= 0n) return
    try {
      const created = await pay({
        token,
        amount,
        recipient: recipientAddress,
        ...(recipientName ? { recipientName } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setReceipt(created)
      setStep('done')
    } catch {
      // The store surfaced the wallet's explanation; stay on this step.
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={submitting}
      title={step === 'done' ? 'Sent' : step === 'to' ? 'Pay' : `Pay ${target?.name ?? 'privately'}`}
    >
      {step === 'to' ? (
        <div className="space-y-5">
          {people.length > 0 ? (
            <div className="card divide-y divide-rule">
              {people.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setTarget(p)
                    setStep('amount')
                  }}
                  className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-card-soft"
                >
                  <Avatar emoji={p.emoji} size={40} />
                  <span className="flex-1">
                    <span className="block text-[14.5px] font-semibold">{p.name}</span>
                    <span className="block font-mono text-[11.5px] text-ink-faint">
                      {shortAddress(p.address)}
                    </span>
                  </span>
                  <ChevronRight size={15} className="text-ink-faint" />
                </button>
              ))}
              <button
                onClick={onNewPerson}
                className="flex w-full items-center gap-3.5 px-4 py-3 text-left text-ink-muted transition-colors hover:bg-card-soft"
              >
                <span className="grid size-10 place-items-center rounded-full border border-dashed border-rule-strong">
                  <Plus size={16} />
                </span>
                <span className="text-[14px] font-semibold">Someone new</span>
              </button>
            </div>
          ) : null}

          <div>
            <p className="mb-2 px-1 text-[13px] font-semibold text-ink-muted">
              Or paste an address
            </p>
            <div className="flex gap-2">
              <input
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-rule bg-card px-4 font-mono text-[13px] outline-none focus:border-rule-strong"
              />
              <button
                onClick={() => {
                  if (validRecipient) {
                    setTarget(personByAddress(people, pasted.trim()) ?? null)
                    setStep('amount')
                  }
                }}
                disabled={!validRecipient}
                aria-label="Continue"
                className="btn btn-ink h-12 w-12 flex-none !p-0"
              >
                <ArrowRight size={18} />
              </button>
            </div>
            <p className="mt-2.5 px-1 text-[12.5px] leading-relaxed text-ink-faint">
              They&rsquo;ll receive it privately. Their wallet needs private balances too — first
              payment to a new wallet may ask them to register once.
            </p>
          </div>
        </div>
      ) : null}

      {step === 'amount' ? (
        <div>
          <button
            onClick={() => {
              setStep('to')
              setTarget(null)
            }}
            className="flex w-full items-center gap-3 rounded-2xl bg-card-soft px-4 py-2.5 text-left"
          >
            <Avatar emoji={target?.emoji ?? pickEmoji(recipientAddress)} size={34} />
            <span className="flex-1">
              <span className="block text-[13.5px] font-semibold">
                {target?.name ?? shortAddress(recipientAddress)}
              </span>
              <span className="block text-[11.5px] text-ink-muted">
                Receives it privately · change
              </span>
            </span>
          </button>

          <AmountField
            value={amountText}
            onChange={setAmountText}
            token={token}
            onToken={setToken}
            tokens={TOKEN_LIST.map((t) => t.symbol)}
            prices={prices}
            {...(balance ? { maxRaw: balance.raw } : {})}
            autoFocus
          />

          <input
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 80))}
            placeholder="Note — stays on your receipt only"
            className="mt-5 h-11 w-full rounded-2xl border border-rule bg-card px-4 text-[14px] outline-none focus:border-rule-strong"
          />

          {report ? (
            <div className="mt-4">
              <GuardPanel report={report} />
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {balanceKnown && amount > 0n && !enough ? (
            <p className="mt-3 px-1 text-center text-[13px] text-warn">
              That&rsquo;s more than you have in {token}.
            </p>
          ) : null}

          <button
            onClick={submit}
            disabled={amount <= 0n || submitting || (balanceKnown && !enough)}
            className="btn btn-ink mt-5 w-full"
          >
            {submitting
              ? 'Waiting for your wallet…'
              : amount > 0n
                ? `Pay ${formatUnits(amount, TOKENS[token].decimals, 4)} ${token} privately`
                : 'Pay privately'}
          </button>
          <p className="mt-3 text-center text-[12px] text-ink-faint">
            No public sender, recipient or amount. Your wallet confirms first.
          </p>
        </div>
      ) : null}

      {step === 'done' && receipt ? (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {formatUnits(BigInt(receipt.amountRaw), TOKENS[receipt.token].decimals, 4)}{' '}
            {receipt.token} sent
          </p>
          <p className="mt-1 text-[14px] text-ink-muted">
            {recipientName ? `${recipientName} received it privately.` : 'Received privately.'}{' '}
            The chain saw nothing.
          </p>
          {lastTx ? (
            <p className="mt-3">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}
          <div className="mt-7 space-y-2.5">
            <button onClick={() => onReceipt(receipt)} className="btn btn-quiet w-full">
              <ReceiptIcon size={17} />
              View receipt
            </button>
            <button onClick={onClose} className="btn btn-ink w-full">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
