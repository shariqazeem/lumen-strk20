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
const depositCalldata = (thinHex = false) => [
  '0x0',
  claimCommitment('0xa11ce'),
  refundCommitment('0xb0b'),
  hex(BigInt(EXPIRY)),
  thinHex ? `0x${BigInt(STRK).toString(16)}` : STRK,
  hex(AMOUNT),
  '0x0',
  '0x0',
  '0x0',
]

/** Minimal hex, the way `num.toHex` writes it — no zero padding. */
const thin = (value: string) => `0x${BigInt(value).toString(16)}`

const ESCROW_THIN = thin(ESCROW_ADDRESS)
const STRK_THIN = thin(STRK)

const CANDIDATES: { name: string; actions: STRK20_ACTION[] }[] = [
  // Does the hex form of the *recipient* decide whether OPEN is accepted?
  {
    name: '1 — OPEN note, padded recipient',
    actions: [{ type: 'transfer', token: STRK, amount: 'OPEN', recipient: 'SELF' }],
  },
  {
    name: '2 — OPEN note, minimal-hex recipient and token',
    actions: [{ type: 'transfer', token: STRK_THIN, amount: 'OPEN', recipient: 'SELF_THIN' }],
  },
  // Does the hex form of the invoke *contract* decide?
  {
    name: '3 — invoke, padded contract, empty calldata',
    actions: [{ type: 'invoke', contract: ESCROW_ADDRESS, calldata: [] }],
  },
  {
    name: '4 — invoke, minimal-hex contract, empty calldata',
    actions: [{ type: 'invoke', contract: ESCROW_THIN, calldata: [] }],
  },
  // The starter kit's exact working shape, pointed at our escrow. Order is
  // withdraw, then OPEN, then invoke — not the order we ship.
  {
    name: '5 — starter-kit shape: withdraw, OPEN, invoke (all minimal hex)',
    actions: [
      { type: 'withdraw', token: STRK_THIN, amount: hex(AMOUNT), recipient: ESCROW_THIN },
      { type: 'transfer', token: STRK_THIN, amount: 'OPEN', recipient: 'SELF_THIN' },
      {
        type: 'invoke',
        contract: ESCROW_THIN,
        calldata: [STRK_THIN, '${poolAddress}', '${openNoteIds[0]}'],
      },
    ],
  },
  // Same order and hex form, but our real nine-felt Deposit calldata.
  {
    name: '6 — starter-kit order, our Deposit calldata (minimal hex)',
    actions: [
      { type: 'withdraw', token: STRK_THIN, amount: hex(AMOUNT), recipient: ESCROW_THIN },
      { type: 'transfer', token: STRK_THIN, amount: 'OPEN', recipient: 'SELF_THIN' },
      { type: 'invoke', contract: ESCROW_THIN, calldata: depositCalldata(true) },
    ],
  },
  {
    name: '7 — as 6 but no OPEN note (Deposit credits nothing back)',
    actions: [
      { type: 'withdraw', token: STRK_THIN, amount: hex(AMOUNT), recipient: ESCROW_THIN },
      { type: 'invoke', contract: ESCROW_THIN, calldata: depositCalldata(true) },
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
    // What the wallet advertises, next to what it actually accepts. If it
    // claims an API version whose spec includes `invoke` and rejects `invoke`,
    // that is a wallet gap and not our payload.
    const wallet = listWallets().find((w) => supportsStrk20(w))
    const feature = wallet?.features['starknet:walletApi'] as
      | { version?: string; supportedApiVersions?: string[] }
      | undefined
    setLines([
      `escrow ${ESCROW_ADDRESS}`,
      `token  ${STRK}`,
      `self   ${me}`,
      `wallet ${wallet?.name ?? '?'}`,
      `api    ${(feature?.supportedApiVersions ?? [feature?.version ?? '?']).join(', ')}`,
      `feats  ${Object.keys(wallet?.features ?? {}).join(', ')}`,
      '',
    ])
    for (const candidate of CANDIDATES) {
      // Placeholders resolved here so the list can be written declaratively.
      const meThin = `0x${BigInt(account.address).toString(16)}`
      const actions = candidate.actions.map((action) => {
        if (!('recipient' in action)) return action
        if (action.recipient === 'SELF') return { ...action, recipient: me }
        if (action.recipient === 'SELF_THIN') return { ...action, recipient: meThin }
        return action
      }) as STRK20_ACTION[]
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
          {busy ? 'Asking the wallet…' : 'Run the seven candidates'}
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
