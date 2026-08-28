'use client'

/**
 * What a stranger's heuristics flag about an address.
 *
 * The landing film shows invented sentences about a fictional life — *pays
 * rent on the 1st*, *was in another city on the 14th*. Those are
 * interpretations, and this file does not make them. It reports the patterns
 * underneath: the same amount to the same counterparty on a monthly rhythm.
 * The reader may draw the conclusion; the code must not hand it to them.
 *
 * That distinction is the whole difference between an honest instrument and a
 * doxxing toy, so it is enforced by a test: no sentence here may name a job, a
 * landlord, a city, a diagnosis, or a state of mind. Each states a measured
 * pattern, names the heuristic that found it, carries its evidence, and stops.
 *
 * This only ever runs against the connected account's own address.
 */

import { shortAddress } from '@/lib/lumen/people'
import { TOKENS } from '@/lib/strk20/config'
import type { PublicTransfer } from './read'

export interface Sentence {
  id: string
  /** The pattern, stated as measured — never as motive. */
  text: string
  /** The class of analysis that found it, shown so nothing looks like magic. */
  heuristic: string
  /** The numbers behind it, so nothing has to be taken on trust. */
  evidence: string[]
  /** 0..1 — how strongly the pattern holds. Orders the report. */
  strength: number
}

const HOUR = 3_600_000
const DAY = 86_400_000

function amountOf(transfer: PublicTransfer): number {
  return Number(transfer.amount) / 10 ** TOKENS[transfer.token].decimals
}

function fmt(value: number): string {
  if (value === 0) return '0'
  if (value < 0.001) return value.toExponential(2)
  return value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 })
}

/** How evenly spaced a series is. Low means a schedule. */
function variation(gaps: number[]): number {
  if (gaps.length < 2) return 1
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (mean === 0) return 1
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
  return sd / mean
}

/* ------------------------------------------------------------------ */
/* the readings                                                        */
/* ------------------------------------------------------------------ */

/** Who this address deals with, and how concentrated that is. */
function relationships(transfers: PublicTransfer[]): Sentence[] {
  const out: Sentence[] = []
  const byPeer = new Map<string, PublicTransfer[]>()
  for (const transfer of transfers) {
    const list = byPeer.get(transfer.counterparty) ?? []
    list.push(transfer)
    byPeer.set(transfer.counterparty, list)
  }
  if (byPeer.size === 0) return out

  const ranked = [...byPeer.entries()].sort((a, b) => b[1].length - a[1].length)
  const [topPeer, topTransfers] = ranked[0]
  const share = topTransfers.length / transfers.length

  if (topTransfers.length >= 3) {
    out.push({
      id: 'top-counterparty',
      heuristic: 'counterparty concentration',
      text: `One counterparty, ${shortAddress(topPeer)}, accounts for ${topTransfers.length} of ${transfers.length} transfers.`,
      evidence: [
        `${(share * 100).toFixed(0)}% of observed activity`,
        `${byPeer.size} distinct counterpart${byPeer.size === 1 ? 'y' : 'ies'} in total`,
      ],
      strength: Math.min(1, share + 0.2),
    })
  }

  if (byPeer.size >= 2 && byPeer.size <= 6 && transfers.length >= 6) {
    out.push({
      id: 'small-circle',
      heuristic: 'counterparty concentration',
      text: `All ${transfers.length} transfers involve the same ${byPeer.size} addresses and no others.`,
      evidence: [`${transfers.length} transfers`, `${byPeer.size} counterparties`],
      strength: 0.55,
    })
  }
  return out
}

