import { describe, expect, it } from 'vitest'
import {
  DEMO_POOL,
  aggregateLinkability,
  bandFor,
  demoScenarios,
  runDeanonymization,
} from '@/lib/deanon/engine'
import {
  amountCorrelation,
  cadencePeriodicity,
  coefficientOfVariation,
  nearlyEqual,
  repeatedAmount,
  roundNumber,
  roundnessScore,
  timingCorrelation,
  anonymitySetThin,
  exitAmountMatch,
} from '@/lib/deanon/heuristics'
import type { Finding, ObservedEvent } from '@/lib/deanon/types'

const NOW = 1_760_000_000_000
const CTX = { now: NOW, pool: DEMO_POOL }
const HOUR = 3_600_000
const DAY = 24 * HOUR

const usdc = (value: number) => BigInt(Math.round(value * 1e6))

function event(partial: Partial<ObservedEvent> & { timestamp: number }): ObservedEvent {
  return {
    kind: 'deposit',
    asset: 'USDC',
    amount: usdc(1234.56),
    amountKnown: true,
    tier: 'USDC',
    ...partial,
  }
}

/* ------------------------------------------------------------------ */
/*  The demo contrast — this IS the argument, so it must hold          */
/* ------------------------------------------------------------------ */

describe('demo scenarios', () => {
  it('scores the naive footprint as exposed', () => {
    const { naive } = demoScenarios(NOW)
    const report = runDeanonymization(naive, CTX)

    expect(report.linkabilityScore).toBeGreaterThanOrEqual(70)
    expect(report.band).toBe('exposed')
  })

  it('scores the Lumen-managed footprint as shielded', () => {
    const { managed } = demoScenarios(NOW)
    const report = runDeanonymization(managed, CTX)

    expect(report.linkabilityScore).toBeLessThanOrEqual(25)
    expect(report.band).toBe('shielded')
  })

  it('separates the two by a wide, demonstrable margin', () => {
    const { naive, managed } = demoScenarios(NOW)
    const exposed = runDeanonymization(naive, CTX).linkabilityScore
    const shielded = runDeanonymization(managed, CTX).linkabilityScore

    expect(exposed - shielded).toBeGreaterThan(45)
  })

  it('catches the naive user on amount correlation specifically', () => {
    const { naive } = demoScenarios(NOW)
    const report = runDeanonymization(naive, CTX)

    expect(report.findings.some((f) => f.heuristic === 'amount-correlation')).toBe(true)
    expect(report.findings.some((f) => f.heuristic === 'round-number')).toBe(true)
  })

  it('never invents an amount for a private in-pool action', () => {
    const { managed } = demoScenarios(NOW)
    const privateActions = managed.filter((e) => e.kind === 'action')

    expect(privateActions.length).toBeGreaterThan(0)
    for (const action of privateActions) {
      expect(action.amountKnown).toBe(false)
      expect(action.amount).toBe(0n)
    }
  })
})

/* ------------------------------------------------------------------ */
/*  Engine contract                                                    */
/* ------------------------------------------------------------------ */

describe('runDeanonymization', () => {
  it('returns a clean, non-throwing report for an empty footprint', () => {
    const report = runDeanonymization([], CTX)

    expect(report.linkabilityScore).toBe(0)
    expect(report.band).toBe('shielded')
    expect(report.findings).toEqual([])
    expect(report.observedCount).toBe(0)
    expect(report.summary).toMatch(/nothing public/i)
  })

  it('sorts findings most dangerous first', () => {
    const { naive } = demoScenarios(NOW)
    const { findings } = runDeanonymization(naive, CTX)

    const rank = { critical: 4, high: 3, medium: 2, low: 1 } as const
    for (let i = 1; i < findings.length; i += 1) {
      expect(rank[findings[i - 1].severity]).toBeGreaterThanOrEqual(rank[findings[i].severity])
    }
  })

  it('is deterministic', () => {
    const { naive } = demoScenarios(NOW)
    const a = runDeanonymization(naive, CTX)
    const b = runDeanonymization(naive, CTX)

    expect(a.linkabilityScore).toBe(b.linkabilityScore)
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id))
  })

  it('gives every finding an actionable fix', () => {
    const { naive } = demoScenarios(NOW)
    const { findings } = runDeanonymization(naive, CTX)

    expect(findings.length).toBeGreaterThan(0)
    for (const finding of findings) {
      expect(finding.fix.label.length).toBeGreaterThan(8)
      expect(finding.fix.action.length).toBeGreaterThan(0)
      expect(finding.evidence.length).toBeGreaterThan(0)
    }
  })
})

