/**
 * STRK20 action builders.
 *
 * Every private operation Lumen performs is expressed as a `STRK20_ACTION[]`
 * handed to the user's wallet via `strk20InvokeTransaction`. The wallet owns
 * viewing keys, note discovery, proving and submission — Lumen never sees
 * private state and never asks for a viewing key.
 *
 * The shapes below are taken from `@starknet-io/types-js@0.10.3` and from the
 * action sequence shipped in `@avnu/avnu-sdk@4.2.0` (`buildStrk20Actions`),
 * not from prose documentation. The published docs show an abbreviated
 * two-action private-DeFi example that omits the input and fee withdrawals;
 * building against it produces a transaction the pool rejects.
 */

import type { STRK20_ACTION } from '@starknet-io/types-js'
import { padAddress, POOL_ADDRESS, sameAddress } from './config'

/** The wallet expands this to the id of the Nth open note in the same transaction. */
export const openNoteRef = (index: number): string => `\${openNoteIds[${index}]}`

/** The wallet expands this to the privacy pool address. */
export const POOL_ADDRESS_REF = '${poolAddress}'

/**
 * Shield: move public funds into the pool.
 *
 * This is deliberately a standalone transaction. A deposit is public and names
 * the depositor; a later private action has no public leg. Because they are
 * separate transactions nothing on-chain ties them together, and that
 * separation is the entire basis of the anonymity set. Never bundle a shield
 * with the strategy action it funds.
 *
 * The wallet will prompt twice — the ERC-20 approve must land before the
 * deposit. Label both steps in the UI or the second prompt reads as a bug.
 */
export function buildShield(token: string, amount: bigint): STRK20_ACTION[] {
  return [{ type: 'deposit', token, amount: `0x${amount.toString(16)}` }]
}

/**
 * Private transfer between two registered pool users.
 * No contract call, no event, no approval step, no public leg.
 */
export function buildPrivateTransfer(
  token: string,
  amount: bigint,
  recipient: string,
): STRK20_ACTION[] {
  return [
    {
      type: 'transfer',
      token: padAddress(token),
      amount: `0x${amount.toString(16)}`,
      recipient: padAddress(recipient),
    },
  ]
}

export interface PrivateDefiPlan {
  /** Asset leaving the pool into the helper. */
  tokenIn: string
  amountIn: bigint
  /** Asset the helper returns, credited into the open note. */
  tokenOut: string
  /** The deployed anonymizer / executor contract exposing `privacy_invoke`. */
  helperAddress: string
  /** The user's own address — owner of the resulting note. */
  takerAddress: string
  /** Helper-specific calldata, appended after tokenOut and before the note ref. */
  helperCalldata: string[]
  /** Optional paymaster fee leg, when the route charges one from private balance. */
  fee?: { token: string; amount: bigint; recipient: string }
}

/**
 * Private DeFi: one atomic transaction that moves value out to a helper,
 * runs it, and credits the result straight back into a fresh private note.
 *
 * Action order is load-bearing and must not be rearranged:
 *   1. withdraw the input to the helper
 *   2. withdraw the route fee (when the route charges one)
 *   3. open the note the output lands in  (`amount: "OPEN"`)
 *   4. invoke the helper, referencing that note
 *
 * The `withdraw` legs here are NOT an unshield. They move value to a contract
 * that immediately returns it to the pool inside the same transaction; the
 * funds never reach a public user-controlled address and the position never
 * leaves the shielded environment. `assertNeverUnshields` below enforces that
 * distinction, which is the one invariant separating Lumen from a mixer.
 *
 * Observers see: pool → helper → AMM → helper. They never see who initiated it.
 */
export function buildPrivateDefi(plan: PrivateDefiPlan): STRK20_ACTION[] {
  const actions: STRK20_ACTION[] = [
    {
      type: 'withdraw',
      token: plan.tokenIn,
      amount: `0x${plan.amountIn.toString(16)}`,
      recipient: plan.helperAddress,
    },
  ]

  if (plan.fee && plan.fee.amount > 0n) {
    actions.push({
      type: 'withdraw',
      token: plan.fee.token,
      amount: `0x${plan.fee.amount.toString(16)}`,
      recipient: plan.fee.recipient,
    })
  }

  actions.push({
    type: 'transfer',
    token: plan.tokenOut,
    amount: 'OPEN',
    recipient: plan.takerAddress,
  })

  actions.push({
    type: 'invoke',
    contract: plan.helperAddress,
    // Calldata is deserialized straight into the helper's `privacy_invoke`
    // parameters, so the order must match that signature exactly.
    calldata: [plan.tokenOut, ...plan.helperCalldata, openNoteRef(0)],
  })

  return actions
}

