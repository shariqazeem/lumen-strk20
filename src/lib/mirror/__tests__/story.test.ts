// @vitest-environment node

/**
 * The strictest honesty boundary in the product.
 *
 * This runs against the connected account's own address and reports what a
 * stranger's heuristics would flag. Three failure modes matter and all three
 * are tested: claiming a pattern that is not there, describing a measured
 * pattern in words the data does not support, and — the one that turns an
 * instrument into a doxxing toy — handing the reader an interpretation the
 * code never computed.
 */

import { describe, expect, it } from 'vitest'
import { readAddress, summary } from '../story'
import type { PublicTransfer } from '../read'

const DAY = 86_400_000
const BASE = Date.UTC(2026, 6, 1, 9, 0, 0)

function transfer(over: Partial<PublicTransfer> = {}): PublicTransfer {
  return {
    token: 'USDC',
    amount: 1_000_000n,
    direction: 'out',
    counterparty: '0x0aaa',
    blockNumber: 1,
    timestamp: BASE,
    txHash: '0xdead',
    ...over,
  }
}

/** `count` transfers spaced exactly `gap` apart. */
function series(count: number, gap: number, over: Partial<PublicTransfer> = {}) {
  return Array.from({ length: count }, (_, i) =>
    transfer({ ...over, timestamp: BASE + i * gap, blockNumber: i }),
  )
}

describe('silence', () => {
  it('says nothing about an address with no history', () => {
    expect(readAddress([])).toEqual([])
  })

  it('does not invent a rhythm from three transfers', () => {
    const found = readAddress(series(3, DAY)).map((s) => s.id)
    expect(found).not.toContain('cadence')
    expect(found).not.toContain('hour-of-day')
  })

  it('does not call two counterparties a circle', () => {
    const thin = [transfer({ counterparty: '0x0a' }), transfer({ counterparty: '0x0b' })]
    expect(readAddress(thin).map((s) => s.id)).not.toContain('small-circle')
  })
})

describe('what it reads', () => {
  it('finds a schedule when the spacing barely varies', () => {
    const cadence = readAddress(series(10, 7 * DAY)).find((s) => s.id === 'cadence')
    expect(cadence).toBeDefined()
    expect(cadence!.text).toContain('7.0 days')
  })

  it('finds the hour of day, and names it as UTC', () => {
    const hour = readAddress(series(10, DAY)).find((s) => s.id === 'hour-of-day')
    expect(hour).toBeDefined()
    expect(hour!.text).toContain('09:00')
    expect(hour!.text).toContain('UTC')
  })

  it('names the heuristic behind every sentence', () => {
    for (const sentence of readAddress(series(12, DAY))) {
      expect(sentence.heuristic.trim()).not.toBe('')
    }
  })

  it('finds a repeated exact amount and quotes it', () => {
    // Spaced irregularly so only the amount pattern can fire.
    const jittered = [0, 1.3, 4.1, 9.7, 11.2].map((d, i) =>
      transfer({ timestamp: BASE + d * DAY, blockNumber: i, amount: 4_200_000n }),
    )
    const repeated = readAddress(jittered).find((s) => s.id === 'repeated-amount')
    expect(repeated).toBeDefined()
    expect(repeated!.text).toContain('4.2 USDC')
  })

  it('names the counterparty it saw most', () => {
    const mixed = [
      ...series(6, DAY, { counterparty: '0x0777de1ab77e57a1d8c2b3f4a5968de0000000000000000000000000000beef' }),
      transfer({ counterparty: '0x0123', timestamp: BASE + 9 * DAY }),
    ]
    const top = readAddress(mixed).find((s) => s.id === 'top-counterparty')
    expect(top).toBeDefined()
    expect(top!.text).toContain('6 of 7 transfers')
  })

  it('sorts strongest first, so the worst news leads', () => {
    const strengths = readAddress(series(12, DAY)).map((s) => s.strength)
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a))
  })
})

describe('honesty', () => {
  it('never names a job, a home, a city, or a state of mind', () => {
    // The film says "pays rent on the 1st" about a fiction. About a real
    // address only the number is knowable, so the code reports the number and
    // lets the reader draw the conclusion. Handing over the conclusion is what
    // separates an instrument from a doxxing toy.
    const banned =
      /\b(rent|salary|employer|landlord|payroll|city|home|commut|prescription|medic|awake|asleep|works|job|lives)\b/i
    const everything = readAddress([
      ...series(12, DAY, { counterparty: '0x0abc' }),
      ...series(4, 30 * DAY, { amount: 1_500_000_000n }),
    ])
    expect(everything.length).toBeGreaterThan(0)
    for (const sentence of everything) expect(sentence.text).not.toMatch(banned)
  })

  it('carries evidence for every sentence it prints', () => {
    for (const sentence of readAddress(series(12, DAY))) {
      expect(sentence.evidence.length).toBeGreaterThan(0)
      for (const line of sentence.evidence) expect(line.trim()).not.toBe('')
    }
  })
})

describe('summary', () => {
  it('counts both directions and distinct counterparties', () => {
    const counted = summary([
      transfer({ direction: 'in', counterparty: '0x0a' }),
      transfer({ direction: 'out', counterparty: '0x0a' }),
      transfer({ direction: 'out', counterparty: '0x0b' }),
    ])
    expect(counted).toEqual({ transfers: 3, counterparties: 2, received: 1, sent: 2 })
  })
})
