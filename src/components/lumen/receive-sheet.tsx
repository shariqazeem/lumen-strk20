'use client'

/**
 * Receive — your address as a dot-matrix code and a copy button.
 *
 * Receiving privately needs no ceremony: senders pay your address through the
 * pool and nothing public connects the two of you. The address itself is
 * public (it always was); what stays invisible is everything that moves.
 */

import { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { useLumen } from '@/lib/lumen/store'
import { Sheet } from './sheet'
import { Check, Copy } from './icons'

function QrDots({ value }: { value: string }) {
  const modules = useMemo(() => {
    try {
      const qr = qrcode(0, 'M')
      qr.addData(value)
      qr.make()
      const count = qr.getModuleCount()
      const dots: Array<{ x: number; y: number }> = []
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) dots.push({ x: col, y: row })
        }
      }
      return { count, dots }
    } catch {
      return null
    }
  }, [value])

  if (!modules) return null

  return (
    <svg
      viewBox={`0 0 ${modules.count} ${modules.count}`}
      className="size-full"
      role="img"
      aria-label="Address code"
    >
      {modules.dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x + 0.5}
          cy={dot.y + 0.5}
          r={0.42}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

export function ReceiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, walletName } = useLumen()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard denied — the address is still visible to copy by hand.
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Receive">
      {address ? (
        <div className="text-center">
          <div className="card mx-auto w-fit p-5">
            <div className="size-[216px] text-ink">
              <QrDots value={address} />
            </div>
          </div>

          <p className="mx-auto mt-5 max-w-[300px] break-all font-mono text-[12px] leading-relaxed text-ink-muted">
            {address}
          </p>

          <button onClick={copy} className="btn btn-ink mt-5 w-full">
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>

          <div className="mt-6 space-y-2 rounded-2xl bg-card-soft px-4 py-4 text-left text-[13px] leading-relaxed text-ink-muted">
            <p>
              <span className="font-semibold text-ink">Payments to you are private.</span> When
              someone pays this address through Lumen or any STRK20 wallet, no amount, no sender
              and no link between you two ever appears on-chain.
            </p>
            <p>
              First time? {walletName ?? 'Your wallet'} registers you with the privacy pool once,
              automatically.
            </p>
          </div>
        </div>
      ) : null}
    </Sheet>
  )
}
