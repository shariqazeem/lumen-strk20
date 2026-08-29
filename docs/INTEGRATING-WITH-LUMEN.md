# Paying people through Lumen's rail

For a team wiring an existing product into Lumen's Starknet contracts. Written
for the Sage integration, but nothing here is Sage-specific.

Everything below was established on mainnet, mostly by getting it wrong first.
The constraints in §1 are the ones that change your architecture, so read those
before designing anything.

---

## 1. Four constraints that decide your design

**1.1 A server cannot touch the private side. At all.**

Every shielded operation goes through `account.strk20InvokeTransaction` — a
*wallet* request. The wallet holds the viewing key, discovers the notes, and
generates the proof. A headless process has none of that, so a server cannot
shield, cannot send privately, cannot hold a shielded balance, and cannot mint
a claim link.

Exactly one on-chain action here is available to a machine: `claim_to_address`.
It is a plain Starknet invoke with no pool involvement and no caller check.

**If your agent is autonomous, this is the constraint to design around, not
past.** Two honest shapes:

- *Human-approved batches.* One wallet approval mints up to 32 payouts at once
  through `DepositMany`. The agent decides, a person signs once, the recipients
  collect on their own time. One prompt per payroll, not per person.
- *Your own contract with a public funding path.* See §5.

**1.2 The recipient must join the pool to claim privately — and only they can.**

Verified on mainnet: a never-registered account is refused with error 118. The
Wallet API has no register method, so no dapp can do it for them. Their wallet
registers them on first use inside its own screen.

This is why `claim_to_address` exists. It was proved against a wallet that had
**no pool registration, no shielded balance, no gas, and no deployed account
contract** — and the money arrived. If your recipients are people receiving
their first crypto, that is the door you want.

**1.3 The pool fee is 6 STRK flat, per operation, regardless of size.**

Read it from the pool's `get_fee_amount()` rather than hardcoding. Two
consequences: paying N people one at a time costs 6N, while `DepositMany` costs
6 once — and reclaiming 2 STRK costs 6, so small payouts are not worth
reclaiming. Say that in your product rather than letting a user discover it.

**1.4 An escrow is superseded, never emptied.**

Lumen has deployed three. A link minted last week still lives in an older one,
and an exit built against the current address finds no entry and reverts with
nothing readable. Resolve which contract holds a commitment before acting on
it. Keep the list append-only.

---

## 2. The contracts

| | address |
|---|---|
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| LumenEscrow (current) | `0x6c96b86d5f1eaee16be18ca4f346edb20c098f1106648cef3845b34723df272` |
| LumenEscrow (superseded) | `0x43e41de87ebfaec2913a85398a68e011ab2a92bbddb9211956bfabe6ed57288` |
| LumenEscrow (superseded) | `0x293c8a9541d00d0762797a16353f2505aeeaef650bf9f3e8f0a68a98d9b8cd8` |
| LumenSplitter | `0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0` |
| LumenVault | `0x73e57be7d6c9d2321d7a01d0c2e426392fd5e736ecfbcd91d4216ba5d7a5f67` |

Source: `contracts/src/escrow.cairo`, 35 tests in `contracts/src/tests_escrow.cairo`.
The escrow is **token-generic** — `token: ContractAddress` throughout — so USDC,
STRK and strkBTC all work today.

### The entry point

```cairo
fn privacy_invoke(
    ref self: T,
    operation: EscrowOperation,   // Deposit 0x0 · Claim 0x1 · Refund 0x2 · DepositMany 0x3
    claim_commitment: felt252,
    refund_commitment: felt252,   // 0 to decline the reclaim path
    expiry: u64,                  // 0 iff refund_commitment is 0
    token: ContractAddress,
    amount: u128,
    secret: felt252,              // claim/refund preimage; 0 on deposits
    note_id: felt252,             // the open note to fill; 0 on deposits
    legs: Span<EscrowLeg>,        // DepositMany only; empty otherwise
) -> Span<OpenNoteDeposit>;
```

Only the pool may call it. `MAX_BATCH` is 32.

### The public door

```cairo
fn claim_to_address(ref self: T, secret: felt252, recipient: ContractAddress);
```

No pool gate, no caller check — the preimage is the authority. Anyone can
submit it, including a relayer paying the gas, and the tokens go straight to
`recipient`. This is the only function a headless service can call.

### Commitments

```
claim_commitment  = poseidon('LUMEN_ESCROW_CLAIM:V1',  secret)
refund_commitment = poseidon('LUMEN_ESCROW_REFUND:V1', secret)
```

Separate domains, so a reclaim key can never spend a link and a link can never
trigger a reclaim. The escrow maps refund commitment → claim commitment
internally, so a refund secret finds its own entry without the link.

`take_entry` flips a `claimed` flag rather than deleting, which is what lets you
tell "already collected" apart from "never existed". Check the flag, not
absence — reading absence as unsettled is a bug we shipped and had to fix.

---

## 3. The payload rules

These cost the most time to learn. Documentation contradicted itself and two
readings of it were wrong.

