# LumenSplitter — a STRK20 anonymizer contract

A Cairo **helper (anonymizer) contract** for the STRK20 privacy pool on Starknet
mainnet. It exposes the `privacy_invoke` entry point the pool calls during
`InvokeExternal`, and it does exactly one thing: **takes one input amount of a
token and credits it back as N non-round output notes inside a single atomic
transaction.**

> **DRAFT — not audited.** An anonymizer is the app team's code to write, review
> and audit. Nothing here has been reviewed by StarkWare or anyone else. Read
> [Security notes](#security-notes) before you even think about `deploy.sh`.

---

## Why it exists

Lumen's thesis is that **behaviour, not cryptography, deanonymizes privacy-pool
users**. A pool with perfect cryptography still leaks if its users move round
numbers at predictable times. The engine's two strongest remedies are:

- **Amount entropy** — never emit a round or repeated amount.
- **Note-count management** — hold a sane number of notes, neither one giant
  note nor a hundred crumbs.

Splitting one balance into several unequal notes is the primitive both remedies
need. Doing it as N separate pool transactions costs a pool fee each (currently
6 STRK per operation) and leaves a timing trail that re-links the very notes the
split was meant to decorrelate. `LumenSplitter` performs the whole split inside
**one** pool transaction: one fee, one timestamp, one proof.

### Does the pool actually support several output notes per transaction?

Yes. Three independent confirmations, all from the references in
`.agents/skills/`:

1. The wallet placeholder is **indexed and zero-based**:
   `${openNoteIds[N]}` — *"the ID of the Nth open note in the same transaction
   (i.e. the Nth transfer action with amount `"OPEN"`); N is a zero-based
   index"*, with schema pattern `^\$\{(?:openNoteIds\[[0-9]+\]|poolAddress)\}$`.
   A single-note protocol would not index, and would not allow `[0-9]+`.
2. `privacy_invoke` returns **`Span<OpenNoteDeposit>`**, a list, and each entry
   names its own `note_id`. The pool iterates it and applies every entry.
3. The **phase table** (`actions-and-proofs.md`) marks only phase 7
   (`InvokeExternal` / `ComputeAndInvoke`) as "at most one". Phase 5
   (`CreateEncNote` / `CreateOpenNote`) carries no such limit — multiple note
   creations per transaction are ordinary (every change note is one).

The one hard limit that *does* apply: **one `invoke` per transaction**. That is
why the splitter is a standalone helper and cannot be chained behind another
helper in the same transaction.

### When to use it — and when not to

| Situation | Best route |
| --- | --- |
| Input amount known when the transaction is proven, and you want the **amounts hidden** | Prefer N `transfer` actions in one pool transaction: they create **encrypted** notes. Cheaper and strictly more private than this helper. |
| Input amount only known **at execution time** (a delivered balance, a variable inbound payment) | `LumenSplitter` in `Bps` mode. A client cannot split what it cannot predict at proof time. |
| You want the split **enforced and auditable on-chain** — sum reconciliation, non-zero legs, distinct notes, capped fee | `LumenSplitter` in `Exact` mode. |

Be honest about the trade-off: **open-note amounts are plaintext by design.**
The owner of each note stays hidden, but an observer of the transaction sees the
helper being paid and N public amounts that sum to it. That is the cost of a
value measured on-chain rather than fixed at proof time. Use the helper where
the execution-time measurement is the point, not as a blanket replacement for
in-pool transfers.

---

## The shape of the transaction

```text
phase 6  Withdraw    amount -> splitter            (public: pool paid the helper)
phase 5  CreateOpenNote x N                        (transfer actions with amount "OPEN")
phase 7  InvokeExternal(splitter) -> privacy_invoke
             ├─ measures the balance actually delivered
             ├─ pays the declared fee (if any) to the pinned recipient
             ├─ resolves the caller's plan into N amounts
             ├─ asserts they sum to exactly input - fee
             ├─ approves the pool for exactly that sum
             └─ returns Span<OpenNoteDeposit>, one entry per open note
         pool pulls the tokens and fills each open note
```

The helper **approves, it never transfers to the pool** — the pool executes the
pull itself. Any revert aborts the entire pool transaction and no funds move.

## Calldata layout

The pool deserializes calldata straight into `privacy_invoke`'s parameters, so
**order is load-bearing**:

```text
index  field           type                     notes
-----  --------------  -----------------------  -------------------------------------------
0      mode            SplitMode (felt)         0 = Exact, 1 = Bps
1      token           ContractAddress          the ERC-20 being split
2      in_amount       u128                     Exact: the withdrawn amount
                                                Bps:  minimum delivered floor (0 = no floor)
3      fee_amount      u128                     0 for a fee-free route
4      parts_len       u32                      1..=16
5..    parts[i]        u128 x parts_len         Exact: absolute amounts
                                                Bps:  basis points, summing to 10_000
5+n    note_ids_len    u32                      must equal parts_len
6+n..  note_ids[i]     felt252 x note_ids_len   ${openNoteIds[0]} ... ${openNoteIds[n-1]}
```

Signature:

```cairo
fn privacy_invoke(
    ref self: T,
    mode: SplitMode,           // 0 = Exact, 1 = Bps
    token: ContractAddress,
    in_amount: u128,
    fee_amount: u128,
    parts: Span<u128>,
    note_ids: Span<felt252>,
) -> Span<OpenNoteDeposit>;
```

Return: `Span<OpenNoteDeposit>` where
`OpenNoteDeposit { note_id: felt252, token: ContractAddress, amount: u128 }` —
mirroring `privacy::objects::OpenNoteDeposit` field for field.

### Dapp side

One `withdraw` in, N open notes, one `invoke`. Note the **N** `transfer` actions
with amount `"OPEN"`: `${openNoteIds[i]}` refers to the i-th of them.

```ts
import type { STRK20_ACTION } from '@starknet-io/types-js'

const legs = ['0x5b8...a95', '0x861...1c3', '0x5d5...004'] // planner's entropic amounts, hex
const actions: STRK20_ACTION[] = [
  // 1. Move the input to the helper.
  { type: 'withdraw', token, amount: totalHex, recipient: SPLITTER },

  // 2. Open one note per output leg, in order.
  { type: 'transfer', token, amount: 'OPEN', recipient: userAddress },
  { type: 'transfer', token, amount: 'OPEN', recipient: userAddress },
  { type: 'transfer', token, amount: 'OPEN', recipient: userAddress },

  // 3. Invoke the splitter. Calldata order must match privacy_invoke exactly.
  {
    type: 'invoke',
    contract: SPLITTER,
    calldata: [
      '0x0',                    // mode = Exact
      token,
      totalHex,                 // in_amount
      '0x0',                    // fee_amount
      '0x3', ...legs,           // parts:    len + amounts
      '0x3',                    // note_ids: len
      '${openNoteIds[0]}',
      '${openNoteIds[1]}',
      '${openNoteIds[2]}',
    ],
  },
]

await account.strk20PrepareInvoke(actions, true) // dry-run first
```

`"OPEN"`, `"${openNoteIds[i]}"` and `"${poolAddress}"` are **literal placeholder
strings** the wallet substitutes. Never hex-normalize them.

The repo's existing `buildPrivateDefi()` in `src/lib/strk20/actions.ts` emits a
single open note and one `${openNoteIds[0]}`; wiring the splitter needs a
builder variant that emits N of each. That change is deliberately not part of
this package.

## Two split modes

**`Exact` (mode 0)** — `parts` are absolute amounts. Asserts
`sum(parts) == in_amount - fee_amount` exactly, and that the helper actually
holds at least `in_amount`. This is the normal Lumen path: the planner computes
non-round legs off-chain with a reproducible seed and the contract enforces
reconciliation.

**`Bps` (mode 1)** — `parts` are basis points summing to exactly `10_000`. The
total is the balance **measured on-chain**, `in_amount` acts as a
minimum-delivered floor (`0` opts out). Each leg is floored in u256, and the
**last leg absorbs the rounding remainder** so the outputs still sum exactly.
`preview_bps_split(total, parts)` is a free view that reproduces the on-chain
rounding for the planner.

Proportions are always supplied by the caller. The contract **never invents
randomness**: Cairo has no good entropy source, and Lumen's split plans must be
reproducible by the planner that emitted them.

## Guarantees asserted on-chain

| Guard | Error |
| --- | --- |
| Caller is the pool pinned at deployment | `CALLER_NOT_POOL` |
| Pool address non-zero at deployment | `ZERO_POOL_ADDRESS` |
| Token address non-zero | `ZERO_TOKEN` |
| Input (declared or delivered) non-zero | `ZERO_IN_AMOUNT` |
| At least one leg | `EMPTY_SPLIT` |
| At most `MAX_SPLITS` (16) legs | `TOO_MANY_SPLITS` |
| One note id per leg | `LENGTH_MISMATCH` |
| No zero-amount / zero-bps leg | `ZERO_PART` |
| No zero note id | `ZERO_NOTE_ID` |
| No note id used twice | `DUPLICATE_NOTE_ID` |
| **Outputs sum to exactly input − fee** | `SPLIT_SUM_MISMATCH` |
| Basis points sum to exactly 10_000 | `BPS_SUM_MISMATCH` |
| Helper actually holds what it promises | `INSUFFICIENT_BALANCE` |
| Fee below the input and below the pinned cap | `FEE_EXCEEDS_INPUT`, `FEE_ABOVE_CAP` |
| Non-zero fee requires a configured recipient | `FEE_RECIPIENT_UNSET` |
| u256→u128 conversions checked | `AMOUNT_OVERFLOW`, `SUM_OVERFLOW` |

The sum invariant is checked twice: once against the caller's plan, and once
re-derived from the deposits actually being returned. A helper that silently
loses value is a critical bug, so the last gate reads the output, not the input.

## Security notes

- **Stateless.** No user state persists between transactions, and in the normal
  path the pool pulls back everything it delivered within the same transaction.
  One caveat worth stating plainly: in `Exact` mode any balance *above*
  `in_amount` is left behind, because only the declared amount is distributed.
  Dust like that is not lost — the next caller sweeps it (`Bps` mode splits the
  whole measured balance) — but do not treat the contract as a vault.
- **Pool-gated anyway.** `privacy_invoke` asserts `get_caller_address() ==` the
  pinned pool. A permissionless helper would let anyone drain a mid-transaction
  balance or mint themselves an allowance.
- **Exact allowance.** The pool is approved for precisely the sum being
  promised, so no allowance lingers after the transaction.
- **Fees are opt-in and capped.** Deploy with `fee_recipient = 0` and
  `max_fee_bps = 0` to disable them entirely — that is the intended Lumen
  configuration.
- **Open-note amounts are public.** See the trade-off table above.
- Run the `cairo-security` skill and get a human review before deploying.

---

## Build, test, deploy

Toolchain: **scarb 2.15.1** (cairo 2.15.0), **snforge 0.56.0**, **starkli 0.4.2**.

```bash
cd contracts
scarb fmt --check     # formatting
scarb build           # -> target/dev/lumen_splitter_LumenSplitter.contract_class.json
snforge test          # 29 tests
```

Build output, the file `starkli` declares:

```text
contracts/target/dev/lumen_splitter_LumenSplitter.contract_class.json
```

Its class hash can be computed locally, without touching a network or a key:

```bash
starkli class-hash target/dev/lumen_splitter_LumenSplitter.contract_class.json
```

Deployment is `contracts/deploy.sh`. It is **documented and non-executing by
design**: it prints the exact commands and never touches key material. Declaring
and deploying spend real mainnet gas, so the repo owner runs them, with their own
account and their own signer. Read the script before running anything it prints.

## Layout

```text
contracts/
├─ Scarb.toml          edition 2024_07, starknet 2.15.0, snforge_std 0.56.0
├─ src/
│  ├─ lib.cairo        module root
│  ├─ splitter.cairo   LumenSplitter — the contract
│  ├─ mock_erc20.cairo minimal ERC-20, tests only, never deployed
│  └─ tests.cairo      29 tests
├─ deploy.sh           documented, non-executing starkli walkthrough
└─ README.md
```

## References

Everything here was written against the on-disk references, not from memory:

- `.agents/skills/strk20-anonymizer-contracts/SKILL.md`
- `.agents/skills/strk20-anonymizer-contracts/references/helpers__privacy-invoke.md`
  — the `privacy_invoke` contract surface and the five rules
- `.agents/skills/strk20-anonymizer-contracts/references/helpers__swap-helper.md`
  — the balance-delta idiom and the u256→u128 guard
- `.agents/skills/strk20-anonymizer-contracts/references/helpers__escrow.md`
  — the pinned-pool / `CALLER_NOT_PRIVACY` access-control pattern
- `.agents/skills/strk20-privacy/references/actions-and-proofs.md`
  — the phase table and the per-token balance invariant
- `.agents/skills/strk20-wallet-api/references/starknet-wallet-api__private-defi.md`
  — the `${openNoteIds[N]}` placeholder semantics
- `.research/strk20-starter-kit/cairo/src/lib.cairo`
  — a working deployable helper with a locally declared `OpenNoteDeposit`

Contract packages live in `starkware-libs/starknet-privacy`; verify current
sources there before adapting. Reference snapshot: 2026-08-16.
