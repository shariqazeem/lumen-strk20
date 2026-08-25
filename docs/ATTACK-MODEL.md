# The attack model

Lumen exists because of a gap that is easy to state and hard to close:

> A privacy pool gives you an anonymity **set**. Your behaviour **spends** it.

This document is the reasoning behind the product. It describes what a shielded
pool actually hides, what it leaves in the open, and how an adversary re-forges
the link without touching any cryptography.

---

## 1. Three layers, one of them unowned

| Layer | What it does | Who builds it |
|---|---|---|
| **Cryptographic hiding** | commitments, nullifiers, proofs — the link between deposit and withdrawal is not on-chain | The chain. STRK20 **is** this layer. |
| **Protocol metadata** | relayers so the submitter isn't you, stealth accounts, gas privacy | The chain, increasingly. |
| **Statistical privacy** | *the sequence*: how much, how often, when, in what pattern | **Nobody.** |

The third layer isn't a protocol primitive. It's a set of opinionated decisions
about how a user should behave over time — which is an application, not a
contract. That is the space Lumen occupies, and it's the reason Lumen builds
*on top of* STRK20 rather than competing with it.

---

## 2. What is actually public

This is the part that surprises people. In a shielded pool:

- **Deposits are public.** The depositing address and the amount are both
  visible. This is unavoidable — value has to enter from somewhere.
- **Withdrawals are public.** The receiving address and the amount are visible.
- **The link between them is hidden.** That, and only that, is what the
  cryptography buys you.
- **In-pool actions are genuinely private.** A note-to-note transfer emits a
  commitment, not a value. Verified against mainnet: STRK20 pool events carry
  three keys and a single data word — no recoverable amount.

So the adversary's job is not to break a proof. It is to look at two public
legs and decide, statistically, that they belong to the same person.

---

## 3. The heuristics

Each of these is implemented in [`src/lib/deanon/heuristics.ts`](../src/lib/deanon/heuristics.ts)
and unit-tested. They are not hypothetical — they are the documented failure
modes of deployed pools.

### 3.1 Amount correlation

The canonical attack. If 4,182.44 USDC goes in and 4,180.00 USDC comes out a
few hours later, those are the same person with overwhelming probability. No
other user happened to pick that number.

**Why it works:** the amount is public on both legs, and the space of amounts
is enormous. An exact-ish match is a fingerprint.

**Remedy:** never let an exit amount resemble an entry amount. Lumen splits
into non-round parts that sum correctly but individually match nothing.

### 3.2 Round numbers

`1000`. `500`. `10000`. Humans choose round numbers, so a round amount places
you in the small subset of users who also chose round numbers — collapsing an
anonymity set of thousands into one of dozens.

**Remedy:** the amount splitter refuses round outputs. This is also why the
shield form nudges against typing `1000`.

### 3.3 Timing correlation

A deposit at 09:12 and a pool interaction at 09:31 are temporally linked, even
with different amounts. The narrower the window, the stronger the inference.

**Remedy:** execution windows are de-periodised and deliberately wide; the
planner will delay rather than act inside a suspicious gap.

### 3.4 Cadence and periodicity

The subtle one, and the reason "privacy is a sequence" is the thesis. Shield
1,000 USDC every Monday at 09:00 and **every individual transaction is
cryptographically perfect while you have no privacy at all** — the schedule
identifies you. Low variance in inter-arrival gaps, or clustering at one
hour-of-day, is enough.

**Remedy:** inter-arrival entropy is a scored term. Regular cadence lowers the
score and forces a replan.

### 3.5 Thin anonymity sets

Being in a denomination tier with four other users means the set doesn't hide
you. A set of one is certainty.

**Remedy:** measured live from pool activity. Lumen will refuse to act into a
thin set rather than pretend the action was private.

### 3.6 Behavioural uniqueness

A rare combination — this asset, this route, this size band — marks you even
when no single element does.

### 3.7 Exit-amount reconstruction

Out ≈ in − fee. The pool fee is a known constant (6 STRK on mainnet), so an
adversary can subtract it and check for a match.

---

## 4. Why a score, and why it is public

The score is a deterministic function of observable state, with published
weights:

```
S_eff = 0.30·A_set + 0.25·H_amount + 0.20·H_time
      + 0.15·(100 − U_behaviour) + 0.10·(100 − R_exit)
```

A privacy score you cannot audit is marketing. Publishing the formula means a
reviewer can disagree with the weights — which is the point. The weights are a
claim, and claims should be inspectable.

Note the inversion: `U_behaviour` and `R_exit` are stored as **raw risk**
(higher is worse) and inverted in the formula. Getting this backwards would
silently invert the product's advice, so it is asserted in tests.

---

## 5. What Lumen does *not* claim

Honesty is load-bearing here; a privacy tool that oversells is worse than none.

- **The deposit is public and stays public.** Lumen says so in the interface,
  in ember, every time. The mitigation is separation in time, not concealment.
- **Lumen cannot fix a pool that is empty.** If the anonymity set is thin, no
  behaviour saves you, and the honest output is a refusal.
- **Statement proofs are not implemented.** Wallet API 0.10.3 exposes no
  statement-proof method. Lumen builds the exact canonical statement and waits
  for wallets to ship the proving side. An ECDSA signature is not a ZK proof and
  is not offered as one.
- **The local ledger is local.** The behavioural terms need history, and the
  chain deliberately cannot supply it. Clearing browser storage resets them.
- **`LumenSplitter` is an unaudited draft**, and open-note amounts are
  plaintext by design — see [`contracts/README.md`](../contracts/README.md) for
  exactly when it helps and when plain transfers are strictly better.

---

## 6. The loop

The product follows from the model:

```
   ┌─────────────────────────────────────────────┐
   │                                             │
   ▼                                             │
[ measure exposure ] ──▶ [ plan the remedy ] ──▶ [ execute ] ──▶ [ record ]
   adversary runs          each finding            inside the      what the
   the heuristics          names its fix           pool            observer saw
```

Attack first, then defend, then re-attack. The loop closes only when the
adversary stops finding you.