1. **Felts go to the wallet as minimal hex, never zero-padded.** `0x1`, not
   `0x0000…01`. A padding "fix" was itself the bug that produced
   `INVALID_REQUEST_PAYLOAD (114)`.
2. **An `invoke` action must be accompanied by a `withdraw`.**
3. **An `OPEN` note must be filled by the helper's return**, and it is opened in
   the token the helper *returns*, not the token it consumes.
4. **`${openNoteIds[0]}` and `${poolAddress}` pass through untouched** — the
   wallet substitutes them.

### Minting one link

```ts
[
  { type: 'withdraw', token, amount: hex(amount), recipient: ESCROW },
  { type: 'invoke', contract: ESCROW, calldata: [
      '0x0',                          // Deposit
      claimCommitment(claimSecret),
      refundCommitment(refundSecret),
      hex(expirySeconds),
      token, hex(amount),
      '0x0', '0x0',                   // secret, note_id — unused on deposit
      '0x0',                          // empty legs
  ]},
]
```

### Minting many (one operation, one fee)

Operation `0x3`, one `withdraw` carrying the whole total, and `legs` serialised
as a length followed by each leg's `(claim, refund, amount)` in declaration
order. The contract asserts the legs sum to exactly the amount delivered, so
you cannot hand out more claims than the pool paid for.

Proven on mainnet: `0x1056fd09…` paid three people for one 6 STRK fee.

### Collecting

*Private door* (recipient is in the pool):

```ts
[
  { type: 'transfer', token, amount: 'OPEN', recipient: theirAddress },
  { type: 'invoke', contract: ESCROW, calldata: [
      '0x1', '0x0','0x0','0x0','0x0','0x0', claimSecret, '${openNoteIds[0]}', '0x0',
  ]},
]
```

*Public door* (recipient has nothing): a plain
`claim_to_address(secret, recipient)` invoke. No pool, no wallet needed on
their side, and any account can submit it.

---

## 4. Things that will bite you

**The wallet's promise can hang.** A transaction lands, the wallet never
resolves, and the UI insists it is waiting while the money has already moved.
Race the wallet against the chain and take the first answer. Every escrow
operation has a chain-visible outcome — a mint writes an entry, a claim or
refund takes one — so this is always possible. Private transfers do not, so
that one path genuinely has to wait.

**One wallet request at a time.** A wallet queues what it cannot show at once,
so a second request raised while one is open resurfaces later as a prompt the
user has no context for. Reading balances is a wallet prompt too. Put the lock
at the boundary and release it when the wallet answers, not when you stop
waiting.

**Local state lies.** A list of links you sent, or money waiting for you, is a
cache. Reconcile it against the chain before you paint it, or you will offer a
button that can only revert after a prompt and a fee.

**Claims stay valid after expiry** until a refund actually happens. Expiry opens
the sender's door; it does not close the recipient's.

**AVNU's private swap needs a paymaster API key.** Its SDK hardcodes
`sponsored_private` and ignores the fee mode you pass. If you want a private
swap without a key, call the public `/swap/build` endpoint for the executor and
its calls, assemble the STRK20 actions yourself, and submit through the wallet.
See `src/lib/strk20/swap.ts`.

---

## 5. If you write your own contract instead

Reasonable, and probably right for an autonomous agent — because of §1.1, a
server cannot fund Lumen's escrow at all. `privacy_invoke` is pool-gated, so
only the pool can create entries.

The shape that fixes it, while keeping everything worth keeping:

- **A permissionless funding path.** `fund(claim_commitment, refund_commitment,
  expiry, token, amount)` that pulls tokens with `transfer_from`. Any account
  can call it, including a server holding a hot key. Funding is public; the
  *recipient list* is not, because only commitments are stored.
- **Keep both exits.** `claim_to_address` unchanged, plus a pool-gated
  `privacy_invoke` claim so recipients who are in the pool land in a shielded
  note. That keeps real STRK20 integration rather than a plain escrow.
- **Keep the domain separation, the expiry-gated refund, and the solvency
  assert** (`assert_solvent` reads the balance once per batch, not once per
  leg).

That is Lumen's escrow with the deposit gate inverted. `contracts/src/escrow.cairo`
is MIT and readable; start from it rather than from scratch.

The honest tradeoff to state in your README: public funding means the total and
the timing are visible. What stays private is who is on the list and who
collected — which for a payout agent is usually the part that matters.

---

## 6. Verifying you got it right

- Read `get_fee_amount()` from the pool instead of assuming 6 STRK.
- Before the first real payout, check the entry exists: read the escrow's
  storage at your `claim_commitment` and confirm `exists` and the amount.
- After a claim, confirm the `claimed` flag flipped — do not infer success from
  the wallet.
- `assertNeverUnshields` (see `src/lib/strk20/actions.ts`) is worth copying: it
  refuses to submit any action list whose `withdraw` legs go anywhere except a
  helper contract in the same transaction. It is the one invariant separating
  this from a mixer, and it belongs in code rather than in a comment.

---

Questions the source answers better than prose: `contracts/src/escrow.cairo`
for the contract, `src/lib/strk20/escrow.ts` for the payloads,
`docs/WHAT-LUMEN-ACTUALLY-IS.md` for what is proven and what is not.
