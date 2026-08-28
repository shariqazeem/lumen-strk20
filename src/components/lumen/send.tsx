'use client'

/**
 * Send — the product.
 *
 * This is the whole thesis in one component. People do not avoid private
 * transfers because they dislike privacy; they avoid them because the private
 * path is a *different workflow* from the normal one, and a second workflow
 * loses every time. So there is no shield step, no privacy mode, no toggle,
 * and no button that says PRIVATE in capitals — a button like that teaches
 * that privacy is a special occasion.
 *
 * There is a name, an amount, and Send. The rail underneath happens to be
 * STRK20. One quiet line says so, once, and then gets out of the way.
 *
 * The guard still runs; it just runs *under the floor*. Nothing is presented
 * for approval before the payment. What the engine did is reported afterwards,
 * next to what the world saw, which is the only moment either fact is useful.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { reviewPay } from '@/lib/lumen/guard'
import { looksLikeStarknetAddress, shortAddress, type Person } from '@/lib/lumen/people'
import { readRegistration, type Registration } from '@/lib/strk20/registration'
import { formatUnits } from '@/lib/strk20/wallet'
import { preferredToken, TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import type { Receipt } from '@/lib/lumen/receipts'
import { AmountField, Avatar, ErrorNote, parseAmount, SuccessMark, TxLink } from './bits'
import { ArrowRight, ArrowUpRight, Check, Globe, LinkIcon, ShieldCheck } from './icons'

/** Who the money is going to, once it is settled enough to send. */
interface Target {
  address: string
  name?: string
}

