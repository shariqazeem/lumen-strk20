'use client'

/**
 * Cash out — the explicit, warned exit. Deliberately the least convenient
 * flow in the app: leaving the private side is the single most linkable act
 * a pool user performs, so the guard runs its hardest checks here and the
 * copy refuses to pretend otherwise. Friction is the feature.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { guardSeed, reviewCashOut } from '@/lib/lumen/guard'
import { looksLikeStarknetAddress } from '@/lib/lumen/people'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, ErrorNote, GuardPanel, parseAmount, SuccessMark, TxLink } from './bits'
import { splitterEnabled } from '@/lib/lumen/scatter'
import { Globe } from './icons'

export function CashOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    address,
    balances,
    prices,
    ledger,
    submitting,
    cashOut,
    scatterBalance,
    noteDecision,
    error,
    clearError,
    lastTx,
  } = useLumen()

  const [step, setStep] = useState<'warn' | 'form' | 'done'>('warn')
  const [scattered, setScattered] = useState<number | null>(null)
  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const [destination, setDestination] = useState('')
  const [useTuned, setUseTuned] = useState(true)

  const typedAmount = parseAmount(amountText, token)
  const decimals = TOKENS[token].decimals
  const balance = balances.find((b) => b.symbol === token)

  const report = useMemo(() => {
    if (typedAmount <= 0n || !address) return null
    return reviewCashOut({
      amount: typedAmount,
      decimals,
      token,
      seed: guardSeed(address, Date.now()),
      ledger,
      now: Date.now(),
    })
  }, [typedAmount, decimals, token, address, ledger])

  const finalAmount =
    useTuned && report?.suggestedAmount !== undefined ? report.suggestedAmount : typedAmount
  const validDestination = looksLikeStarknetAddress(destination)
  const enough = balance === undefined || (finalAmount > 0n && finalAmount <= balance.raw)

  const submit = async () => {
    if (finalAmount <= 0n || !validDestination) return
    try {
      await cashOut({ token, amount: finalAmount, recipient: destination.trim() })
      if (report) {
        noteDecision({
          action: 'out',
          report,
          ...(finalAmount !== typedAmount
            ? {
                rewritten: {
                  from: formatUnits(typedAmount, decimals, 6),
                  to: formatUnits(finalAmount, decimals, 6),
                  token,
                },
              }
            : {}),
        })
      }
      setStep('done')
    } catch {
      // Store surfaced the wallet's explanation.
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={submitting}
      title={step === 'done' ? 'Cashed out' : 'Cash out'}
    >
      {step === 'warn' ? (
        <div>
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-ink text-white">
            <Globe size={26} />
          </div>
          <h3 className="mt-5 text-center text-[20px] font-semibold tracking-[-0.02em]">
            This one is public
          </h3>
          <p className="mx-auto mt-2 max-w-[320px] text-center text-[14px] leading-relaxed text-ink-muted">
            Cashing out moves money back to a regular address. The amount, the destination and the
            moment are visible to everyone, forever. Lumen will check that none of it points back
            at your private history.
          </p>
          <div className="mt-7 space-y-2.5">
            <button onClick={onClose} className="btn btn-ink w-full">
              Stay private
            </button>
            <button onClick={() => setStep('form')} className="btn btn-quiet w-full">
              Continue to cash out
            </button>
          </div>
        </div>
      ) : null}

      {step === 'form' ? (
        <div>
          <AmountField
            value={amountText}
            onChange={(next) => {
              setAmountText(next)
              setUseTuned(true)
            }}
            token={token}
            onToken={setToken}
            tokens={TOKEN_LIST.map((t) => t.symbol)}
            prices={prices}
            {...(balance ? { maxRaw: balance.raw } : {})}
            autoFocus
          />

          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Destination address 0x…"
            spellCheck={false}
            className="mt-4 h-12 w-full rounded-2xl border border-rule bg-card px-4 font-mono text-[13px] outline-none focus:border-rule-strong"
          />

          {report ? (
            <div className="mt-4 space-y-3">
              <GuardPanel report={report} />

              {report.suggestedAmount !== undefined ? (
                <div className="rise flex items-center justify-between rounded-2xl border border-rule bg-card-soft px-4 py-3">
                  <div className="text-[13.5px]">
                    <p className="font-semibold">
                      Withdrawing{' '}
                      <span className="tabular">
                        {formatUnits(finalAmount, decimals, 6)} {token}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {useTuned
                        ? 'Adjusted so the exit does not mirror what went in.'
                        : 'Exact exits that mirror an entry are how private money gets traced.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setUseTuned((v) => !v)}
                    className="flex-none text-[12.5px] font-semibold text-ink-muted underline-offset-2 hover:underline"
                  >
                    {useTuned ? 'Keep exact' : 'Use tuned'}
                  </button>
                </div>
              ) : null}

              {report.suggestedWindow ? (
                <p className="px-1 text-[12.5px] leading-relaxed text-ink-muted">
                  Better window:{' '}
                  <span className="font-semibold text-ink">
                    {new Date(report.suggestedWindow.start).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {'–'}
                    {new Date(report.suggestedWindow.end).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>{' '}
                  — an irregular gap the engine picked to break the timing thread.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {!enough && typedAmount > 0n ? (
            <p className="mt-3 px-1 text-center text-[13px] text-warn">
              That&rsquo;s more than you have in {token}.
            </p>
          ) : null}

          {/* The engine's other half. The guard already rewrites the exit
              amount; this changes the shape it is drawn from. */}
          {splitterEnabled() && balance && balance.raw > 0n ? (
            <div className="mt-5 rounded-2xl border border-rule bg-card-soft px-5 py-4">
              <p className="text-[13.5px] font-semibold">Break the balance up first</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                One round note leaving shortly after one round note arrived is what re-links a
                deposit to a withdrawal. Splitting into several uneven notes first — one
                operation, nothing public — leaves an observer a worse thing to match against.
              </p>
              <button
                onClick={async () => {
                  try {
                    const legs = await scatterBalance({
                      token,
                      amount: balance.raw,
                      count: 4,
                    })
                    setScattered(legs)
                  } catch {
                    // The store surfaced the reason.
                  }
                }}
                disabled={submitting}
                className="btn btn-quiet mt-3 w-full"
              >
                {scattered
                  ? `Split into ${scattered} notes`
                  : submitting
                    ? 'Waiting for your wallet…'
                    : 'Split before leaving'}
              </button>
            </div>
          ) : null}

          <button
            onClick={submit}
            disabled={finalAmount <= 0n || !validDestination || submitting || !enough}
            className="btn btn-quiet mt-3 w-full !text-warn"
          >
            {submitting ? 'Waiting for your wallet…' : 'Cash out publicly'}
          </button>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {formatUnits(finalAmount, decimals, 6)} {token} on its way
          </p>
          <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
            This withdrawal is public. Everything still inside stays yours alone.
          </p>
          {lastTx ? (
            <p className="mt-3">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}
          <button onClick={onClose} className="btn btn-ink mt-7 w-full">
            Done
          </button>
        </div>
      ) : null}
    </Sheet>
  )
}
