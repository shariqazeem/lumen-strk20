'use client'

/**
 * The bottom sheet — Lumen's one modal surface.
 *
 * Slides up with the Apple sheet curve, dismisses on backdrop tap, Escape, or
 * the grabber row's close button. Unmount is deferred until the exit
 * animation finishes so closing never pops.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Close } from './icons'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Blocks dismissal while a wallet prompt is in flight. */
  locked?: boolean
}

const EXIT_MS = 300

export function Sheet({ open, onClose, title, children, locked = false }: SheetProps) {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      if (exitTimer.current) clearTimeout(exitTimer.current)
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setLeaving(true)
    exitTimer.current = setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, EXIT_MS)
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
    // `mounted` is deliberately not a dependency: it would re-arm the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const requestClose = useCallback(() => {
    if (!locked) onClose()
  }, [locked, onClose])

  useEffect(() => {
    if (!mounted) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [mounted, requestClose])

  if (!mounted) return null

  return (
    <>
      <div
        className={`sheet-backdrop ${leaving ? 'backdrop-leaving' : ''}`}
        onClick={requestClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`sheet ${leaving ? 'sheet-leaving' : ''}`}
      >
        <div className="grabber" />
        <div className="flex items-center justify-between px-6 pt-4 pb-1">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">{title}</h2>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full bg-sunk text-ink-muted transition-colors hover:text-ink"
          >
            <Close size={15} strokeWidth={2.2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 pt-2">
          {children}
        </div>
      </div>
    </>
  )
}