describe('aggregateLinkability', () => {
  const finding = (confidence: number, severity: Finding['severity']): Finding => ({
    id: `${severity}-${confidence}`,
    heuristic: 'round-number',
    title: 't',
    severity,
    confidence,
    explanation: 'e',
    evidence: ['x'],
    fix: { label: 'fix it now', action: 'split-amounts' },
  })

  it('is bounded to 0..100', () => {
    const many = Array.from({ length: 40 }, () => finding(1, 'critical'))
    expect(aggregateLinkability(many)).toBeLessThanOrEqual(100)
    expect(aggregateLinkability([])).toBe(0)
  })

  it('does not let weak signals accumulate into certainty', () => {
    const weak = Array.from({ length: 6 }, () => finding(0.3, 'low'))
    expect(aggregateLinkability(weak)).toBeLessThan(45)
  })

  it('lets a single critical finding dominate', () => {
    expect(aggregateLinkability([finding(0.95, 'critical')])).toBeGreaterThan(70)
  })

  it('never decreases when another finding is added', () => {
    const one = [finding(0.6, 'high')]
    const two = [...one, finding(0.4, 'medium')]
    expect(aggregateLinkability(two)).toBeGreaterThanOrEqual(aggregateLinkability(one))
  })
})

describe('bandFor', () => {
  it('maps the score onto the documented thresholds', () => {
    expect(bandFor(85)).toBe('exposed')
    expect(bandFor(70)).toBe('exposed')
    expect(bandFor(55)).toBe('weak')
    expect(bandFor(30)).toBe('guarded')
    expect(bandFor(5)).toBe('shielded')
  })
})

/* ------------------------------------------------------------------ */
/*  Heuristics: each fires on a positive and stays silent on a negative */
/* ------------------------------------------------------------------ */

describe('amountCorrelation', () => {
  it('links a withdrawal that matches a deposit', () => {
    const findings = amountCorrelation([
      event({ timestamp: NOW - DAY, kind: 'deposit', amount: usdc(4182.44) }),
      event({ timestamp: NOW, kind: 'withdrawal', amount: usdc(4180) }),
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0].confidence).toBeGreaterThan(0)
  })

  it('stays silent on genuinely different amounts', () => {
    expect(
      amountCorrelation([
        event({ timestamp: NOW - DAY, kind: 'deposit', amount: usdc(4182.44) }),
        event({ timestamp: NOW, kind: 'withdrawal', amount: usdc(917.03) }),
      ]),
    ).toEqual([])
  })

  it('ignores a withdrawal that precedes the deposit', () => {
    expect(
      amountCorrelation([
        event({ timestamp: NOW, kind: 'deposit', amount: usdc(1000) }),
        event({ timestamp: NOW - DAY, kind: 'withdrawal', amount: usdc(1000) }),
      ]),
    ).toEqual([])
  })
})

describe('roundNumber', () => {
  it('flags a round thousand', () => {
    expect(roundNumber([event({ timestamp: NOW, amount: usdc(1000) })])).toHaveLength(1)
  })

  it('ignores a deliberately irregular amount', () => {
    expect(roundNumber([event({ timestamp: NOW, amount: usdc(1412.77) })])).toEqual([])
  })

  it('scores bigger round numbers as rounder', () => {
    expect(roundnessScore(10_000)).toBeGreaterThan(roundnessScore(100))
    expect(roundnessScore(1234.56)).toBe(0)
  })
})

