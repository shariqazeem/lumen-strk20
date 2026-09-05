# Lumen's contracts — three STRK20 anonymizers

Cairo **helper (anonymizer) contracts** for the STRK20 privacy pool on Starknet
mainnet. Each exposes the `privacy_invoke` entry point the pool calls during
`InvokeExternal`, and each does one thing inside a single atomic pool operation.

| contract | mainnet address | what it does | tests |
|---|---|---|---|
| **LumenEscrow** | [`0x6c96b86d…`](https://voyager.online/contract/0x6c96b86d5f1eaee16be18ca4f346edb20c098f1106648cef3845b34723df272) | claim links with two doors, batch payouts, expiry-gated reclaim | 35 |
| **LumenVault** | [`0x73e57be7…`](https://voyager.online/contract/0x73e57be7d6c9d2321d7a01d0c2e426392fd5e736ecfbcd91d4216ba5d7a5f67) | stakes shielded strkBTC into Endur without unshielding | 17 |
| **LumenSplitter** | [`0x44d15d99…`](https://voyager.online/contract/0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0) | one private amount into N non-round notes | 29 |

**81 tests, all passing.** Two superseded escrows (`0x43e41de8…`, `0x293c8a95…`)
still hold and honour links minted against them; the app resolves which
contract holds a commitment before acting on it.

> **Unaudited.** An anonymizer is the app team's code to write, review and audit.
> Nothing here has been reviewed by StarkWare or anyone else. Read the security
> notes on each contract before deploying anything.

---

## The shape they share

Every helper is a **pool-gated conduit**: stateless, pinned at deployment to one
pool, holding nothing between transactions.

```text
phase 6  Withdraw    tokens -> helper              (public: the pool paid the helper)
phase 5  CreateOpenNote x N                        (`transfer` actions with amount "OPEN")
phase 7  InvokeExternal(helper) -> privacy_invoke
             ├─ measures the balance actually delivered  (never trusts calldata)
             ├─ does its one job
             ├─ approves the pool for exactly what it promises
             └─ returns Span<OpenNoteDeposit>, one entry per open note
         the pool pulls the tokens back and fills each open note
```

The helper **approves, it never transfers to the pool** — the pool pulls. Any
revert aborts the whole pool transaction and no funds move.

Three invariants hold across all three, and the tests pin each:

- **Balance-delta.** The amount worked on is `balance_of(self)`, measured. A
  caller who declares less than was delivered strands the difference; one who
  declares more gets a revert late instead of a rejection early.
- **Exact allowance.** The pool is approved for precisely the sum being promised
  in the returned `OpenNoteDeposit`s. Larger aborts the transaction; smaller
  strands tokens in the helper.
- **Pool-gated.** `privacy_invoke` asserts `get_caller_address()` is the pinned
  pool. A permissionless helper would let anyone sweep a mid-transaction balance
  or grant themselves an allowance.

`OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }` is
declared locally in each contract, field-for-field identical to
`privacy::objects::OpenNoteDeposit`, so the package builds standalone.

---

## LumenEscrow — claim links

`src/escrow.cairo` · 35 tests in `src/tests_escrow.cairo`

Parks value behind a secret so it can be paid to someone who is not set up yet.
The secret travels in a URL fragment (never sent to a server); the recipient
collects through whichever door they can.

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

/// The public door. No pool gate, no caller check: the preimage is the authority.
fn claim_to_address(ref self: T, secret: felt252, recipient: ContractAddress);
```

**Two doors on one link.** `Claim` via `privacy_invoke` lands in a shielded note
for a recipient already in the pool. `claim_to_address` pays any address for a
recipient with nothing — no pool membership, no shielded balance, no gas, no
deployed account contract. Verified on mainnet against a wallet that had none of
those four.

- **Domain-separated commitments.** `poseidon('LUMEN_ESCROW_CLAIM:V1', s)` and
  `poseidon('LUMEN_ESCROW_REFUND:V1', s)`, so a reclaim key can never spend a
  link and a link can never trigger a reclaim. `test_claim_commitment_matches_client_vector`
  pins the TypeScript side to the Cairo side.
- **`take_entry` flips `claimed`; it does not delete.** That is what lets a
  client tell *already collected* apart from *never existed*.
- **`DepositMany`**: up to `MAX_BATCH = 32` legs in one operation under one
  pool fee, bound to the funds actually delivered. `assert_solvent` reads the
  balance once per batch, not once per leg.
- **Claims stay valid after expiry until a refund actually happens.** Expiry
  opens the sender's door; it does not close the recipient's.
- **Token-generic.** `token: ContractAddress` throughout — STRK, USDC and
  strkBTC all work today.

---

## LumenVault — private Bitcoin staking

`src/vault.cairo` · 17 tests in `src/tests_vault.cairo`

strkBTC is Starknet's shielded Bitcoin; Endur's xstrkBTC is its liquid-staked
form, an ERC-4626 vault over it. Both are shieldable — but Endur's `deposit`
pulls from a **public** ERC-20 balance, and inside the pool your Bitcoin is a
commitment with nothing for a vault to pull. Staking meant unshield → deposit
publicly → re-shield: three public legs, two of them matching amounts on one
address seconds apart.

This contract does it in one pool operation.

```cairo
fn privacy_invoke(ref self: T, note_id: felt252, min_shares: u128) -> Span<OpenNoteDeposit>;

fn pool_address(self: @T) -> ContractAddress;
fn vault_address(self: @T) -> ContractAddress;   // Endur xstrkBTC, pinned
fn asset_address(self: @T) -> ContractAddress;   // strkBTC, pinned
fn preview_stake(self: @T, assets: u128) -> u128;
```

- **The open note is in xstrkBTC**, the receipt token — not strkBTC. Opening it
  in the input token makes the pool fill a note that does not exist.
- **Shares are measured as a balance delta**, not read from the vault's return.
  If a vault ever disagrees with itself, the balance is the one that can be
  approved.
- **`min_shares` is a floor.** An ERC-4626 rate moves between quoting and
  execution; a caller that quoted can refuse a worse fill. Zero opts out.
- **Vault and asset pinned at deployment**, and the constructor asserts
  `vault.asset() == asset` — a deploy naming the wrong underlying aborts
  rather than silently approving the wrong token.
- **No unstake operation, on purpose.** Endur redeems through a withdraw queue
  and the vault's liquid buffer was zero when this was written, so `redeem`
  cannot fill an open note atomically. A function that always reverts is worse
  than one that does not exist. The exit is a private AVNU swap, which the app
  already calls.

Proven on mainnet: [`0x1c0f54bf…`](https://voyager.online/tx/0x1c0f54bfc908796334dff47cdc6117d7591929d9329e5e833a6b76f99a10752)
— 0.0001 strkBTC in, 0.00009934 xstrkBTC back into a shielded note, exactly what
`preview_stake` quoted.

---

## LumenSplitter — N non-round notes from one amount

`src/splitter.cairo` · 29 tests in `src/tests.cairo`

Takes one input amount and credits it back as N non-round output notes in a
single transaction: one fee, one timestamp, one proof. Deployed and tested;
**not yet exercised on mainnet** — the one built thing here with no receipt.

```cairo
fn privacy_invoke(
    ref self: T,
    mode: SplitMode,           // 0 = Exact, 1 = Bps
    token: ContractAddress,
    in_amount: u128,           // Exact: the withdrawn amount · Bps: minimum-delivered floor (0 = none)
    fee_amount: u128,          // 0 for a fee-free route
    parts: Span<u128>,         // Exact: absolute amounts · Bps: basis points summing to 10_000
    note_ids: Span<felt252>,   // ${openNoteIds[0]} … ${openNoteIds[n-1]}
) -> Span<OpenNoteDeposit>;

fn preview_bps_split(self: @T, total: u128, parts: Span<u128>) -> Span<u128>;
```

- **`Exact`** asserts `sum(parts) == in_amount − fee_amount` exactly. The normal
  path: the planner computes non-round legs off-chain with a reproducible seed
  and the contract enforces reconciliation.
- **`Bps`** splits the balance **measured on-chain**; the last leg absorbs the
  rounding remainder so outputs still sum exactly. For amounts only known at
  execution time.
- **The contract never invents randomness.** Cairo has no good entropy source,
  and every split plan must be reproducible by the planner that emitted it.
- **Fees are opt-in and capped**: deployed with `fee_recipient = 0` and
  `max_fee_bps = 0`, so this instance cannot charge one.
- At most `MAX_SPLITS = 16` legs; every note id distinct and non-zero; the sum
  invariant checked twice, the second time against the deposits actually being
  returned.

**When to use it, honestly:** if the amount is known at proof time, N `transfer`
actions creating *encrypted* notes are cheaper and strictly more private —
open-note amounts are plaintext by design. Use the helper where the
execution-time measurement is the point.

---

## Build, test, deploy

Toolchain: **scarb 2.15.1** (cairo 2.15.0), **snforge 0.56.0**.

```bash
cd contracts
scarb fmt --check
scarb build          # target/dev/lumen_splitter_<Contract>.contract_class.json
snforge test         # 81 tests
```

Deploy with **`node contracts/deploy.mjs --contract <escrow|splitter|vault>`**,
on starknet.js. It declares, deploys, verifies, and wires the address into
`.env.local` and `strk20.json`. The verify step is the part worth reading: it
reads a view function back and asserts the value, compares the on-chain class
hash against the local build, and flattens the Cairo 2 ABI before comparing
argument counts — each of which caught a real failure that "the transaction
succeeded" would have hidden.

The keystore password is typed into the running process with echo off; the
decrypted key exists only in memory and is zeroed when the deploy finishes.

**Why not starkli:** 0.4.2 still asks for the `pending` block tag, which mainnet
replaced with `pre_confirmed`; every call fails. `sncast` works and reads the
same starkli keystore (`--keystore` plus `--account` as a path).

**Budget before you spend.** Declaring is charged by Sierra length, about
0.0102 STRK per felt. `sierra-replace-ids = false` in `Scarb.toml` strips
identifiers that only carry debugging value — free money on every declare.

## Layout

```text
contracts/
├─ Scarb.toml            edition 2024_07 · starknet 2.15.0 · snforge_std 0.56.0
├─ deploy.mjs            declare → deploy → verify → wire, on starknet.js
├─ src/
│  ├─ lib.cairo          module root
│  ├─ escrow.cairo       LumenEscrow
│  ├─ vault.cairo        LumenVault
│  ├─ splitter.cairo     LumenSplitter
│  ├─ mock_erc20.cairo   test doubles — never deployed
│  ├─ mock_vault.cairo
│  ├─ tests_escrow.cairo 35 tests
│  ├─ tests_vault.cairo  17 tests
│  └─ tests.cairo        29 tests
└─ README.md
```

See [`docs/INTEGRATING-WITH-LUMEN.md`](../docs/INTEGRATING-WITH-LUMEN.md) for
the payload shapes a dapp sends, and [`docs/TRAPS.md`](../docs/TRAPS.md) for
everything that cost time getting these onto mainnet.
