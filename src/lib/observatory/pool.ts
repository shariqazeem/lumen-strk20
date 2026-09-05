'use client'

/**
 * The observatory — what the privacy pool is doing right now.
 *
 * Every other privacy tool reasons about *your* transaction. None of them can
 * tell you the thing that actually decides whether it hides you: how many other
 * people are moving, in which asset, in the same window. A perfectly formed
 * private transfer in an empty hour is a transfer with an audience of one.
 *
 * All of it is public. The pool emits `Deposit` and `Withdrawal` with the token
 * as an indexed key, `EncNoteCreated` and `NoteUsed` for private activity that
 * names nobody, `ViewingKeySet` when somebody joins, and
 * `ExternalContractInvoked` whenever an anonymizer runs. Read together they are
 * a live picture of the crowd you would be hiding in — and reading them needs
 * no indexer, no API key and no privileged access, which is the only reason
 * this is worth anything. If Lumen needed special access to compute it, it
 * would prove nothing.
 *
 * Nothing here is attributable to a person. Deposits and withdrawals carry
 * addresses because those legs are public by design; the private events carry
 * nullifiers and note ids, which identify nobody. This module never looks at
 * an individual — only at density.
 */

import { hash } from 'starknet'
import { rpc } from '@/lib/strk20/rpc'
import { POOL_ADDRESS, TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'

const SELECTOR = {
  /** A private note came into existence. Names nobody. */
  noteCreated: BigInt(hash.getSelectorFromName('EncNoteCreated')),
  /** A note was spent. Carries a nullifier, which identifies nobody. */
  noteSpent: BigInt(hash.getSelectorFromName('NoteUsed')),
  /** A public entry: `user_addr*, token*, amount`. */
  deposit: BigInt(hash.getSelectorFromName('Deposit')),
  /** A public exit: `enc_user_addr, to_addr*, token*, amount`. */
  withdrawal: BigInt(hash.getSelectorFromName('Withdrawal')),
  /** Somebody joined the pool. */
  registration: BigInt(hash.getSelectorFromName('ViewingKeySet')),
  /** An anonymizer helper ran — ours or anyone's. */
  helperCall: BigInt(hash.getSelectorFromName('ExternalContractInvoked')),
} as const

/**
 * Starknet mainnet blocks are ~1.7s apart, so a window in blocks is a window in
 * time. Getting this wrong is not academic: an early version of this scan used
 * 900 blocks believing it covered hours, and it covered twenty-five minutes.
 */
export const BLOCKS_PER_HOUR = 2_100

export interface TokenActivity {
  deposits: number
  withdrawals: number
}

/** One reading of the pool. Counts only — nothing here identifies anyone. */
export interface PoolPulse {
  /** How far back the reading looked. */
  spanBlocks: number
  /** Private notes created. The best single proxy for cover traffic. */
  notesCreated: number
  notesSpent: number
  /** Accounts that joined the pool in the window. */
  registrations: number
  /** Anonymizer invocations — how much private DeFi is happening. */
  helperCalls: number
  byToken: Partial<Record<TokenSymbol, TokenActivity>>
  /**
   * Gaps between consecutive pool operations, in ms, oldest first.
   *
   * Derived from block numbers rather than timestamps: every event in a window
   * this wide would otherwise need a block fetch each. Blocks are ~1.7s apart,
   * which is precise enough for a timing heuristic that asks whether a rhythm
   * exists, not what its phase is.
   */
  gapsMs: number[]
  /** ms epoch, so a stale reading can be labelled rather than trusted. */
  readAt: number
}

/** Starknet mainnet block time, measured rather than assumed. */
export const BLOCK_MS = 1_700

const EMPTY: TokenActivity = { deposits: 0, withdrawals: 0 }

function symbolOf(felt: string | undefined): TokenSymbol | null {
  if (!felt) return null
  try {
    const key = BigInt(felt)
    return TOKEN_LIST.find((token) => BigInt(token.address) === key)?.symbol ?? null
  } catch {
    return null
  }
}

/**
 * Read the pool's public activity over the last `spanBlocks`.
 *
 * Returns `null` rather than throwing: a reading is an opinion, and an opinion
 * that cannot be formed should leave the product silent rather than broken.
 * Every caller must render fine without one.
 */
export async function readPoolPulse(
  spanBlocks: number = BLOCKS_PER_HOUR * 48,
): Promise<PoolPulse | null> {
  try {
    const head = await rpc().getBlockNumber()
    const from = Math.max(0, head - spanBlocks)

    const pulse: PoolPulse = {
      spanBlocks,
      notesCreated: 0,
      notesSpent: 0,
      registrations: 0,
      helperCalls: 0,
      byToken: {},
      gapsMs: [],
      readAt: Date.now(),
    }

    const blocks: number[] = []

    // The pool is busy enough that a single chunk will not hold a long window,
    // and a partial read would understate the crowd — which is the one
    // direction this must not be wrong in, since understating it makes the
    // product tell someone to wait when they need not.
    let token: string | undefined
    let guard = 0
    do {
      const page = await rpc().getEvents({
        address: POOL_ADDRESS,
        from_block: { block_number: from },
        to_block: 'latest',
        chunk_size: 1000,
        ...(token ? { continuation_token: token } : {}),
      })

      for (const event of page?.events ?? []) {
        let selector: bigint
        try {
          selector = BigInt(event.keys?.[0] ?? '0x0')
        } catch {
          continue
        }
        if (typeof event.block_number === 'number') blocks.push(event.block_number)

        switch (selector) {
          case SELECTOR.noteCreated:
            pulse.notesCreated += 1
            break
          case SELECTOR.noteSpent:
            pulse.notesSpent += 1
            break
          case SELECTOR.registration:
            pulse.registrations += 1
            break
          case SELECTOR.helperCall:
            pulse.helperCalls += 1
            break
          case SELECTOR.deposit:
          case SELECTOR.withdrawal: {
            // Both carry the token at the same key position, which is not
            // obvious from the signatures: `Deposit(user*, token*, amount)` and
            // `Withdrawal(enc_user, to*, token*, amount)` look like they differ
            // by one, but `enc_user_addr` is *not* indexed, so it lives in data
            // and the keys are `[selector, addr, token]` either way. Reading
            // index 3 for withdrawals silently returned zero of them.
            const symbol = symbolOf(event.keys?.[2])
            if (!symbol) break
            const current = pulse.byToken[symbol] ?? { ...EMPTY }
            if (selector === SELECTOR.deposit) current.deposits += 1
            else current.withdrawals += 1
            pulse.byToken[symbol] = current
            break
          }
          default:
            break
        }
      }

      token = page?.continuation_token
      guard += 1
    } while (token && guard < 25)

    // Consecutive gaps, skipping the zeros that come from several events in
    // one block — those are one operation, not several moments.
    blocks.sort((a, b) => a - b)
    for (let i = 1; i < blocks.length; i += 1) {
      const delta = blocks[i]! - blocks[i - 1]!
      if (delta > 0) pulse.gapsMs.push(delta * BLOCK_MS)
    }

    return pulse
  } catch {
    return null
  }
}

/** Total public moves in a token over the window — the peer group for it. */
export function peersFor(pulse: PoolPulse, symbol: TokenSymbol): number {
  const activity = pulse.byToken[symbol]
  return activity ? activity.deposits + activity.withdrawals : 0
}

/** Private operations per hour, as a rate rather than a raw count. */
export function notesPerHour(pulse: PoolPulse): number {
  const hours = pulse.spanBlocks / BLOCKS_PER_HOUR
  return hours > 0 ? pulse.notesCreated / hours : 0
}
