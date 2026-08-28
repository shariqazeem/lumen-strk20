'use client'

/**
 * Pay several people — one pool operation, one flat fee, one public blob.
 *
 * The point is not batching for its own sake: it is that nobody involved
 * learns what anyone else was paid. The chain records a single private
 * operation; each recipient sees only their own amount; and there is no
 * payroll sheet anywhere that lists them side by side.
 *
 * Amounts can be split evenly or set per person. The guard reviews the whole
 * distribution before the wallet is asked.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { reviewPay } from '@/lib/lumen/guard'
import { DEFAULT_REFUND_WINDOW_S } from '@/lib/strk20/escrow'
import { looksLikeStarknetAddress, shortAddress, type Person } from '@/lib/lumen/people'
import { formatUnits, parseUnits } from '@/lib/strk20/wallet'
import { TOKENS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { ShareLink } from './share-link'
import {
  Avatar,
  ErrorNote,
  GuardPanel,
  SuccessMark,
  TxLink,
  usdText,
  WorldSaw,
} from './bits'
import { Check, Plus, ShieldCheck, Close } from './icons'

interface Line {
  key: string
  person?: Person
  address: string
  amountText: string
}

export function SplitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    people,
    balances,
    prices,
    ledger,
    submitting,
    paySplit,
    noteDecision,
    error,
    clearError,
    lastTx,
    sendClaimLinks,
  } = useLumen()

  const [token, setToken] = useState<TokenSymbol>('USDC')
  const [lines, setLines] = useState<Line[]>([])
  const [pasted, setPasted] = useState('')
  const [totalText, setTotalText] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState<{ count: number; total: bigint } | null>(null)
  // Two ways to pay several people: to addresses they already have, or as
  // links for people who have no wallet at all. Same operation count either
  // way — one.
  const [mode, setMode] = useState<'addresses' | 'links'>('addresses')
  const [minted, setMinted] = useState<{ amount: bigint; name?: string; url: string }[] | null>(
    null,
  )

  const decimals = TOKENS[token].decimals
  const balance = balances.find((b) => b.symbol === token)

  const addPerson = (person: Person) => {
    if (lines.some((l) => l.person?.id === person.id)) return
    setLines((current) => [
      ...current,
      { key: person.id, person, address: person.address, amountText: '' },
    ])
  }

  const addPasted = () => {
    const address = pasted.trim()
    if (!looksLikeStarknetAddress(address)) return
    setLines((current) => [...current, { key: address, address, amountText: '' }])
    setPasted('')
  }

  const setAmount = (key: string, amountText: string) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, amountText } : l)))

  const remove = (key: string) => setLines((current) => current.filter((l) => l.key !== key))

  /** Divide a total evenly, giving any remainder to the first person. */
  const splitEvenly = () => {
    const total = parseUnits(totalText, decimals)
    if (total <= 0n || lines.length === 0) return
    const each = total / BigInt(lines.length)
    const remainder = total - each * BigInt(lines.length)
    setLines((current) =>
      current.map((l, index) => ({
        ...l,
        amountText: formatUnits(index === 0 ? each + remainder : each, decimals, decimals).replace(
          /,/g,
          '',
        ),
      })),
    )
  }

  const recipients = useMemo(
    () =>
      lines
        .map((l) => ({
          address: l.address,
          ...(l.person?.name ? { name: l.person.name } : {}),
          amount: parseUnits(l.amountText, decimals),
        }))
        .filter((r) => r.amount > 0n),
    [lines, decimals],
  )

  const total = recipients.reduce((sum, r) => sum + r.amount, 0n)
  const enough = balance === undefined || (total > 0n && total <= balance.raw)
  const price = prices[token]

  // One review for the distribution as a whole, run against the largest leg —
  // the one most likely to look distinctive to an observer.
  const report = useMemo(() => {
    if (recipients.length === 0) return null
    const largest = recipients.reduce((a, b) => (b.amount > a.amount ? b : a))
    return reviewPay({
      amount: largest.amount,
      decimals,
      token,
      recipient: largest.address,
      ledger,
      now: Date.now(),
    })
  }, [recipients, decimals, token, ledger])

  const submit = async () => {
    if (recipients.length === 0 || !enough) return
    try {
      if (mode === 'links') {
        const links = await sendClaimLinks({
          token,
          refundAfterS: DEFAULT_REFUND_WINDOW_S,
          legs: recipients.map((r) => ({
            amount: r.amount,
            ...(r.name ? { name: r.name } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          })),
        })
        setMinted(links)
      } else {
        await paySplit({ token, recipients, ...(note.trim() ? { note: note.trim() } : {}) })
      }
      if (report) noteDecision({ action: 'pay', report })
      setDone({ count: recipients.length, total })
    } catch {
      // The store surfaced the wallet's explanation.
    }
  }

  const unused = people.filter((p) => !lines.some((l) => l.person?.id === p.id))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      locked={submitting}
      title={done ? 'Everyone paid' : 'Pay several people'}
    >
      {!done ? (
        <div>
          {/* Who they are decides the rail: an address takes a private
              transfer, no address takes a hash-locked link. */}
          <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-sunk p-1.5">
            {(
              [
                { id: 'addresses', label: 'To addresses' },
                { id: 'links', label: 'As links' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`h-9 rounded-xl text-[13.5px] font-semibold transition-colors ${
                  mode === tab.id ? 'bg-card shadow-[0_1px_2px_rgba(18,18,20,0.08)]' : 'text-ink-muted'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="mb-4 mt-2.5 px-1 text-[12.5px] leading-relaxed text-ink-faint">
            {mode === 'links'
              ? 'For people with no wallet. Everyone gets their own link and their own refund path, funded together — one operation, one fee, nothing in the timing to line up.'
              : 'Straight to addresses they already have. One operation, and nobody sees what anyone else got.'}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {TOKEN_LIST.map((t) => t.symbol).map((symbol) => (
              <button
                key={symbol}
                onClick={() => setToken(symbol)}
                className={`h-9 flex-none rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                  symbol === token ? 'bg-ink text-white' : 'bg-sunk text-ink-soft hover:bg-rule'
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>

          {mode === 'links' ? (
            <button
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { key: `link-${current.length}-${current.length + 1}`, address: '', amountText: '' },
                ])
              }
              className="btn btn-quiet mt-4 w-full"
            >
              <Plus size={16} />
              Add a recipient
            </button>
          ) : null}

          {lines.length > 0 ? (
            <div className="card mt-4 divide-y divide-rule">
              {lines.map((line) => (
                <div key={line.key} className="flex items-center gap-3 px-4 py-3">
                  <Avatar
                    name={line.person?.name ?? line.address ?? ''}
                    size={36}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      {line.person?.name ??
                        (line.address ? shortAddress(line.address) : 'A link')}
                    </span>
                  </span>
                  <input
                    value={line.amountText}
                    onChange={(event) =>
                      setAmount(line.key, event.target.value.replace(/[^\d.]/g, ''))
                    }
                    placeholder="0"
                    inputMode="decimal"
                    aria-label={`Amount for ${line.person?.name ?? 'recipient'}`}
                    className="tabular h-9 w-24 rounded-xl border border-rule bg-card px-3 text-right text-[14px] outline-none focus:border-rule-strong"
                  />
                  <button
                    onClick={() => remove(line.key)}
                    aria-label="Remove"
                    className="grid size-7 flex-none place-items-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink"
                  >
                    <Close size={13} strokeWidth={2.2} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {lines.length > 1 ? (
            <div className="mt-3 flex gap-2">
              <input
                value={totalText}
                onChange={(event) => setTotalText(event.target.value.replace(/[^\d.]/g, ''))}
                placeholder={`Split a total evenly across ${lines.length}`}
                inputMode="decimal"
                className="h-10 min-w-0 flex-1 rounded-xl border border-rule bg-card px-3 text-[13.5px] outline-none focus:border-rule-strong"
              />
              <button onClick={splitEvenly} className="btn btn-quiet btn-small flex-none">
                Split evenly
              </button>
            </div>
          ) : null}

          {unused.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 px-1 text-[13px] font-semibold text-ink-muted">Add people</p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {unused.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => addPerson(person)}
                    className="flex w-[62px] flex-none flex-col items-center gap-1.5 transition-transform active:scale-95"
                  >
                    <Avatar name={person.name} size={46} className="bg-card" />
                    <span className="w-full truncate text-center text-[11.5px] text-ink-soft">
                      {person.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <input
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder="Or paste an address"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-xl border border-rule bg-card px-3 font-mono text-[12px] outline-none focus:border-rule-strong"
            />
            <button
              onClick={addPasted}
              disabled={!looksLikeStarknetAddress(pasted)}
              aria-label="Add address"
              className="btn btn-quiet btn-small flex-none !px-3"
            >
              <Plus size={15} />
            </button>
          </div>

          <input
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 80))}
            placeholder="Note — appears on every receipt (optional)"
            className="mt-3 h-10 w-full rounded-xl border border-rule bg-card px-3 text-[13.5px] outline-none focus:border-rule-strong"
          />

          {total > 0n ? (
            <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-card-soft px-4 py-3">
              <span className="text-[13.5px] text-ink-muted">
                {recipients.length} {recipients.length === 1 ? 'person' : 'people'}
              </span>
              <span className="tabular text-[15px] font-semibold">
                {formatUnits(total, decimals, 6)} {token}
                {price !== undefined ? (
                  <span className="ml-2 text-[12.5px] font-medium text-ink-muted">
                    {usdText(Number(formatUnits(total, decimals, 6).replace(/,/g, '')) * price)}
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}

          {report ? (
            <div className="mt-3">
              <GuardPanel report={report} />
            </div>
          ) : null}

          {error ? (
            <div className="mt-3">
              <ErrorNote message={error} onDismiss={clearError} />
            </div>
          ) : null}

          {!enough && total > 0n ? (
            <p className="mt-3 px-1 text-center text-[13px] font-semibold">
              That&rsquo;s more than you have in {token}.
            </p>
          ) : null}

          <button
            onClick={submit}
            disabled={recipients.length === 0 || submitting || !enough}
            className="btn btn-ink mt-4 w-full"
          >
            {submitting
              ? 'Waiting for your wallet…'
              : recipients.length > 0
                ? `Pay ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} privately`
                : 'Pay privately'}
          </button>

          <p className="mt-3 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-ink-faint">
            <ShieldCheck size={13} className="mt-0.5 flex-none" />
            One operation, one pool fee. Nobody you pay can see what anyone else received.
          </p>
        </div>
      ) : (
        <div className="pt-4 text-center">
          <SuccessMark />
          <p className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">
            {done.count} {done.count === 1 ? 'person' : 'people'} paid
          </p>
          <p className="mx-auto mt-2 max-w-[330px] text-[14px] leading-relaxed text-ink-muted">
            {formatUnits(done.total, decimals, 6)} {token}{' '}
            {minted
              ? 'was locked into one link each, in a single operation. Nobody needs a wallet to open one, and none of them can see the others.'
              : 'went out as a single private operation. Each person got their own receipt; none of them can see the others.'}
          </p>
          {lastTx ? (
            <p className="mt-3">
              <TxLink hash={lastTx.hash} />
            </p>
          ) : null}

          {minted ? (
            <div className="mt-5 space-y-2.5 text-left">
              {minted.map((link, index) => (
                <div key={link.url} className="card px-4 py-3.5">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-semibold">
                      {link.name ?? `Link ${index + 1}`}
                    </span>
                    <span className="tabular flex-none text-[13.5px] font-semibold">
                      {formatUnits(link.amount, decimals, 6)} {token}
                    </span>
                  </p>
                  <ShareLink
                    url={link.url}
                    shareText="I sent you money on Lumen"
                    privateLabel="the claim secret — this is the money"
                    className="mt-2.5"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <WorldSaw kind={minted ? 'claim' : 'private'} />
          <button onClick={onClose} className="btn btn-ink mt-7 w-full">
            <Check size={17} />
            Done
          </button>
        </div>
      )}
    </Sheet>
  )
}