/** Split modes accepted by LumenSplitter's `privacy_invoke`. */
export const SPLIT_MODE = { EXACT: 0, BPS: 1 } as const
export type SplitMode = (typeof SPLIT_MODE)[keyof typeof SPLIT_MODE]

export interface SplitPlan {
  /** Asset being split. Input and outputs are the same token. */
  token: string
  /** Total withdrawn to the splitter. */
  amountIn: bigint
  /**
   * EXACT: absolute amounts, which must sum to `amountIn` minus `feeAmount`.
   * BPS:   basis points summing to 10_000, resolved against the balance the
   *        splitter actually measures on-chain at execution time.
   */
  mode: SplitMode
  parts: bigint[]
  takerAddress: string
  splitterAddress: string
  feeAmount?: bigint
  feeRecipient?: string
}

/**
 * Split one shielded amount into N notes inside a single pool operation.
 *
 * Amount entropy is the strongest remedy the engine has — round and repeated
 * sizes are what re-link a deposit to a withdrawal — but splitting client-side
 * costs one pool fee and one timing signal per part. This routes the whole
 * split through `LumenSplitter.privacy_invoke` instead: one withdrawal, N
 * open notes, one invoke, and the contract asserts the parts reconcile before
 * the pool credits anything.
 *
 * Open notes carry plaintext amounts, so where the amounts are already known
 * at proof time, N plain `transfer` actions create encrypted notes and are the
 * more private choice. Prefer this builder for BPS mode, where the split is
 * resolved against a balance only the contract can measure.
 *
 * Calldata must match the Cairo signature exactly — the pool deserializes it
 * straight into the function's parameters:
 *   [mode, token, in_amount, fee_amount, parts_len, ...parts, ids_len, ...ids]
 */
export function buildSplit(plan: SplitPlan): STRK20_ACTION[] {
  if (plan.parts.length === 0) {
    throw new Error('Refusing to build a split with no parts.')
  }
  if (plan.parts.length > 16) {
    throw new Error(
      `Refusing to build a ${plan.parts.length}-way split: LumenSplitter caps MAX_SPLITS at 16.`,
    )
  }

  const fee = plan.feeAmount ?? 0n

  if (plan.mode === SPLIT_MODE.EXACT) {
    const sum = plan.parts.reduce((total, part) => total + part, 0n)
    if (sum !== plan.amountIn - fee) {
      throw new Error(
        `Split parts sum to ${sum} but ${plan.amountIn - fee} is available after the fee. ` +
          'The contract enforces this too; failing here keeps it off-chain and free.',
      )
    }
  } else {
    const bps = plan.parts.reduce((total, part) => total + part, 0n)
    if (bps !== 10_000n) {
      throw new Error(`Basis points must sum to 10000, got ${bps}.`)
    }
  }

  const hex = (value: bigint) => `0x${value.toString(16)}`

  const actions: STRK20_ACTION[] = [
    {
      type: 'withdraw',
      token: plan.token,
      amount: hex(plan.amountIn),
      recipient: plan.splitterAddress,
    },
  ]

  if (fee > 0n && plan.feeRecipient) {
    actions.push({
      type: 'withdraw',
      token: plan.token,
      amount: hex(fee),
      recipient: plan.feeRecipient,
    })
  }

  // One open note per output. `${openNoteIds[i]}` is zero-indexed over the
  // transfer actions with amount "OPEN" in this same transaction.
  for (let index = 0; index < plan.parts.length; index += 1) {
    actions.push({
      type: 'transfer',
      token: plan.token,
      amount: 'OPEN',
      recipient: plan.takerAddress,
    })
  }

  actions.push({
    type: 'invoke',
    contract: plan.splitterAddress,
    calldata: [
      hex(BigInt(plan.mode)),
      plan.token,
      hex(plan.amountIn),
      hex(fee),
      hex(BigInt(plan.parts.length)),
      ...plan.parts.map(hex),
      hex(BigInt(plan.parts.length)),
      ...plan.parts.map((_, index) => openNoteRef(index)),
    ],
  })

  return actions
}

