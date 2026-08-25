# Aether — the idea

## One line

**Shielded isn't private.** Aether is the missing statistical layer of the
privacy stack: it runs the real deanonymization attacks against your own
footprint, then closes every leak it finds — without capital ever leaving the
STRK20 pool.

---

## The problem everyone is missing

Privacy on-chain has three layers.

| Layer | Status | Who owns it |
|---|---|---|
| **1. Cryptographic hiding** — commitments, nullifiers, ZK proofs | Solved | The chain. STRK20 *is* this layer. |
| **2. Protocol metadata** — relayers, stealth accounts, gas privacy | Being solved | The chain, increasingly. |
| **3. Statistical privacy** — the *sequence* of what you do | **Unsolved** | **Nobody** |

Layer 3 is where deanonymization actually happens, and it is unowned — not
because it's hard, but because **it isn't a protocol primitive**. It's
opinionated, user-side discipline about behaviour over time. A chain cannot
ship it. It has to be an application.

That is the entire opening.

### Why layer 3 is the real attack surface

A privacy pool hides the **link** between a deposit and a withdrawal. It does
not hide the legs themselves — both are public, with amounts and addresses in
the clear.

So an attacker never touches the cryptography. They pair the public legs
statistically:

- **4,182.44 in, 4,180.00 out** four hours later → same person, near-certainly.
- **A round 1,000** → you're now in the tiny subset of users who chose round
  numbers, not the pool's thousands.
- **Deposit 09:12, activity 09:31** → a twenty-minute window is a small crowd.
- **Every Monday at 09:00** → each transaction is cryptographically perfect and
  the *schedule* identifies you anyway.
- **A tier with four other users** → the maths works, but there's no crowd to
  hide in.

This is the documented failure mode of every studied pool. No amount of proving
strength fixes any of it.

> **The pool gives you an anonymity set. Your behaviour spends it.**

---

## The insight

Privacy is not a property of a transaction. It is a property of a **sequence**.

Every existing tool — including the three privacy protocols we shipped before
this one — optimises the transaction. Aether optimises the sequence.

---

## What we built

### 1. A live adversary (the differentiator)

Not a warning label. A working deanonymization engine implementing seven
published heuristics — amount correlation, exit-minus-fee reconstruction, round
numbers, timing windows, thin anonymity sets, repeated amounts, cadence — that
runs against a target's real footprint using live pool data and returns a
**linkability score with evidence attached**.

It attacks *you* first. The contrast is asserted in tests, not claimed:

| Footprint | Linkability | Findings |
|---|---|---|
| Naive — round 1,000 in, same amount out 20 min later, weekly | **100 · exposed** | 16 |
| Aether-managed — non-round splits, no matching exit, irregular gaps | **0 · shielded** | 0 |

Same engine, same pool data. Only behaviour differs.

**It needs no wallet.** Exposure analysis reads only public chain data, so
anyone can point it at any Starknet address immediately.

### 2. The loop (the ecosystem)

Every finding carries the exact remedy that closes it, which turns four
disconnected features into one circuit:

```
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  ▼                                                          │
[ 01 EXPOSURE ] ─▶ [ 02 POSITION ] ─▶ [ 03 REMEDY ] ─▶ [ 04 LEDGER ]
  adversary          what you hold      the plan that      what you did vs
  finds the leaks    and how well       closes them        what they saw
                     it hides
```

The loop closes only when the adversary stops finding you.

### 3. The engine underneath

Deterministic and seeded — no `Math.random`, no ambient clock — so plans are
reproducible and the hard constraints are enforced by tests rather than
promised in prose:

- **Never unshields** unless you explicitly ask.
- **Never reuses an exact amount** within 48 hours.
- **Refuses any action** that would drop you below your privacy floor, and says
  why.
- **Compacts notes** before fragmentation shrinks your anonymity set.

### 4. A real anonymizer contract

`AetherSplitter` — a Cairo `privacy_invoke` helper that splits one shielded
amount into N non-round notes inside a *single* pool operation, instead of N
transactions each paying a fee and leaving a timing trail.

---

## Why this is different

**We build on top of the chain's privacy, not against it.**

Our three previous privacy projects — Veil (Starknet), SwarmShield (Solana),
Umbra (Stellar) — were all infrastructure: pools, verifiers, encryption layers.
Infrastructure competes with the platform, and the platform always wins that
race. Veil shipped an association-set pool; StarkWare then shipped STRK20
natively, which made it redundant by construction.

Aether cannot be made redundant the same way, because **STRK20 shipping more
cryptography makes Aether more useful, not less**. It completes the stack
instead of duplicating it.

And of the projects in this sprint, the pattern is payments, payroll, invoices,
wallets — variations on *"move money privately once."* Aether is the only one
asking **"how do you stay private across many actions?"**

---

## What it does not claim

A privacy tool that oversells is worse than none.

- **The deposit is public and stays public.** The app says so, in ember, every
  time. The mitigation is separation in time, not concealment.
- **Aether cannot fix an empty pool.** If the anonymity set is thin, no
  behaviour saves you, and the honest output is a refusal.
- **Statement proofs are not implemented.** Wallet API 0.10.3 exposes no
  statement-proof method, so Aether builds the canonical statement and waits.
  An ECDSA signature is not a ZK proof and is not offered as one.
- **Per-address public-event attribution is unimplemented**, and returns empty
  rather than guessing — wrong attribution would either miss real exposure or
  invent it.
- **`AetherSplitter` is an unaudited draft**, and open-note amounts are
  plaintext by design.

---

## Status

**Shipped:** the adversary (7 heuristics, 34 tests), the strategy engine, the
loop dashboard, the shield flow, the Cairo splitter (29 snforge tests), the
attack-model documentation. 158 TypeScript tests + 29 Cairo tests, all green.
Live and registered on the sprint hub.

**Remaining:** three mainnet transactions, the demo video, and deploying the
splitter — all of which need the owner's wallet and gas.
