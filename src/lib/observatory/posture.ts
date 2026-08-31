'use client'

/**
 * What the pool's activity means for the move you are about to make.
 *
 * The guard in `lib/deanon` reads one transaction and asks whether its *shape*
 * gives you away. This asks the other half of the question, the half nothing
 * else on this chain answers: **is there anybody to hide behind right now?**
 *
 * A private transfer is only as private as the set it disappears into. Perfect
 * cryptography in an empty hour still narrows you to whoever was awake. That is
 * not a hypothetical — measured over 48 hours on mainnet, STRK saw 400 public
 * moves and strkBTC saw 14. Identical operations, wildly different cover.
 *
 * Every threshold below is calibrated against readings taken from mainnet, and
 * they are constants rather than magic numbers so the calibration is arguable.
 * Pure functions over a `PoolPulse`, so the judgement is testable without a
 * chain.
 */

import { TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'
import { notesPerHour, peersFor, type PoolPulse } from './pool'

/**
 * Calibrated 31 Aug 2026 against a 48-hour mainnet window: STRK 400 moves,
 * USDC 146, strkBTC 14, xstrkBTC 2, ETH 2. The boundaries sit where those
 * numbers actually separate, not at round figures.
 */
export const CROWDED_MOVES = 100
export const THIN_MOVES = 20
/** Private operations per hour. The same window ran at ~7.4. */
export const BUSY_PER_HOUR = 6
export const QUIET_PER_HOUR = 3

export type Stance = 'crowded' | 'thin' | 'exposed'

export interface Reading {
  stance: Stance
  /** One sentence someone can act on. */
  headline: string
  /** The evidence, in numbers, so the claim can be checked. */
  because: string
  /** Public moves in this asset over the window. */
  peers: number
  /** Private operations per hour across the whole pool. */
  perHour: number
  /**
   * An asset with materially deeper cover right now, when one exists. The
   * honest suggestion is to hold there and convert at the last moment, not to
   * abandon the asset you wanted.
   */
  deeper?: TokenSymbol
}

function stanceOf(peers: number): Stance {
  if (peers >= CROWDED_MOVES) return 'crowded'
  if (peers >= THIN_MOVES) return 'thin'
  return 'exposed'
}

/** The asset with the most cover, when it is meaningfully better than this one. */
function deeperThan(pulse: PoolPulse, symbol: TokenSymbol, peers: number): TokenSymbol | undefined {
  let best: { symbol: TokenSymbol; peers: number } | null = null
  for (const token of TOKEN_LIST) {
    if (token.symbol === symbol) continue
    const count = peersFor(pulse, token.symbol)
    if (!best || count > best.peers) best = { symbol: token.symbol, peers: count }
  }
  // Only worth saying if it is a different league, not marginally ahead.
  if (!best || best.peers < CROWDED_MOVES || best.peers < peers * 3) return undefined
  return best.symbol
}

const hours = (pulse: PoolPulse) => Math.max(1, Math.round(pulse.spanBlocks / 2_100))

/**
 * Read the crowd for one asset.
 *
 * Deliberately blunt about a thin set even when that asset is the one Lumen
 * leads with. A product that will not say its own headline feature is risky
 * right now is not measuring anything — it is advertising.
 */
export function readCrowd(pulse: PoolPulse, symbol: TokenSymbol): Reading {
  const peers = peersFor(pulse, symbol)
  const perHour = notesPerHour(pulse)
  const stance = stanceOf(peers)
  const window = `${hours(pulse)}h`
  const deeper = deeperThan(pulse, symbol, peers)

  const because =
    `${peers} public ${symbol} ${peers === 1 ? 'move' : 'moves'} in the pool over ${window}` +
    (deeper ? `, against ${peersFor(pulse, deeper)} for ${deeper}` : '') +
    `. ${perHour.toFixed(1)} private operations an hour.`

  if (stance === 'exposed') {
    return {
      stance,
      headline: `Almost nobody else is moving ${symbol} right now.`,
      because,
      peers,
      perHour,
      ...(deeper ? { deeper } : {}),
    }
  }

  if (stance === 'thin') {
    return {
      stance,
      headline: `A thin crowd for ${symbol} today.`,
      because,
      peers,
      perHour,
      ...(deeper ? { deeper } : {}),
    }
  }

  return {
    stance,
    headline:
      perHour >= BUSY_PER_HOUR
        ? `Good moment — ${symbol} is busy and the pool is active.`
        : `${symbol} has a deep crowd, though the pool is quiet right now.`,
    because,
    peers,
    perHour,
  }
}

/**
 * What to do about it, in the voice the product already uses.
 *
 * Never a blocking dialog. Lumen's whole posture is that the user is paying
 * someone, not operating a privacy tool — so this is an opinion offered beside
 * the action, and the action always stays available.
 */
export function adviceFor(reading: Reading, symbol: TokenSymbol): string {
  if (reading.stance === 'crowded') {
    return `Nothing to wait for. Your move blends into ${reading.peers} others.`
  }
  if (reading.stance === 'thin') {
    return reading.deeper
      ? `It will still work. If you can wait, ${reading.deeper} is where the crowd is — hold there and convert when you need ${symbol}.`
      : `It will still work — there is just less to hide behind than usual.`
  }
  return reading.deeper
    ? `Moving now makes this operation distinctive. Holding in ${reading.deeper} and converting at the moment you need ${symbol} gives you a much larger set.`
    : `Moving now makes this operation distinctive. Waiting for company is the only thing that changes that.`
}

/** Whether the pool as a whole is worth waiting out, independent of asset. */
export function momentIsQuiet(pulse: PoolPulse): boolean {
  return notesPerHour(pulse) < QUIET_PER_HOUR
}
