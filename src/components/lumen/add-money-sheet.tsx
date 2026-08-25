'use client'

/**
 * Add money — the public front door, handled with hygiene.
 *
 * A deposit is the one thing everyone can see, forever. So the guard rewrites
 * distinctive amounts into ones that blend into the pool's deposit record,
 * and the flow is explicit that the wallet will ask twice (approve, then
 * deposit) — otherwise the second prompt reads as a bug.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { guardSeed, reviewShield } from '@/lib/lumen/guard'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, ErrorNote, GuardPanel, parseAmount, SuccessMark, TxLink } from './bits'
import { Clock } from './icons'

export function AddMoneySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, prices, ledger, submitting, addMoney, error, clearError, lastTx } = useLumen()

  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const [keepExact, setKeepExact] = useState(false)
  const [done, setDone] = useState(false)

  const typedAmount = parseAmount(amountText, token)
  const decimals = TOKENS[token].decimals

  const report = useMemo(() => {
    if (typedAmount <= 0n || !address) return null
    return reviewShield({
      amount: typedAmount,
      decimals,
      token,
      seed: guardSeed(address, Date.now()),
      ledger,
      now: Date.now(),
    })
  }, [typedAmount, decimals, token, address, ledger])

  const tunedAmount =
    !keepExact && report?.suggestedAmount !== undefined ? report.suggestedAmount : typedAmount

  const submit = async () => {
    if (tunedAmount <= 0n) return
    try {
      await addMoney({ token, amount: tunedAmount })
      setDone(true)
    } catch {
      // Error surfaced by the store.
    }
  }

  return (
    <Sheet open={open} onClose={onClose} locked={submitting} title={done ? 'Added' : 'Add money'}>
      {!done ? (
        <div>
          <AmountField
            value={amountText}
            onChange={(next) => {
              setAmountText(next)
              setKeepExact(false)
            }}
            token={token}
            onToken={setToken}
            tokens={TOKEN_LIST.map((t) => t.symbol)}
            prices={prices}
            autoFocus
          />

          {report ? (
            <div className="mt-5 space-y-3">
              <GuardPanel report={report} />

              {report.suggestedAmount !== undefined ? (
                <div className="rise flex items-center justify-between rounded-2xl border border-rule bg-card-soft px-4 py-3">
                  <div className="text-[13.5px]">
                    <p className="font-semibold">
                      Adding{' '}
                      <span className="tabular">
                        {formatUnits(tunedAmount, decimals, 6)} {token}
                      </span>
                    </p>
                    {!keepExact ? (
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">
                        Adjusted from {formatUnits(typedAmount, decimals, 6)} so the public record
                        doesn&rsquo;t stand out.
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[12.5px] text-warn">
                        Exact amounts are easier to pick out of the deposit record.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setKeepExact((v) => !v)}
                    className="flex-none text-[12.5px] font-semibold text-ink-muted underline-offset-2 hover:underline"
                  >
                    {keepExact ? 'Use tuned' : 'Keep exact'}
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

          <button
            onClick={submit}
            disabled={tunedAmount <= 0n || submitting}
            className="btn btn-ink mt-5 w-full"
          >
            {submitting ? 'Waiting for your wallet…' : 'Add to private balance'}
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-faint">
            Your wallet will ask twice — once to approve {token}, once to deposit. Both are part
            of the same step.
          </p>
        </div>
      ) : (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {formatUnits(tunedAmount, decimals, 6)} {token} added
          </p>
          <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
            From here on, everything you do with it is invisible.
          </p>
          {lastTx ? (
            <p className="mt-3">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}
          <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full bg-card-soft px-4 py-2 text-[12.5px] text-ink-muted">
            <Clock size={14} />
            Spendable in a few minutes, once the pool settles it.
          </div>
          <button onClick={onClose} className="btn btn-ink mt-7 w-full">
            Done
          </button>
        </div>
      )}
    </Sheet>
  )
}