export function SendComposer({
  onObserver,
  onReceipt,
  onNeedsLink,
}: {
  onObserver: () => void
  onReceipt: (receipt: Receipt) => void
  /** The recipient cannot receive a private transfer; offer the escrow path. */
  onNeedsLink: () => void
}) {
  const {
    people,
    balances,
    prices,
    ledger,
    pay,
    submitting,
    error,
    clearError,
    noteDecision,
    lastTx,
  } = useLumen()

  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<Target | null>(null)
  const [amountText, setAmountText] = useState('')
  const [token, setToken] = useState<TokenSymbol | null>(null)
  const [sent, setSent] = useState<Receipt | null>(null)
  // The pool requires both sides to be registered before a private transfer.
  // Reading it here means the dead end is found before the wallet prompt, and
  // it has somewhere to go: a link needs no registration at all.
  const [reach, setReach] = useState<Registration>('unknown')
  const amountRef = useRef<HTMLDivElement>(null)

  // Null until balances land, so the composer never opens on an asset the
  // account cannot spend and then silently changes under the user's fingers.
  const active = token ?? preferredToken(balances)
  const amount = parseAmount(amountText, active)
  const balance = balances.find((b) => b.symbol === active)
  const enough = balance === undefined || amount <= balance.raw

  /** Contacts matching what has been typed — never more than four. */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people.slice(0, 4)
    return people
      .filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
      .slice(0, 4)
  }, [people, query])

  /** A pasted address is a valid recipient with no name attached. */
  const pastedAddress = looksLikeStarknetAddress(query.trim()) ? query.trim() : null

  const choose = (person: Person) => {
    setTarget({ address: person.address, name: person.name })
    setQuery(person.name)
  }

  // Choosing a person should land the cursor on the amount — the composer has
  // exactly two fields and should never make anyone hunt for the second.
  useEffect(() => {
    if (target) amountRef.current?.querySelector('input')?.focus()
  }, [target])

  useEffect(() => {
    if (!target) {
      setReach('unknown')
      return
    }
    let live = true
    setReach('unknown')
    void readRegistration(target.address).then((result) => {
      if (live) setReach(result)
    })
    return () => {
      live = false
    }
  }, [target])

  const submit = async () => {
    if (!target || amount <= 0n || !enough) return
    // The guard runs, and its verdict goes to the journal — not to a dialog.
    // Nobody opened a privacy app; they are paying someone.
    const report = reviewPay({
      amount,
      decimals: TOKENS[active].decimals,
      token: active,
      recipient: target.address,
      ledger,
      now: Date.now(),
    })
    try {
      const receipt = await pay({
        token: active,
        amount,
        recipient: target.address,
        ...(target.name ? { recipientName: target.name } : {}),
      })
      noteDecision({ action: 'pay', report })
      setSent(receipt)
    } catch {
      // The store surfaces the reason; the composer keeps what was typed.
    }
  }

  const reset = () => {
    setSent(null)
    setTarget(null)
    setQuery('')
    setAmountText('')
    setToken(null)
  }

  /* ---------------------------------------------------------------- */
  /* after                                                             */
  /* ---------------------------------------------------------------- */

  if (sent) {
    return (
      <section className="rise card px-6 pb-6 pt-7 text-center">
        <SuccessMark />
        <p className="mt-5 text-[24px] font-semibold tracking-[-0.025em]">
          Sent {formatUnits(BigInt(sent.amountRaw), TOKENS[sent.token].decimals, 6)} {sent.token}
        </p>
        <p className="mt-1.5 text-[14.5px] text-ink-muted">
          to {sent.toName ?? shortAddress(sent.toAddress)}
        </p>

        {lastTx ? (
          <p className="mt-3">
            <TxLink hash={lastTx.hash} />
          </p>
        ) : null}

        {/* The proof comes after the act, never before it. */}
        <div className="mt-6 rounded-2xl bg-card-soft px-5 py-4 text-left">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
            <Globe size={13} />
            What the world saw
          </p>
          <p className="mt-2 text-[14px] leading-relaxed">
            One pool operation. <span className="text-ink-muted">No sender, no recipient, no
            amount — and nothing tying this payment to any other one you have made.</span>
          </p>
          <button
            onClick={onObserver}
            className="mt-3 text-[13px] font-semibold underline decoration-rule-strong underline-offset-2 hover:text-ink"
          >
            See your account from outside
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button onClick={() => onReceipt(sent)} className="btn btn-quiet">
            Receipt
          </button>
          <button onClick={reset} className="btn btn-ink">
            Send again
          </button>
        </div>
      </section>
    )
  }

  /* ---------------------------------------------------------------- */
  /* the composer                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <section className="rise">
      {error ? (
        <div className="mb-4">
          <ErrorNote message={error} onDismiss={clearError} />
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {/* who */}
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="text-[14px] font-medium text-ink-muted">To</span>
          {target ? (
            <button
              onClick={() => {
                setTarget(null)
                setQuery('')
              }}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <Avatar name={target.name ?? target.address} size={30} />
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">
                {target.name ?? shortAddress(target.address)}
              </span>
              <span className="flex-none text-[12.5px] text-ink-faint underline underline-offset-2">
                Change
              </span>
            </button>
          ) : (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or address"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:font-normal placeholder:text-ink-faint"
            />
          )}
        </div>

        {/* who — suggestions, only while choosing */}
        {!target ? (
          <div className="border-t border-rule px-3 py-2">
            {pastedAddress ? (
              <button
                onClick={() => setTarget({ address: pastedAddress })}
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-sunk"
              >
                <Avatar name={pastedAddress} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">Send to this address</span>
                  <span className="block truncate font-mono text-[11.5px] text-ink-muted">
                    {shortAddress(pastedAddress)}
                  </span>
                </span>
                <ArrowRight size={15} className="flex-none text-ink-faint" />
              </button>
            ) : matches.length > 0 ? (
              matches.map((person) => (
                <button
                  key={person.id}
                  onClick={() => choose(person)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-sunk"
                >
                  <Avatar name={person.name} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{person.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-ink-muted">
                      {shortAddress(person.address)}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-[13px] text-ink-faint">
                {query.trim()
                  ? 'No one by that name yet — paste their address instead.'
                  : 'Type a name, or paste an address.'}
              </p>
            )}
          </div>
        ) : null}

        {/* how much */}
        {target ? (
          <div ref={amountRef} className="border-t border-rule px-5 pb-5 pt-1">
            <AmountField
              value={amountText}
              onChange={setAmountText}
              token={active}
              onToken={setToken}
              tokens={TOKEN_LIST.map((t) => t.symbol)}
              prices={prices}
              {...(balance ? { maxRaw: balance.raw, decimals: balance.decimals } : {})}
            />
          </div>
        ) : null}
      </div>

      {target && reach === 'unregistered' ? (
        <div className="card mt-3 px-5 py-5">
          <p className="text-[15px] font-semibold">
            {target.name ?? shortAddress(target.address)} has never used a private balance.
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
            A private transfer needs both sides registered with the pool, so this one cannot
            land. A link can — it holds the money behind a hash until they open it, and they
            need no wallet at all to do that.
          </p>
          <button onClick={onNeedsLink} className="btn btn-ink mt-4 w-full">
            <LinkIcon size={17} />
            Send a link instead
          </button>
        </div>
      ) : target ? (
        <button
          onClick={submit}
          disabled={amount <= 0n || !enough || submitting}
          className="btn btn-ink mt-3 w-full !h-[58px] !text-[16.5px]"
        >
          {submitting ? (
            'Waiting for your wallet…'
          ) : (
            <>
              <ArrowUpRight size={19} />
              Send
            </>
          )}
        </button>
      ) : null}

      {/* The one explanation, stated once, never as a decision. */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] text-ink-muted">
        <ShieldCheck size={13} />
        {!enough && target && amount > 0n ? (
          <span className="font-semibold text-ink">That is more than you have.</span>
        ) : (
          <>
            Private by default.{' '}
            <span className="text-ink-faint">Nothing about this becomes public.</span>
          </>
        )}
      </p>
    </section>
  )
}

/** The reassurance that belongs beside a first send, and nowhere after it. */
export function SendFootnote() {
  return (
    <p className="mt-4 flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-ink-faint">
      <Check size={13} className="mt-0.5 flex-none" />
      No shielding step, no privacy mode, no second workflow. The private rail is the only
      one Lumen uses.
    </p>
  )
}
