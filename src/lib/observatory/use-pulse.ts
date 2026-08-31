'use client'

/**
 * One reading of the pool per session, shared by everything that wants it.
 *
 * The scan walks several thousand events, so it is deliberately not per-sheet
 * and not on a timer. A crowd measured over 48 hours does not change in the
 * minute between opening two screens, and a product that re-scans on every
 * render is a product that hammers a public RPC to tell you the same thing.
 *
 * `null` while loading and `null` on failure are the same to a caller, because
 * both mean the same thing: say nothing. An opinion the app cannot form is an
 * opinion it must not fake.
 */

import { useEffect, useState } from 'react'
import { BLOCKS_PER_HOUR, readPoolPulse, type PoolPulse } from './pool'

/** How far back to look. Two days is long enough to smooth a quiet night. */
const WINDOW = BLOCKS_PER_HOUR * 48
/** A reading older than this is refetched on the next mount. */
const STALE_AFTER_MS = 10 * 60_000

let cached: PoolPulse | null = null
let inFlight: Promise<PoolPulse | null> | null = null

async function load(): Promise<PoolPulse | null> {
  if (cached && Date.now() - cached.readAt < STALE_AFTER_MS) return cached
  // Share one request between every component that mounts at once, rather than
  // firing the same scan three times because three sheets want it.
  inFlight ??= readPoolPulse(WINDOW).then((pulse) => {
    if (pulse) cached = pulse
    inFlight = null
    return pulse
  })
  return inFlight
}

export function usePoolPulse(): PoolPulse | null {
  const [pulse, setPulse] = useState<PoolPulse | null>(cached)

  useEffect(() => {
    if (pulse) return
    let live = true
    void load().then((next) => {
      if (live) setPulse(next)
    })
    return () => {
      live = false
    }
  }, [pulse])

  return pulse
}
