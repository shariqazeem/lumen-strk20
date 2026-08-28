'use client'

/**
 * Breaking one balance into unequal notes before it leaves.
 *
 * A cash-out is the moment a private history meets a public address, and the
 * strongest thing an observer has at that moment is the *shape* of the amount.
 * One note of 500.0 leaving shortly after one deposit of 500.0 re-links the
 * two without touching any cryptography — that is the Anonymity Gap in one
 * sentence, and it is why the guard rewrites exit amounts at all.
 *
 * Splitting first is the other half of the same remedy: several unequal notes
 * are a far worse thing to match against than one round one. `LumenSplitter`
 * does it inside a single pool operation, so the legs share one fee and one
 * timestamp and there is no ordering between them to read.
 *
 * The split is *not* a privacy claim on its own. It makes matching harder; it
 * does not make it impossible, and nothing in the product says otherwise.
 */

import { SPLIT_MODE, type SplitPlan } from '@/lib/strk20/actions'

/** Deployed `LumenSplitter`. Empty when this build has no splitter wired. */
export const SPLITTER_ADDRESS = process.env.NEXT_PUBLIC_LUMEN_SPLITTER_ADDRESS ?? ''

export function splitterEnabled(): boolean {
  try {
    return SPLITTER_ADDRESS !== '' && BigInt(SPLITTER_ADDRESS) > 0n
  } catch {
    return false
  }
}

/** Matches `max_splits` on the deployed contract. */
export const MAX_SPLITS = 16

/**
 * Unequal parts summing to exactly `amount`.
 *
 * Equal parts would be worse than not splitting — N identical notes are a
 * signature of their own, and an observer who sees them knows both the count
 * and the original total. So the weights are deliberately uneven, derived from
 * a seed so the same balance does not always break the same way, and the
 * remainder lands on the largest leg rather than being spread evenly (which
 * would round every part).
 */
export function scatter(amount: bigint, count: number, seed: number): bigint[] {
  const legs = Math.max(2, Math.min(count, MAX_SPLITS))
  if (amount <= 0n) return []
  // Too small to split into distinguishable parts is a reason not to split.
  if (amount < BigInt(legs) * 1000n) return [amount]

  // Weights between 55 and 145, so no leg is a tidy fraction of the total.
  const weights: bigint[] = []
  let state = (seed >>> 0) || 1
  for (let i = 0; i < legs; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0
    weights.push(BigInt(55 + (state % 91)))
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0n)
  const parts = weights.map((w) => (amount * w) / totalWeight)
  const assigned = parts.reduce((a, b) => a + b, 0n)

  // The remainder goes to one leg, not spread — spreading it re-rounds them.
  let largest = 0
  for (let i = 1; i < parts.length; i += 1) if (parts[i] > parts[largest]) largest = i
  parts[largest] += amount - assigned

  return parts
}

/** The plan `buildSplit` needs, for a scatter that stays inside the pool. */
export function scatterPlan(input: {
  token: string
  amount: bigint
  count: number
  seed: number
}): SplitPlan | null {
  if (!splitterEnabled()) return null
  const parts = scatter(input.amount, input.count, input.seed)
  if (parts.length < 2) return null
  return {
    token: input.token,
    amountIn: input.amount,
    mode: SPLIT_MODE.EXACT,
    parts,
    // The value never leaves the pool: it is withdrawn to the splitter and
    // credited straight back into fresh notes owned by the same account.
    takerAddress: SPLITTER_ADDRESS,
    splitterAddress: SPLITTER_ADDRESS,
  }
}
