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
  {
    name: 'A — withdraw then invoke (what we ship today)',
    actions: [
      { type: 'withdraw', token: STRK, amount: hex(AMOUNT), recipient: ESCROW_ADDRESS },
      { type: 'invoke', contract: ESCROW_ADDRESS, calldata: depositCalldata() },
    ],
  },
  {
    name: 'B — invoke alone, pool funds the helper implicitly',
    actions: [{ type: 'invoke', contract: ESCROW_ADDRESS, calldata: depositCalldata() }],
  },
  {
    name: 'C — open note, then invoke (the documented swap shape)',
    actions: [
      { type: 'transfer', token: STRK, amount: 'OPEN', recipient: ESCROW_ADDRESS },
      { type: 'invoke', contract: ESCROW_ADDRESS, calldata: depositCalldata() },
    ],
  },
  {
    name: 'D — open note, withdraw, invoke (all three phases)',
    actions: [
      { type: 'transfer', token: STRK, amount: 'OPEN', recipient: ESCROW_ADDRESS },
      { type: 'withdraw', token: STRK, amount: hex(AMOUNT), recipient: ESCROW_ADDRESS },
      { type: 'invoke', contract: ESCROW_ADDRESS, calldata: depositCalldata() },
    ],
  },
  {
    name: 'E — a plain private transfer (proves the wallet works at all)',
    actions: [
      { type: 'transfer', token: STRK, amount: hex(AMOUNT), recipient: padAddress('0x1') },
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
    setLines([`escrow ${ESCROW_ADDRESS}`, `token  ${STRK}`, ''])
    for (const candidate of CANDIDATES) {
      try {
        await account.strk20PrepareInvoke(candidate.actions, true)
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
        nothing is signed — the wallet only says whether it would accept the shape.
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
          {busy ? 'Asking the wallet…' : 'Run the five candidates'}
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