describe('timingCorrelation', () => {
  it('links activity minutes after a deposit', () => {
    const findings = timingCorrelation([
      event({ timestamp: NOW, kind: 'deposit' }),
      event({ timestamp: NOW + 12 * 60_000, kind: 'action', amountKnown: false, amount: 0n }),
    ])
    expect(findings).toHaveLength(1)
  })

  it('stays silent once the gap is wide', () => {
    expect(
      timingCorrelation([
        event({ timestamp: NOW, kind: 'deposit' }),
        event({ timestamp: NOW + 3 * DAY, kind: 'action', amountKnown: false, amount: 0n }),
      ]),
    ).toEqual([])
  })
})

describe('anonymitySetThin', () => {
  it('flags a tier with almost no peers', () => {
    const findings = anonymitySetThin([event({ timestamp: NOW, tier: 'lonely' })], {
      now: NOW,
      pool: { tierCounts: { lonely: 1 }, interArrivalsMs: [], totalNotes: 1 },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].confidence).toBeGreaterThan(0.5)
  })

  it('stays silent in a healthy tier', () => {
    expect(anonymitySetThin([event({ timestamp: NOW, tier: 'USDC' })], CTX)).toEqual([])
  })

  it('never reports on a private action, whose tier is unobservable', () => {
    expect(
      anonymitySetThin([event({ timestamp: NOW, tier: 'private', amountKnown: false })], CTX),
    ).toEqual([])
  })
})

describe('repeatedAmount', () => {
  it('flags an amount used more than once', () => {
    const findings = repeatedAmount([
      event({ timestamp: NOW - DAY, amount: usdc(500) }),
      event({ timestamp: NOW, amount: usdc(500) }),
    ])
    expect(findings).toHaveLength(1)
  })

  it('stays silent when every amount differs', () => {
    expect(
      repeatedAmount([
        event({ timestamp: NOW - DAY, amount: usdc(500) }),
        event({ timestamp: NOW, amount: usdc(501.37) }),
      ]),
    ).toEqual([])
  })
})

describe('cadencePeriodicity', () => {
  it('detects a weekly schedule', () => {
    const weekly = [0, 7, 14, 21].map((week) =>
      event({ timestamp: NOW - week * DAY, amountKnown: false, amount: 0n }),
    )
    const findings = cadencePeriodicity(weekly)
    expect(findings.some((f) => f.id.includes('gaps'))).toBe(true)
  })

  it('stays silent on irregular spacing', () => {
    const irregular = [0, 3, 11, 29].map((day) =>
      event({ timestamp: NOW - day * DAY - day * 7 * HOUR, amountKnown: false, amount: 0n }),
    )
    expect(cadencePeriodicity(irregular).some((f) => f.id.includes('gaps'))).toBe(false)
  })

  it('needs enough events before judging variance', () => {
    expect(cadencePeriodicity([event({ timestamp: NOW })])).toEqual([])
  })
})

describe('exitAmountMatch', () => {
  it('reconstructs a deposit minus the pool fee', () => {
    const findings = exitAmountMatch([
      event({ timestamp: NOW - DAY, kind: 'deposit', asset: 'STRK', amount: 100n * 10n ** 18n }),
      event({ timestamp: NOW, kind: 'withdrawal', asset: 'STRK', amount: 94n * 10n ** 18n }),
    ])
    expect(findings).toHaveLength(1)
  })

  it('defers to amount-correlation on a plain match', () => {
    expect(
      exitAmountMatch([
        event({ timestamp: NOW - DAY, kind: 'deposit', asset: 'STRK', amount: 1000n * 10n ** 18n }),
        event({ timestamp: NOW, kind: 'withdrawal', asset: 'STRK', amount: 1000n * 10n ** 18n }),
      ]),
    ).toEqual([])
  })
})

describe('helpers', () => {
  it('nearlyEqual respects the tolerance band', () => {
    expect(nearlyEqual(1000, 1005)).toBe(true)
    expect(nearlyEqual(1000, 1200)).toBe(false)
  })

  it('coefficientOfVariation is low for regular gaps and high for irregular', () => {
    expect(coefficientOfVariation([100, 101, 99, 100])).toBeLessThan(0.1)
    expect(coefficientOfVariation([10, 900, 40, 3000])).toBeGreaterThan(0.5)
    expect(coefficientOfVariation([5])).toBe(Number.POSITIVE_INFINITY)
  })
})
