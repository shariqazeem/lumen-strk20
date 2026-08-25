'use client'

/**
 * My page — the owner's side of the pay page.
 *
 * Two flavours behind one segmented control: the standing page (name, emoji,
 * optional USD presets — "put it in your bio"), and a one-off request that
 * locks an exact token amount ("invoice a client"). Both are just links; the
 * page travels in the fragment and the settings live on this device.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { encodePayPage, loadMyPage, saveMyPage } from '@/lib/lumen/paypage'
import { pickEmoji } from '@/lib/lumen/people'
import { TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, Avatar, parseAmount } from './bits'
import { Check, Copy, Share } from './icons'

export function MyPageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, registered, prices, preview } = useLumen()

  const saved = useMemo(
    () => (address && !preview ? loadMyPage(address) : null),
    [address, preview],
  )

  const [mode, setMode] = useState<'page' | 'request'>('page')
  const [name, setName] = useState(saved?.name ?? '')
  const [emoji, setEmoji] = useState(saved?.emoji ?? '')
  const [presetsText, setPresetsText] = useState(
    saved && saved.presets.length > 0 ? saved.presets.join(', ') : '',
  )
  const [copied, setCopied] = useState<'page' | 'request' | null>(null)

  const [reqToken, setReqToken] = useState<TokenSymbol>('USDC')
  const [reqAmountText, setReqAmountText] = useState('')
  const [reqNote, setReqNote] = useState('')

  const presets = presetsText
    .split(/[,\s]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3)

  const effectiveEmoji = emoji.trim() || (name.trim() ? pickEmoji(name.trim()) : '🙂')

  const pageUrl =
    address && name.trim()
      ? encodePayPage(window.location.origin, {
          v: 1,
          n: name.trim(),
          a: address,
          e: effectiveEmoji,
          ...(presets.length > 0 ? { p: presets } : {}),
        })
      : null

  const reqAmount = parseAmount(reqAmountText, reqToken)
  const requestUrl =
    address && name.trim() && reqAmount > 0n
      ? encodePayPage(window.location.origin, {
          v: 1,
          n: name.trim(),
          a: address,
          e: effectiveEmoji,
          r: { t: reqToken, a: reqAmount.toString() },
          ...(reqNote.trim() ? { m: reqNote.trim() } : {}),
        })
      : null

  const copy = async (url: string, which: 'page' | 'request') => {
    if (address && !preview && name.trim()) {
      saveMyPage(address, { name: name.trim(), emoji: effectiveEmoji, presets })
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(which)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      // URL stays visible.
    }
  }

  const share = async (url: string, which: 'page' | 'request') => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, text: `Pay ${name.trim() || 'me'} privately on Lumen` })
        return
      } catch {
        // Fall through to copy.
      }
    }
    await copy(url, which)
  }

  const activeUrl = mode === 'page' ? pageUrl : requestUrl

  return (
    <Sheet open={open} onClose={onClose} title="Get paid">
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-sunk p-1.5">
        {(
          [
            { id: 'page', label: 'My page' },
            { id: 'request', label: 'Request an amount' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`h-9 rounded-xl text-[13.5px] font-semibold transition-colors ${
              mode === tab.id
                ? 'bg-card shadow-[0_1px_2px_rgba(18,18,20,0.08)]'
                : 'text-ink-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Avatar emoji={effectiveEmoji} size={52} />
        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 40))}
            placeholder="Your display name"
            autoFocus={!saved}
            className="h-11 w-full rounded-2xl border border-rule bg-card px-4 text-[15px] outline-none focus:border-rule-strong"
          />
        </div>
        <input
          value={emoji}
          onChange={(event) => setEmoji(event.target.value.slice(0, 4))}
          placeholder="🙂"
          aria-label="Emoji"
          className="h-11 w-14 rounded-2xl border border-rule bg-card text-center text-[17px] outline-none focus:border-rule-strong"
        />
      </div>

      {mode === 'page' ? (
        <div className="mt-3">
          <input
            value={presetsText}
            onChange={(event) => setPresetsText(event.target.value.slice(0, 30))}
            placeholder="Preset amounts in USD — e.g. 5, 20, 50 (optional)"
            inputMode="decimal"
            className="h-11 w-full rounded-2xl border border-rule bg-card px-4 text-[14px] outline-none focus:border-rule-strong"
          />
          <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-ink-faint">
            Your page shows your name and receiving address — the same fact your Receive code
            shows. Every payment to it arrives privately: no public sender, no public amount, and
            no payer can see any other.
          </p>
        </div>
      ) : (
        <div className="mt-1">
          <AmountField
            value={reqAmountText}
            onChange={setReqAmountText}
            token={reqToken}
            onToken={setReqToken}
            tokens={TOKEN_LIST.map((t) => t.symbol)}
            prices={prices}
          />
          <input
            value={reqNote}
            onChange={(event) => setReqNote(event.target.value.slice(0, 80))}
            placeholder="What's it for — shown on the page (optional)"
            className="mt-4 h-11 w-full rounded-2xl border border-rule bg-card px-4 text-[14px] outline-none focus:border-rule-strong"
          />
        </div>
      )}

      {registered === false ? (
        <p className="mt-4 rounded-2xl bg-card-soft px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">One step first:</span> add money once to
          activate your private account — payments to your page need it on the receiving side.
        </p>
      ) : null}

      {activeUrl ? (
        <>
          <button
            onClick={() => copy(activeUrl, mode)}
            className="mt-5 w-full break-all rounded-2xl border border-rule bg-card-soft px-4 py-3.5 text-left font-mono text-[11.5px] leading-relaxed text-ink-soft transition-colors hover:border-rule-strong"
          >
            {activeUrl}
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <button onClick={() => copy(activeUrl, mode)} className="btn btn-quiet">
              {copied === mode ? <Check size={16} /> : <Copy size={16} />}
              {copied === mode ? 'Copied' : 'Copy link'}
            </button>
            <button onClick={() => share(activeUrl, mode)} className="btn btn-ink">
              <Share size={16} />
              Share
            </button>
          </div>
        </>
      ) : (
        <p className="mt-5 text-center text-[13px] text-ink-faint">
          {mode === 'page'
            ? 'Add your name and your page link appears here.'
            : 'Add a name and an amount and the request link appears here.'}
        </p>
      )}
    </Sheet>
  )
}