/** An address that value is allowed to be withdrawn to during private DeFi. */
export interface WithdrawAllowlist {
  /** Deployed helper/executor contracts, plus any fee recipients they declare. */
  contracts: string[]
}

/**
 * Lumen's core promise, enforced mechanically: capital never leaves the
 * shielded environment unless the user explicitly asked to unshield.
 *
 * A `withdraw` is permitted only when its recipient is a known helper contract
 * or declared fee recipient participating in the same atomic transaction. A
 * withdraw to any other address — in particular the user's own public account —
 * is an unshield, and must never be produced by the strategy engine.
 *
 * Throws rather than returning false: this runs immediately before the user is
 * asked to sign, and a silent boolean would be too easy to ignore at a call site.
 */
export function assertNeverUnshields(
  actions: STRK20_ACTION[],
  allowlist: WithdrawAllowlist,
): void {
  for (const [index, action] of actions.entries()) {
    if (action.type !== 'withdraw') continue

    const permitted = allowlist.contracts.some((address) =>
      sameAddress(address, action.recipient),
    )

    if (!permitted) {
      throw new Error(
        `Refusing to submit: action ${index} withdraws to ${action.recipient}, which is not a ` +
          `helper contract in this transaction. That is an unshield, and Lumen only unshields ` +
          `on an explicit user request.`,
      )
    }
  }
}

/**
 * Explicit, user-initiated unshield. Deliberately the only function in the
 * codebase that produces a withdraw to an arbitrary recipient, and deliberately
 * not reachable from the strategy engine.
 */
export function buildExplicitUnshield(
  token: string,
  amount: bigint,
  recipient: string,
): STRK20_ACTION[] {
  return [{ type: 'withdraw', token, amount: `0x${amount.toString(16)}`, recipient }]
}

/** Human-readable summary of an action list, for the pre-signature review step. */
export function describeActions(actions: STRK20_ACTION[]): string[] {
  return actions.map((action) => {
    switch (action.type) {
      case 'deposit':
        return `Shield ${action.amount} of ${action.token} into the pool`
      case 'withdraw':
        return `Move ${action.amount} of ${action.token} to ${action.recipient}`
      case 'transfer':
        return action.amount === 'OPEN'
          ? `Open a note for ${action.token} owned by ${action.recipient}`
          : `Privately send ${action.amount} of ${action.token} to ${action.recipient}`
      case 'invoke':
        return `Invoke helper ${action.contract}`
    }
  })
}

/** Wallet API error codes worth handling explicitly in the UI. */
export const STRK20_ERRORS = {
  NOT_REGISTERED: 118,
  INSUFFICIENT_PRIVATE_BALANCE: 119,
  PRIVACY_LEAK: 120,
} as const

export function explainWalletError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? Number((error as { code: unknown }).code)
      : undefined

  switch (code) {
    case STRK20_ERRORS.NOT_REGISTERED:
      // Confirmed against Ready on mainnet, 28 Aug 2026: a wallet does not
      // register an account on a *dapp-initiated* shield. The Wallet API has
      // no register method — only balances, prepare and invoke — so no dapp
      // can do this for you. Shielding once inside the wallet's own screen
      // registers the account, and everything here works afterwards.
      return 'Your wallet has not joined the privacy pool yet, and an app cannot do it for you. Open your wallet, shield any small amount there once, then come back — everything here will work.'
    case STRK20_ERRORS.INSUFFICIENT_PRIVATE_BALANCE:
      return 'Not enough shielded balance for this action once the pool fee is included. Shield more, or reduce the amount.'
    case STRK20_ERRORS.PRIVACY_LEAK:
      return 'The wallet refused this action because it would leak a link between your public and private identity.'
    default:
      return error instanceof Error ? error.message : 'The wallet rejected the transaction.'
  }
}

export { POOL_ADDRESS }
