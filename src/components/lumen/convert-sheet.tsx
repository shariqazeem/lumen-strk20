'use client'

/**
 * Convert — swap between tokens without leaving the pool.
 *
 * The one DeFi action that needs no Cairo of ours: AVNU's executor sits
 * behind the pool's privacy_invoke, the wallet proves the action set, a
 * relayer submits it, and the output lands in a fresh private note. An
 * observer sees pool → executor → AMM — never who asked.
 *
 * Quotes refresh on a debounce while the user types; the signed execution
 * uses exactly the quoted route.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { fetchSwapQuote, type SwapQuoteResult } from '@/lib/strk20/swap'
import { formatUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, ErrorNote, parseAmount, SuccessMark, TxLink, usdText } from './bits'
import { ArrowDown, Check, Clock, ShieldCheck } from './icons'

export function ConvertSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, balances, prices, submitting, convert, error, clearError, lastTx, preview } =
    useLumen()

  const [sellToken, setSellToken] = useState<TokenSymbol>('USDC')
  const [buyToken, setBuyToken] = useState<TokenSymbol>('STRK')
  const [amountText, setAmountText] = useState('')
  const [quoteState, setQuoteState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; result: SwapQuoteResult; forAmount: bigint }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' })
  const [done, setDone] = useState<{ received: string } | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const decimals = TOKENS[sellToken].decimals
  const amount = parseAmount(amountText, sellToken)
  const balance = balances.find((b) => b.symbol === sellToken)
  const enough = balance === undefined || (amount > 0n && amount <= balance.raw)

  // Debounced live quote. Preview mode never quotes — no address to quote for.
  useEffect(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    if (amount <= 0n || sellToken === buyToken || !address || preview) {
      setQuoteState({ kind: 'idle' })
      return
    }
    setQuoteState({ kind: 'loading' })
    quoteTimer.current = setTimeout(async () => {
      try {
        const result = await fetchSwapQuote({
          sellToken,
          buyToken,
          sellAmountWei: amount,
          takerAddress: address,
        })
        setQuoteState({ kind: 'ready', result, forAmount: amount })
      } catch (quoteError) {
        setQuoteState({
          kind: 'failed',
          message:
            quoteError instanceof Error ? quoteError.message : 'No route for this pair right now.',
        })
      }
    }, 550)
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current)
    }
  }, [amount, sellToken, buyToken, address, preview])

  const quote = quoteState.kind === 'ready' && quoteState.forAmount === amount ? quoteState : null

  const buyDecimals = TOKENS[buyToken].decimals
  const receiveText = quote ? formatUnits(quote.result.buyAmountWei, buyDecimals, 6) : null

  const rate = useMemo(() => {
    if (!quote || amount <= 0n) return null
    const sellUnits = Number(formatUnits(amount, decimals, 8).replace(/,/g, ''))
    const buyUnits = Number(formatUnits(quote.result.buyAmountWei, buyDecimals, 8).replace(/,/g, ''))
    if (!Number.isFinite(sellUnits) || sellUnits <= 0) return null
    return buyUnits / sellUnits
  }, [quote, amount, decimals, buyDecimals])

  const submit = async () => {
    if (!quote) return
    try {
      await convert({ quote: quote.result.quote, sellToken, sellAmount: amount })
      setDone({ received: `${receiveText} ${buyToken}` })
    } catch {
      // Store surfaced the wallet's explanation.
    }
  }

  const swapSides = () => {
    setSellToken(buyToken)
    setBuyToken(sellToken)
    setAmountText('')
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={submitting}
      title={done ? 'Converted' : 'Convert'}
    >
      {!done ? (
        <div>
          <AmountField
            value={amountText}
            onChange={setAmountText}
            token={sellToken}
            onToken={(next) => {
              if (next === buyToken) setBuyToken(sellToken)
              setSellToken(next)
            }}
            tokens={TOKEN_LIST.map((t) => t.symbol)}
            prices={prices}
            {...(balance ? { maxRaw: balance.raw } : {})}
            autoFocus
          />

          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-rule" />
            <button
              onClick={swapSides}
              aria-label="Swap direction"
              className="grid size-9 place-items-center rounded-full border border-rule bg-card text-ink-soft transition-transform active:rotate-180"
            >
              <ArrowDown size={16} />
            </button>
            <div className="h-px flex-1 bg-rule" />
          </div>

          <div className="mt-4">
            <p className="mb-2 px-1 text-[13px] font-semibold text-ink-muted">Into</p>
            <div className="flex gap-1.5 overflow-x-auto">
              {TOKEN_LIST.map((t) => t.symbol)
                .filter((symbol) => symbol !== sellToken)
                .map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => setBuyToken(symbol)}
                    className={`h-9 flex-none rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                      symbol === buyToken ? 'bg-ink text-white' : 'bg-sunk text-ink-soft hover:bg-rule'
                    }`}
                  >
                    {symbol}
                  </button>
                ))}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-rule bg-card-soft px-4 py-3.5 text-[13.5px]">
            {preview ? (
              <p className="text-ink-muted">
                Live routes need a connected wallet — this is the sample walkthrough.
              </p>
            ) : quoteState.kind === 'idle' ? (
              <p className="text-ink-muted">Type an amount to see the live route.</p>
            ) : quoteState.kind === 'loading' ? (
              <p className="text-ink-muted">Finding the best route…</p>
            ) : quoteState.kind === 'failed' ? (
              <p className="font-medium">{quoteState.message}</p>
            ) : quote ? (
              <div className="space-y-1.5">
                <p className="flex items-baseline justify-between">
                  <span className="text-ink-muted">You receive about</span>
                  <span className="tabular font-semibold">
                    {receiveText} {buyToken}
                  </span>
                </p>
                {rate !== null ? (
                  <p className="flex items-baseline justify-between text-[12.5px] text-ink-muted">
                    <span>Rate</span>
                    <span className="tabular">
                      1 {sellToken} ≈ {rate.toLocaleString('en-US', { maximumFractionDigits: 6 })}{' '}
                      {buyToken}
                    </span>
                  </p>
                ) : null}
                {prices[buyToken] !== undefined && receiveText ? (
                  <p className="flex items-baseline justify-between text-[12.5px] text-ink-muted">
                    <span>Value</span>
                    <span className="tabular">
                      ≈ {usdText(Number(receiveText.replace(/,/g, '')) * (prices[buyToken] ?? 0))}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-ink-muted">Re-quoting…</p>
            )}
          </div>

          <p className="mt-3 flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-ink-muted">
            <ShieldCheck size={14} className="mt-0.5 flex-none" />
            The whole conversion happens inside the pool — observers see an executor talk to an
            AMM, never you. Slippage 0.5%; the pool fee comes from what you sell.
          </p>

          {error ? (
            <div className="mt-4">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {!enough && amount > 0n ? (
            <p className="mt-3 px-1 text-center text-[13px] font-semibold">
              That&rsquo;s more than you have in {sellToken}.
            </p>
          ) : null}

          <button
            onClick={submit}
            disabled={!quote || submitting || !enough}
            className="btn btn-ink mt-5 w-full"
          >
            {submitting
              ? 'Waiting for your wallet…'
              : quote
                ? `Convert to ${buyToken} privately`
                : 'Convert privately'}
          </button>
        </div>
      ) : (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            About {done.received} incoming
          </p>
          <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-ink-muted">
            Converted without ever leaving the private side. Nothing connects it to you.
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
            <Check size={17} />
            Done
          </button>
        </div>
      )}
    </Sheet>
  )
}
