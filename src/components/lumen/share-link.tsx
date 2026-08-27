'use client'

/**
 * How a link is handed over.
 *
 * A raw URL printed in monospace was the ugliest thing in the product, and it
 * was also a wasted argument. Everything after the `#` is the whole reason
 * these links work without an account: browsers never put a fragment in the
 * request, so the secret — or the address — reaches the recipient and nothing
 * else. So the split is drawn on purpose: the readable half in ink, the
 * private half named as private rather than dumped as noise.
 *
 * Tapping the row reveals the full string for anyone who wants to inspect it.
 */

import { useEffect, useState } from 'react'
import { Check, Copy, Share } from './icons'

function split(url: string): { head: string; fragment: string } {
  const hash = url.indexOf('#')
  if (hash < 0) return { head: url, fragment: '' }
  return { head: url.slice(0, hash), fragment: url.slice(hash + 1) }
}

/** `https://lumen.app/pay/shariq` → `lumen.app/pay/shariq` */
function readable(head: string): string {
  return head.replace(/^https?:\/\//, '')
}

export function ShareLink({
  url,
  shareText,
  privateLabel,
  onHandOff,
  className = '',
}: {
  url: string
  /** Text offered to the OS share sheet alongside the URL. */
  shareText: string
  /** What the fragment actually holds — the honest name for it. */
  privateLabel: string
  /** Run when the link is actually handed over, not merely rendered. */
  onHandOff?: () => void
  className?: string
}) {
  const { head, fragment } = split(url)
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    onHandOff?.()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // The full string is one tap away below.
      setRevealed(true)
    }
  }

  const share = async () => {
    onHandOff?.()
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, text: shareText })
        return
      } catch {
        // Dismissed or unsupported — fall through to copy.
      }
    }
    await copy()
  }

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-2xl border border-rule bg-card-soft text-left">
        <button
          onClick={() => setRevealed((value) => !value)}
          aria-expanded={revealed}
          className="block w-full px-4 pb-3 pt-3.5 text-left"
        >
          <p className="truncate text-[14px] font-medium tracking-[-0.01em] text-ink">
            {readable(head)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <span className="font-mono text-ink-muted">#</span>
            <span className="min-w-0 flex-1 truncate">
              {revealed ? (
                <span className="font-mono text-[11.5px] text-ink-soft">{fragment}</span>
              ) : (
                privateLabel
              )}
            </span>
            <span className="flex-none text-[11px] text-ink-faint underline decoration-rule-strong underline-offset-2">
              {revealed ? 'Hide' : 'Show'}
            </span>
          </p>
        </button>

        <p className="border-t border-rule px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
          The part after <span className="font-mono">#</span> is never sent to any server — not
          even ours. It travels only inside the link you send.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <button onClick={copy} className="btn btn-quiet">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button onClick={share} className="btn btn-ink">
          <Share size={16} />
          Share
        </button>
      </div>
    </div>
  )
}