/** Rhythm — the failure that survives perfect cryptography. */
function rhythm(transfers: PublicTransfer[]): Sentence[] {
  const out: Sentence[] = []
  if (transfers.length < 4) return out

  const gaps: number[] = []
  for (let i = 1; i < transfers.length; i += 1) {
    gaps.push(transfers[i].timestamp - transfers[i - 1].timestamp)
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const cv = variation(gaps)

  if (cv < 0.5 && mean > HOUR) {
    const unit = mean >= DAY ? `${(mean / DAY).toFixed(1)} days` : `${Math.round(mean / HOUR)} hours`
    out.push({
      id: 'cadence',
      heuristic: 'cadence periodicity',
      text: `Transfers arrive about every ${unit}, on a spacing regular enough to predict.`,
      evidence: [`${gaps.length + 1} transfers`, `spacing varies by only ${(cv * 100).toFixed(0)}%`],
      strength: Math.min(1, 1 - cv),
    })
  }

  const hours = transfers.map((t) => new Date(t.timestamp).getUTCHours())
  const tally = new Map<number, number>()
  for (const hour of hours) tally.set(hour, (tally.get(hour) ?? 0) + 1)
  const [peakHour, peakCount] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  if (peakCount / hours.length > 0.3 && hours.length >= 6) {
    out.push({
      id: 'hour-of-day',
      heuristic: 'time-of-day clustering',
      text: `Activity clusters in a single hour of the day — ${String(peakHour).padStart(2, '0')}:00 UTC.`,
      evidence: [
        `${peakCount} of ${hours.length} transfers in that one hour`,
        'hour-of-day survives every proof system, because it is metadata',
      ],
      strength: Math.min(1, peakCount / hours.length + 0.2),
    })
  }

  const days = transfers.map((t) => new Date(t.timestamp).getUTCDay())
  const weekday = days.filter((d) => d >= 1 && d <= 5).length
  if (transfers.length >= 8 && weekday / days.length > 0.85) {
    out.push({
      id: 'weekdays',
      heuristic: 'day-of-week clustering',
      text: `Activity falls on weekdays — ${weekday} of ${days.length} transfers land Monday to Friday.`,
      evidence: [`${days.length - weekday} at weekends`],
      strength: 0.6,
    })
  }
  return out
}

/** Amounts — round ones, and ones that repeat exactly. */
function amounts(transfers: PublicTransfer[]): Sentence[] {
  const out: Sentence[] = []
  if (transfers.length === 0) return out

  const exact = new Map<string, PublicTransfer[]>()
  for (const transfer of transfers) {
    const key = `${transfer.token}:${transfer.amount}`
    const list = exact.get(key) ?? []
    list.push(transfer)
    exact.set(key, list)
  }
  const repeated = [...exact.values()].filter((list) => list.length >= 3).sort((a, b) => b.length - a.length)
  if (repeated.length > 0) {
    const group = repeated[0]
    out.push({
      id: 'repeated-amount',
      heuristic: 'repeated amount',
      text: `The same amount, ${fmt(amountOf(group[0]))} ${group[0].token}, repeats ${group.length} times.`,
      evidence: [
        `identical to the smallest unit across ${group.length} transfers`,
        'an exactly repeated amount indexes as well as a name',
      ],
      strength: Math.min(1, 0.4 + group.length / 12),
    })
  }

  const round = transfers.filter((transfer) => {
    const value = amountOf(transfer)
    return value >= 1 && Number.isInteger(value)
  })
  if (round.length / transfers.length > 0.25 && round.length >= 3) {
    out.push({
      id: 'round-numbers',
      heuristic: 'round amounts',
      text: `${round.length} of ${transfers.length} amounts are whole units, which narrows a search far faster than a random one.`,
      evidence: ['round amounts are chosen by people, not by protocols'],
      strength: 0.5,
    })
  }
  return out
}

/** How long the record runs. */
function tenure(transfers: PublicTransfer[]): Sentence[] {
  if (transfers.length < 2) return []
  const span = transfers[transfers.length - 1].timestamp - transfers[0].timestamp
  if (span < DAY) return []
  return [
    {
      id: 'tenure',
      heuristic: 'record span',
      text: `The record runs ${Math.round(span / DAY)} days so far, and nothing in it expires.`,
      evidence: [
        `first observed ${new Date(transfers[0].timestamp).toISOString().slice(0, 10)}`,
        `${transfers.length} transfers, all still readable by anyone`,
      ],
      strength: 0.35,
    },
  ]
}

/**
 * Every pattern the heuristics find, strongest first.
 *
 * Returns nothing rather than reaching when the record is too thin — an empty
 * report is a true statement about a quiet address, and inventing a pattern
 * from four transfers would be the exact dishonesty this page exists to
 * expose.
 */
export function readAddress(transfers: PublicTransfer[]): Sentence[] {
  return [
    ...relationships(transfers),
    ...rhythm(transfers),
    ...amounts(transfers),
    ...tenure(transfers),
  ].sort((a, b) => b.strength - a.strength)
}

/** Headline numbers, stated without spin. */
export function summary(transfers: PublicTransfer[]) {
  const peers = new Set(transfers.map((t) => t.counterparty))
  const received = transfers.filter((t) => t.direction === 'in').length
  return {
    transfers: transfers.length,
    counterparties: peers.size,
    received,
    sent: transfers.length - received,
  }
}
