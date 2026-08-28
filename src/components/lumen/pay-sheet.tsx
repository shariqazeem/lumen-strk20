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
import { guardSeed, reviewPay, reviewShield } from '@/lib/lumen/guard'
import { DEFAULT_REFUND_WINDOW_S, REFUND_WINDOWS } from '@/lib/strk20/escrow'
import {
  looksLikeStarknetAddress,
  personByAddress,
  shortAddress,
  type Person,
} from '@/lib/lumen/people'
import type { Receipt } from '@/lib/lumen/receipts'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { ShareLink } from './share-link'
import {
  AmountField,
  Avatar,
  ErrorNote,
  GuardPanel,
  parseAmount,
  SuccessMark,
  TxLink,
  WorldSaw,
} from './bits'
import {
  ChevronRight,
  Clock,
  LinkIcon,
  People,
  Receipt as ReceiptIcon,
} from './icons'

type Step = 'to' | 'amount' | 'done' | 'linkAmount' | 'linkDone'

interface PaySheetProps {
  open: boolean
  onClose: () => void
  person?: Person
  onReceipt: (receipt: Receipt) => void
  onSplit: () => void
}

export function PaySheet({
  open,
  onClose,
  person,
  onReceipt,
  onSplit,
}: PaySheetProps) {
  const {
    address,
    people,
    balances,
    prices,
    ledger,
    submitting,
    pay,
    sendClaimLink,
    noteDecision,
    error,
    clearError,
    lastTx,
  } = useLumen()

  const [step, setStep] = useState<Step>(person ? 'amount' : 'to')
  const [target, setTarget] = useState<Person | null>(person ?? null)
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [refundAfterS, setRefundAfterS] = useState<number>(DEFAULT_REFUND_WINDOW_S)
  const [linkKeepExact, setLinkKeepExact] = useState(false)

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

  const recipientAddress = target?.address ?? ''
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

  // A claim link's escrow amount is public, so it gets deposit-grade amount
  // hygiene: round or reused amounts are rewritten before the wallet signs.
  const linkReport = useMemo(() => {
    if (step !== 'linkAmount' || amount <= 0n || !address) return null
    return reviewShield({
      amount,
      decimals: TOKENS[token].decimals,
      token,
      seed: guardSeed(address, Date.now()),
      ledger,
      now: Date.now(),
    })
  }, [step, amount, token, address, ledger])

  const linkAmount =
    !linkKeepExact && linkReport?.suggestedAmount !== undefined
      ? linkReport.suggestedAmount
      : amount

  const submitLink = async () => {
    if (linkAmount <= 0n) return
    try {
      const { url } = await sendClaimLink({
        token,
        amount: linkAmount,
        refundAfterS,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      if (linkReport) {
        noteDecision({
          action: 'link',
          report: linkReport,
          ...(linkAmount !== amount
            ? {
                rewritten: {
                  from: formatUnits(amount, TOKENS[token].decimals, 6),
                  to: formatUnits(linkAmount, TOKENS[token].decimals, 6),
                  token,
                },
              }
            : {}),
        })
      }
      setLinkUrl(url)
      setStep('linkDone')
    } catch {
      // The store surfaced the explanation; stay here.
    }
  }

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
      if (report) noteDecision({ action: 'pay', report })
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
      title={
        step === 'done'
          ? 'Sent'
          : step === 'to'
            ? 'Pay'
            : step === 'linkAmount'
              ? 'Pay with a link'
              : step === 'linkDone'
                ? 'Link ready'
                : `Pay ${target?.name ?? 'privately'}`
      }
    >
      {step === 'to' ? (
        <div className="space-y-5">
          <button
            onClick={() => {
              setTarget(null)
              setAmountText('')
              setLinkKeepExact(false)
              setStep('linkAmount')
            }}
            className="card card-press flex w-full items-center gap-3.5 px-5 py-4 text-left"
          >
            <span className="grid size-10 flex-none place-items-center rounded-full bg-ink text-white">
              <LinkIcon size={17} />
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold">Pay with a link</span>
              <span className="block text-[13px] leading-snug text-ink-muted">
                For someone who is not set up yet. The money waits behind a hash until they
                come and collect it, however long that takes.
              </span>
            </span>
            <ChevronRight size={15} className="text-ink-faint" />
          </button>

          <button
            onClick={onSplit}
            className="card card-press flex w-full items-center gap-3.5 px-5 py-4 text-left"
          >
            <span className="grid size-10 flex-none place-items-center rounded-full bg-ink text-white">
              <People size={17} />
            </span>
            <span className="flex-1">
              <span className="block text-[14.5px] font-semibold">Pay several people</span>
              <span className="block text-[13px] leading-snug text-ink-muted">
                One operation, one fee — and nobody sees what anyone else got.
              </span>
            </span>
            <ChevronRight size={15} className="text-ink-faint" />
          </button>

          <p className="px-1 text-[13px] leading-relaxed text-ink-faint">
            To pay someone you already know, use the composer on the main
            screen — name, amount, Send.
          </p>
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
            <Avatar name={target?.name ?? shortAddress(recipientAddress)} size={34} />
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

      {step === 'linkAmount' ? (
        <div>
          <AmountField
            value={amountText}
            onChange={(next) => {
              setAmountText(next)
              setLinkKeepExact(false)
            }}
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
            placeholder="Note for the recipient (optional)"
            className="mt-5 h-11 w-full rounded-2xl border border-rule bg-card px-4 text-[14px] outline-none focus:border-rule-strong"
          />

          {linkReport ? (
            <div className="mt-4 space-y-3">
              <GuardPanel report={linkReport} />
              {linkReport.suggestedAmount !== undefined ? (
                <div className="rise flex items-center justify-between rounded-2xl border border-rule bg-card-soft px-4 py-3">
                  <div className="text-[13.5px]">
                    <p className="font-semibold">
                      Link carries{' '}
                      <span className="tabular">
                        {formatUnits(linkAmount, TOKENS[token].decimals, 6)} {token}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {linkKeepExact
                        ? 'Exact amounts are easier to pick out of the public escrow record.'
                        : 'Tuned — the escrowed amount is public, so it shouldn’t stand out.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setLinkKeepExact((v) => !v)}
                    className="flex-none text-[12.5px] font-semibold text-ink-muted underline-offset-2 hover:underline"
                  >
                    {linkKeepExact ? 'Use tuned' : 'Keep exact'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {balanceKnown && amount > 0n && !enough ? (
            <p className="mt-3 px-1 text-center text-[13px] font-semibold">
              That&rsquo;s more than you have in {token}.
            </p>
          ) : null}

          <div className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-ink-muted">
              <Clock size={13} />
              You can take it back after
            </p>
            <div className="flex gap-1.5 overflow-x-auto">
              {REFUND_WINDOWS.map((window) => (
                <button
                  key={window.seconds}
                  onClick={() => setRefundAfterS(window.seconds)}
                  className={`h-9 flex-none rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                    refundAfterS === window.seconds
                      ? 'bg-ink text-white'
                      : 'bg-sunk text-ink-soft hover:bg-rule'
                  }`}
                >
                  {window.label}
                </button>
              ))}
            </div>
            <p className="mt-2.5 px-1 text-[12px] leading-relaxed text-ink-faint">
              They can still claim after that — the window only decides when
              <em> you</em> may reclaim an untouched link.
              {REFUND_WINDOWS.find((w) => w.seconds === refundAfterS)?.hint
                ? ' Short windows are for testing a reclaim.'
                : ''}
            </p>
          </div>

          <button
            onClick={submitLink}
            disabled={linkAmount <= 0n || submitting || (balanceKnown && !enough)}
            className="btn btn-ink mt-5 w-full"
          >
            {submitting ? 'Waiting for your wallet…' : 'Create claim link'}
          </button>
        </div>
      ) : null}

      {step === 'linkDone' ? (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {formatUnits(linkAmount, TOKENS[token].decimals, 6)} {token} is waiting
          </p>
          <p className="mx-auto mt-2 max-w-[310px] text-[14px] leading-relaxed text-ink-muted">
            Send this link however you like. Whoever holds it claims the money privately — no
            wallet needed until the moment they do.
          </p>

          <ShareLink
            url={linkUrl}
            shareText="I sent you money on Lumen"
            privateLabel="the claim secret — this is the money"
            className="mt-6 text-left"
          />

          {lastTx ? (
            <p className="mt-3">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}

          <p className="mx-auto mt-4 max-w-[310px] text-[12px] leading-relaxed text-ink-faint">
            The secret travels only inside this link — no server ever sees it. Your reclaim key is
            saved on this device under Links.
          </p>

          <button onClick={onClose} className="btn btn-quiet mt-4 w-full">
            Done
          </button>
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
          <WorldSaw kind="private" />
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
