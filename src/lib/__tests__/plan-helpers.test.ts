/**
 * Tests for the pure helpers behind the plan store: seed derivation and the
 * intent-routing table. Network and wallet paths are deliberately untested
 * here — the helpers were extracted precisely so the decisions those paths
 * depend on are checkable without either.
 */

import { describe, expect, it } from 'vitest'

import type { ActionIntent, ActionType, Route } from '@/lib/engine'
import { toEngineHistory } from '@/lib/history'
import {
  OBSERVER_AVNU_SWAP,
  OBSERVER_POOL_TRANSFER,
  ROUTE_UNAVAILABLE_MESSAGE,
  classifyIntentRoute,
  derivePlanSeed,
  ledgerRouteFor,
  ledgerTypeFor,
  observerLabelFor,
} from '@/lib/store/plan'

const DAY_MS = 86_400_000
const ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

const intent = (type: ActionType, route: Route): ActionIntent => ({
  id: 'test-intent',
  type,
  sourceAsset: 'STRK',
  targetAsset: 'USDC',
  inputAmount: 1_000n,
  minOutputAmount: 900n,
  route,
  recommendedWindowStart: 0,
  recommendedWindowEnd: 1,
  expectedPrivacyDelta: 0,
  expectedCostBps: 25,
  rationale: 'test',
})

describe('derivePlanSeed', () => {
  const morning = Date.UTC(2026, 7, 18, 6, 0, 0)
  const evening = Date.UTC(2026, 7, 18, 23, 59, 59)
  const nextDay = Date.UTC(2026, 7, 19, 6, 0, 0)

  it('is stable for the same address across a whole UTC day', () => {
    expect(derivePlanSeed(ADDRESS, morning)).toBe(derivePlanSeed(ADDRESS, evening))
  })

  it('changes when the day changes', () => {
    expect(derivePlanSeed(ADDRESS, nextDay)).not.toBe(derivePlanSeed(ADDRESS, morning))
    expect(derivePlanSeed(ADDRESS, nextDay)).toBe(derivePlanSeed(ADDRESS, morning) + 1)
  })

  it('changes across addresses', () => {
    expect(derivePlanSeed('0x1', morning)).not.toBe(derivePlanSeed('0x2', morning))
  })

  it('treats padded and unpadded spellings of one address identically', () => {
    expect(derivePlanSeed('0x0abc', morning)).toBe(derivePlanSeed('0xabc', morning))
    expect(derivePlanSeed('0x00ABC', morning)).toBe(derivePlanSeed('0xabc', morning))
  })

  it('degrades deterministically on an unparseable address', () => {
    const a = derivePlanSeed('garbage', morning)
    expect(a).toBe(derivePlanSeed('garbage', morning))
    expect(Number.isFinite(a)).toBe(true)
    expect(a).toBe(Math.floor(morning / DAY_MS))
  })
})

describe('classifyIntentRoute — the mainnet routing table', () => {
  it('routes AVNU swaps to the private-swap path', () => {
    expect(classifyIntentRoute(intent('SWAP', 'AVNU'))).toBe('AVNU_SWAP')
  })

  it('routes pool rebalances and compactions to a note-to-note transfer', () => {
    expect(classifyIntentRoute(intent('REBALANCE', 'POOL'))).toBe('POOL_TRANSFER')
    expect(classifyIntentRoute(intent('COMPACT', 'POOL'))).toBe('POOL_TRANSFER')
  })

  it('refuses everything without an executable mainnet path', () => {
    // Vesu's anonymizer class is not declared on mainnet.
    expect(classifyIntentRoute(intent('LEND', 'VESU'))).toBe('UNAVAILABLE')
    // Ekubo swaps have no wired executor instance in Lumen.
    expect(classifyIntentRoute(intent('SWAP', 'EKUBO'))).toBe('UNAVAILABLE')
    // Mismatched combinations never execute implicitly.
    expect(classifyIntentRoute(intent('SWAP', 'POOL'))).toBe('UNAVAILABLE')
    expect(classifyIntentRoute(intent('COMPACT', 'AVNU'))).toBe('UNAVAILABLE')
    expect(classifyIntentRoute(intent('LEND', 'POOL'))).toBe('UNAVAILABLE')
  })

  it('announces refusal with the exact mainnet message', () => {
    expect(ROUTE_UNAVAILABLE_MESSAGE).toBe('Route not available on mainnet')
  })
})

describe('observer labels', () => {
  it('an AVNU private swap reads as the executor touching an AMM', () => {
    expect(observerLabelFor('AVNU_SWAP')).toBe(OBSERVER_AVNU_SWAP)
    expect(OBSERVER_AVNU_SWAP).toBe('executor → AMM')
  })

  it('a private transfer shows an observer nothing', () => {
    expect(observerLabelFor('POOL_TRANSFER')).toBe(OBSERVER_POOL_TRANSFER)
    expect(OBSERVER_POOL_TRANSFER).toBe('—')
  })
})

describe('ledger classification of executed intents', () => {
  it('maps execution kinds to ledger routes', () => {
    expect(ledgerRouteFor('AVNU_SWAP')).toBe('AVNU')
    expect(ledgerRouteFor('POOL_TRANSFER')).toBe('POOL')
  })

  it('maps execution kinds and intent types to ledger entry types', () => {
    expect(ledgerTypeFor('AVNU_SWAP', 'SWAP')).toBe('SWAP')
    expect(ledgerTypeFor('POOL_TRANSFER', 'COMPACT')).toBe('COMPACT')
    expect(ledgerTypeFor('POOL_TRANSFER', 'REBALANCE')).toBe('REBALANCE')
  })

  it('every executed entry survives the round-trip back into engine history', () => {
    // The ledger types the store writes must all be ones toEngineHistory
    // keeps — otherwise executed actions would vanish from the behavioural
    // terms and the score would drift from reality.
    const cases = [
      { kind: 'AVNU_SWAP' as const, type: 'SWAP' as const },
      { kind: 'POOL_TRANSFER' as const, type: 'COMPACT' as const },
      { kind: 'POOL_TRANSFER' as const, type: 'REBALANCE' as const },
    ]
    for (const { kind, type } of cases) {
      const history = toEngineHistory([
        {
          id: 'x',
          timestamp: 1,
          type: ledgerTypeFor(kind, type),
          asset: 'STRK',
          amount: 10n,
          route: ledgerRouteFor(kind),
          observer: observerLabelFor(kind),
        },
      ])
      expect(history).toHaveLength(1)
      expect(history[0].type).toBe(type)
    }
  })
})
