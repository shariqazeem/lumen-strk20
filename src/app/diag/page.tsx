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
import {
  buildEscrowClaim,
  buildEscrowFund,
  buildEscrowFundMany,
  buildEscrowRefund,
  ESCROW_ADDRESS,
} from '@/lib/strk20/escrow'
import { walletFelt, TOKENS } from '@/lib/strk20/config'

const AMOUNT = 2_000_000_000_000_000_000n // 2 STRK
const EXPIRY = Math.floor(Date.now() / 1000) + 600

const CANDIDATES: { name: string; actions: STRK20_ACTION[] }[] = [
  {
    name: '1 — Deposit, exactly as the app now builds it',
    actions: buildEscrowFund({
      token: TOKENS.STRK.address,
      amount: AMOUNT,
      claimSecret: '0xa11ce',
      refundSecret: '0xb0b',
      expiry: EXPIRY,
    }),
  },
  {
    name: '2 — Claim, exactly as the app now builds it',
    actions: buildEscrowClaim({
      token: TOKENS.STRK.address,
      recipient: 'SELF_RAW',
      secret: '0xa11ce',
    }),
  },
  {
    name: '3 — Refund, exactly as the app now builds it',
    actions: buildEscrowRefund({
      token: TOKENS.STRK.address,
      recipient: 'SELF_RAW',
      secret: '0xb0b',
    }),
  },
  {
    name: '4 — DepositMany, three links in one operation',
    actions: buildEscrowFundMany({
      token: TOKENS.STRK.address,
      expiry: EXPIRY,
      legs: [
        { amount: 700_000_000_000_000_000n, claimSecret: '0xc1', refundSecret: '0xd1' },
        { amount: 600_000_000_000_000_000n, claimSecret: '0xc2', refundSecret: '0xd2' },
        { amount: 700_000_000_000_000_000n, claimSecret: '0xc3', refundSecret: '0xd3' },
      ],
    }),
  },
]

export default function DiagPage() {
  const { account, status, connect, walletName } = useLumen()
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!account) return
    setBusy(true)
    const me = walletFelt(account.address)
    // The *connected* wallet, matched by name. Taking the first STRK20-capable
    // wallet instead reported Xverse's metadata while the dry-runs ran against
    // Ready — a header that quietly described the wrong program.
    const wallet =
      listWallets().find((w) => w.name === walletName) ??
      listWallets().find((w) => supportsStrk20(w))
    const feature = wallet?.features['starknet:walletApi'] as
      | { version?: string; supportedApiVersions?: string[] }
      | undefined
    setLines([
      `escrow ${ESCROW_ADDRESS}`,
      `token  ${walletFelt(TOKENS.STRK.address)}`,
      `self   ${me}`,
      `wallet ${wallet?.name ?? '?'}${wallet?.name === walletName ? '' : '  (NOT the connected one)'}`,
      `api    ${(feature?.supportedApiVersions ?? [feature?.version ?? '?']).join(', ')}`,
      `feats  ${Object.keys(wallet?.features ?? {}).join(', ')}`,
      '',
    ])
    for (const candidate of CANDIDATES) {
      // Placeholders resolved here so the list can be written declaratively.
      const actions = candidate.actions.map((action) =>
        'recipient' in action && action.recipient === 'SELF_RAW'
          ? { ...action, recipient: walletFelt(account.address) }
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
        nothing is signed. These are the four escrow flows exactly as the app builds them, after
        the minimal-hex fix.
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
          {busy ? 'Asking the wallet…' : 'Run the four real flows'}
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
