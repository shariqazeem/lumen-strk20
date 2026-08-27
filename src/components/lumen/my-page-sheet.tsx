'use client'

/**
 * My page — the owner's side of the pay page.
 *
 * Two flavours behind one segmented control: the standing page (name and
 * optional USD presets — "put it in your bio"), and a one-off request that
 * locks an exact token amount ("invoice a client"). Both are just links; the
 * page travels in the fragment and the settings live on this device.
 */

import { useMemo, useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { encodePayPage, loadMyPage, saveMyPage } from '@/lib/lumen/paypage'
import { TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { Sheet } from './sheet'
import { AmountField, Avatar, parseAmount } from './bits'
import { ShareLink } from './share-link'

/** Up to three; tapping toggles. Beats parsing a comma-separated string. */
const PRESET_CHOICES = [5, 10, 20, 50, 100] as const

export function MyPageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, registered, prices } = useLumen()

  const saved = useMemo(
    () => (address ? loadMyPage(address) : null),
    [address],
  )

  const [mode, setMode] = useState<'page' | 'request'>('page')
  const [name, setName] = useState(saved?.name ?? '')
  const [presetsText, setPresetsText] = useState(
    saved && saved.presets.length > 0 ? saved.presets.join(', ') : '',
  )

  const [reqToken, setReqToken] = useState<TokenSymbol>('USDC')
  const [reqAmountText, setReqAmountText] = useState('')
  const [reqNote, setReqNote] = useState('')

  const presets = presetsText
    .split(/[,\s]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3)


  const pageUrl =
    address && name.trim()
      ? encodePayPage(window.location.origin, {
          v: 1,
          n: name.trim(),
          a: address,
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
          r: { t: reqToken, a: reqAmount.toString() },
          ...(reqNote.trim() ? { m: reqNote.trim() } : {}),
        })
      : null

  // Handing the link over is the moment the page stops being a draft.
  const remember = () => {
    if (address && name.trim()) {
      saveMyPage(address, { name: name.trim(), presets })
    }
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

      <div className="mt-5 flex items-center gap-3.5">
        <Avatar name={name} size={56} />
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 40))}
          placeholder="Your name"
          autoFocus={!saved}
          className="h-12 min-w-0 flex-1 rounded-2xl border border-rule bg-card px-4 text-[16px] font-medium outline-none focus:border-rule-strong"
        />
      </div>

      {mode === 'page' ? (
        <div className="mt-3">
          <p className="mb-2 px-1 text-[13px] font-semibold text-ink-muted">
            Quick amounts <span className="font-normal text-ink-faint">— optional</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_CHOICES.map((choice) => {
              const on = presets.includes(choice)
              return (
                <button
                  key={choice}
                  onClick={() =>
                    setPresetsText(
                      (on
                        ? presets.filter((p) => p !== choice)
                        : [...presets, choice].sort((a, b) => a - b).slice(0, 3)
                      ).join(', '),
                    )
                  }
                  aria-pressed={on}
                  className={`h-9 rounded-full px-4 text-[13.5px] font-semibold transition-colors ${
                    on ? 'bg-ink text-white' : 'bg-sunk text-ink-soft hover:bg-rule'
                  }`}
                >
                  ${choice}
                </button>
              )
            })}
          </div>
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
        <ShareLink
          url={activeUrl}
          onHandOff={remember}
          shareText={`Pay ${name.trim()} privately on Lumen`}
          privateLabel="your page, packed into the link"
          className="mt-5"
        />
      ) : (
        <p className="mt-5 text-center text-[13px] text-ink-faint">
          {mode === 'page'
            ? 'Add your name and your page link appears here.'
            : 'Add a name and an amount and the request link appears here.'}
        </p>
      )}

      <p className="mt-4 px-1 text-[12.5px] leading-relaxed text-ink-faint">
        The page shows your name and receiving address — the same fact your Receive code shows.
        What it does not show is anything that happens next: no public sender, no public amount,
        and no payer can see any other.
      </p>
    </Sheet>
  )
}
