'use client'

/**
 * Payload diagnostics.
 *
 * `INVALID_REQUEST_PAYLOAD` names no field, and guessing at the shape from
 * documentation has now cost two rounds. `strk20PrepareInvoke(actions, true)`
 * builds and proves without submitting, so the wallet itself can say which
 * action array it accepts — at no cost and with no signature.
 *
 * Temporary. Delete once the escrow shape is settled.
 */

import { useState } from 'react'
import type { STRK20_ACTION } from '@starknet-io/types-js'
import { useLumen } from '@/lib/lumen/store'
import { listWallets, supportsStrk20 } from '@/lib/strk20/wallet'
import { ESCROW_ADDRESS, claimCommitment, refundCommitment } from '@/lib/strk20/escrow'
import { padAddress, TOKENS } from '@/lib/strk20/config'

const STRK = padAddress(TOKENS.STRK.address)
const AMOUNT = 2_000_000_000_000_000_000n // 2 STRK
const hex = (v: bigint) => `0x${v.toString(16)}`
const EXPIRY = Math.floor(Date.now() / 1000) + 600

/** The nine-felt Deposit calldata our contract expects. */
const depositCalldata = () => [
  '0x0',
  claimCommitment('0xa11ce'),
  refundCommitment('0xb0b'),
  hex(BigInt(EXPIRY)),
  STRK,
  hex(AMOUNT),
  '0x0',
  '0x0',
  '0x0',
]

const CANDIDATES: { name: string; actions: STRK20_ACTION[] }[] = [
  // Controls first. If these fail, nothing about the escrow is the problem.
  {
    name: '1 — deposit 0.1 STRK (shield; no recipient, no invoke)',
    actions: [{ type: 'deposit', token: STRK, amount: hex(100_000_000_000_000_000n) }],
  },
  {
    name: '2 — private transfer to SELF (a registered recipient)',
    actions: [{ type: 'transfer', token: STRK, amount: hex(AMOUNT), recipient: 'SELF' }],
  },
  {
    name: '3 — open note alone, no invoke',
    actions: [{ type: 'transfer', token: STRK, amount: 'OPEN', recipient: 'SELF' }],
  },
  {
    name: '4 — withdraw to SELF (a real public unshield shape)',
    actions: [{ type: 'withdraw', token: STRK, amount: hex(AMOUNT), recipient: 'SELF' }],
  },
  // Now isolate `invoke`, from the smallest possible shape upward.
  {
    name: '5 — invoke with EMPTY calldata',
    actions: [{ type: 'invoke', contract: ESCROW_ADDRESS, calldata: [] }],
  },
  {
    name: '6 — invoke with one felt',
    actions: [{ type: 'invoke', contract: ESCROW_ADDRESS, calldata: ['0x0'] }],
  },
  {
    name: '7 — open note + invoke, one felt',
    actions: [
      { type: 'transfer', token: STRK, amount: 'OPEN', recipient: 'SELF' },
      { type: 'invoke', contract: ESCROW_ADDRESS, calldata: ['0x0'] },
    ],
  },
  {
    name: '8 — our real Deposit: withdraw + invoke (nine felts)',
    actions: [
      { type: 'withdraw', token: STRK, amount: hex(AMOUNT), recipient: ESCROW_ADDRESS },
      { type: 'invoke', contract: ESCROW_ADDRESS, calldata: depositCalldata() },
    ],
  },
]

export default function DiagPage() {
  const { account, status, connect } = useLumen()
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!account) return
    setBusy(true)
    const me = padAddress(account.address)
    setLines([`escrow ${ESCROW_ADDRESS}`, `token  ${STRK}`, `self   ${me}`, ''])
    for (const candidate of CANDIDATES) {
      // Placeholders resolved here so the list can be written declaratively.
      const actions = candidate.actions.map((action) =>
        'recipient' in action && action.recipient === 'SELF'
          ? { ...action, recipient: me }
          : action,
      ) as STRK20_ACTION[]
      try {
        await account.strk20PrepareInvoke(actions, true)
        setLines((l) => [...l, `PASS  ${candidate.name}`])
      } catch (error) {
        const message =
          typeof error === 'object' && error !== null
            ? `${(error as { code?: unknown }).code ?? ''} ${(error as { message?: string }).message ?? String(error)}`
            : String(error)
        setLines((l) => [...l, `FAIL  ${candidate.name}`, `        ${message.trim().slice(0, 160)}`])
      }
    }
    setBusy(false)
  }

  const ready = listWallets().filter(supportsStrk20)

  return (
    <main className="mx-auto w-full max-w-[760px] px-6 py-16">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Payload diagnostics</h1>
      <p className="mt-3 max-w-[58ch] text-[14.5px] leading-relaxed text-ink-muted">
        Dry-runs each candidate action array through the wallet with{' '}
        <span className="font-mono text-[13px]">simulate = true</span>. Nothing is submitted and
        nothing is signed. The first four are controls — if those fail, the escrow is not the
        problem. Five to seven isolate the <span className="font-mono text-[13px]">invoke</span>{' '}
        action from the smallest possible shape upward.
      </p>

      {status !== 'connected' ? (
        <div className="mt-8 space-y-2.5">
          {ready.map((wallet) => (
            <button key={wallet.name} onClick={() => connect(wallet)} className="btn btn-ink">
              Connect {wallet.name}
            </button>
          ))}
          {ready.length === 0 ? <p className="text-[14px]">No privacy wallet found.</p> : null}
        </div>
      ) : (
        <button onClick={() => void run()} disabled={busy} className="btn btn-ink mt-8">
          {busy ? 'Asking the wallet…' : 'Run the eight candidates'}
        </button>
      )}

      {lines.length > 0 ? (
        <pre className="mt-8 overflow-x-auto rounded-2xl border border-rule bg-card-soft px-5 py-4 font-mono text-[12px] leading-relaxed">
          {lines.join('\n')}
        </pre>
      ) : null}
    </main>
  )
}
