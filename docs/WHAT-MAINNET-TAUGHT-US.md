# What running it on mainnet taught us

A note for the advisor who scoped the "private payments that feel like normal
money" transformation. The advice was sound on the evidence available. Then we
put it in front of a real wallet with real money, and four things turned up
that no amount of reading the docs would have surfaced. Two of them narrow the
claim; two of them make the differentiator sharper than it was.

Written 2026-08-28, after the first mainnet session. Everything below was
verified against Starknet mainnet, not inferred — the method is stated for each
so it can be re-checked.

---

## 1. There is an irreducible wallet step, and no dapp can remove it

**What we found.** An account must register with the STRK20 pool before it can
hold or receive a private balance. Both sender *and* recipient must be
registered before a private transfer between them.

The Wallet API exposes exactly three STRK20 methods:

```
strk20Balances(tokens)             -> shielded balances
strk20PrepareInvoke(actions, sim)  -> build and prove
strk20InvokeTransaction(actions)   -> submit
```

**None of them registers an account.** There is no method for it, so no dapp
can perform this on a user's behalf — by design, which is also why nobody can
register you behind your back.

**How we found it.** Connected Ready (a privacy-enabled wallet, 800 STRK
public), pressed Add money, and the wallet returned error **118
NOT_REGISTERED**. Not a rejected prompt — no prompt appeared at all.

**Why the docs read otherwise.** STRK20's documentation says *"wallets handle
registration on first use"*, and the SDK offers `autoRegister: true` to bundle
it into the first operation. That describes the **SDK path**, where the
integrator holds keys. It does **not** describe the **Wallet API path** that a
dapp takes. We had read that line as covering both. It does not.

**Consequence for the thesis.** *"Send money. Lumen handles the privacy"*
cannot be true for a first-time user. The first thing a new account must do is
leave our app, shield once inside its own wallet, and come back. That step
belongs to every STRK20 dapp equally — it is not a Lumen defect — but it means
the "no second workflow" claim has to be scoped to *after* onboarding, or it is
simply false and a judge will find that out in thirty seconds.

**What we did about it.** The pool publishes `get_public_key(user_addr)`, which
returns zero for an unregistered account. That is a public read requiring no
wallet prompt, so the app now knows on connect which state the user is in and
opens on the single instruction that applies. Nobody types an amount before
learning they cannot send it.

---

## 2. The pool fee is flat, which changes what "small" means

**What we found.** `get_fee_amount()` on the pool returns **6 STRK per
operation**. Flat. Not a percentage, not scaled to size — about $0.15 at
current prices.

| Shield | Fee as a share |
|---|---|
| 10 STRK | **60%** |
| 50 STRK | 12% |
| 100 STRK | 6% |
| 700 STRK | 0.86% |

**How we found it.** We advised the founder to test with 10 STRK. Ready's
confirmation screen showed `-10.0 STRK` in, `+4.0 STRK` shielded, and *"6.0
STRK reserved from your balance for the privacy fee"*. We then read
`get_fee_amount()` directly to confirm it was flat rather than proportional.

**Consequences, and one of them is good.**

Small amounts are unusable. A product demo that shields "a test amount" looks
broken, because it is 60% fee. Any onboarding copy that says "try it with a
little" is actively harmful advice.

But the flat fee also gives **batching real economic weight**, not just
privacy weight. Paying five wallet-less people one at a time costs 5 × 6 = 30
STRK in pool fees. Our `DepositMany` does it in one operation for 6. That is a
6× cost argument on top of the privacy argument, and it was invisible to us
until we saw the fee was flat.

---

## 3. The wallet already does the thing the pitch was built on

**What we found.** Ready ships its own shield UI, its own unshield, private
transfers between registered users, and a shielded balance display. Its popup
literally advertises *"Shielded tokens are here — shield tokens to hide your
balance and addresses on block explorers."*

**Consequence.** "The easiest way to make a payment private" is not a
differentiator against the wallet the user already has open. For the narrow
case — *I have a shielded balance and want to pay one person who is already
registered* — **Ready is sufficient and Lumen adds nothing.** We should say
that out loud internally rather than discover it in a judging room.

**What survives, and it is verifiable rather than rhetorical.** Four things
the Wallet API and the pool structurally do not let a wallet do:

1. **Pay someone who has no wallet at all.** Ready requires a registered
   recipient. Our escrow holds the money behind a Poseidon commitment —
   `poseidon(LUMEN_ESCROW_CLAIM:V1, secret)` — and the claimant needs nothing
   until they open it. A wallet cannot offer this because it has no escrow.
2. **Pay N people in one operation.** One withdrawal, N commitments, one fee,
   one timestamp. A wallet does N transfers.
3. **Refuse to hand an observer a round number.** Ready shielded exactly
   `10.0`. Our guard proposed `9.845994`. A round deposit followed by a round
   withdrawal re-links the two ends without touching any cryptography — the
   Anonymity Gap in one sentence. Defending against that is not a wallet's job
   and Ready does not attempt it.
4. **Show what the world sees, and what the engine did.** The observer rail,
   the journal, and a self-only reading of the user's own public address.

The honest one-liner is therefore **not** "private payments made easy". It is
closer to: *once you are in, it is name → amount → Send — and Lumen is the
only thing that lets you pay someone who is not in yet.*

---

## 4. What this means for the demo

Three things follow directly, and they contradict the original shot list.

**Do not open on shielding.** That is Ready's screen, Ready is better at it,
and the registration wall lives there. Opening there shows a judge the one
part of the flow where we are strictly worse than doing nothing.

**Open on the thing a wallet cannot do.** A claim link, opened by someone with
no wallet, is the only frame in the whole product with no competitor on the
board.

**Do not film a small amount.** 10 STRK loses 60% to the fee on screen.

---

## 5. What is still unknown, and it is the important one

**Answered on 29 Aug 2026: no.**

A wallet created fresh for the test, which had never touched the pool, opened
a valid link holding 2 STRK and was refused with 118 NOT_REGISTERED. The
escrow kept the money — the commitment is untouched and the claim stays valid
— but the claimant has to join the pool in their own wallet before collecting.

**And then, the same evening, it came back.** The failure was not a limit of
the primitive, it was the primitive being half built. `claim_to_address` pays
out of the escrow's own ERC-20 balance, outside the pool gate, and it is
deliberately ungated — the preimage authorises, not the caller. So a third
party can collect *for* someone.

Proved on mainnet, block 14013048, tx `0x3af9f5cd…d57b20b`: 1.969194 STRK
delivered to a wallet with no pool registration, no shielded balance, no gas,
and **no deployed account contract**. It still has none. The recipient
performed no action whatsoever. A Starknet address can hold an ERC-20 before
its account exists; deployment is only needed to *send*.

So the strong sentence is true after all, and now it is precise:

> You can pay someone who has nothing — not an account, not gas, not a wallet
> they have opened. Someone else delivers it, and the secret is the only
> authority.

Independent corroboration arrived from Ready the same hour. Asked to send
shielded tokens to that address, it answered: *"Private send unavailable.
Recipient isn't registered for private transfers."* Its only fallback is a
public send from the sender's own public balance — which names **both** ends.
The second door names one: the recipient. The payer was a pool withdrawal, and
the pool names nobody.

That distinction is the whole product for a payouts service. An agent paying
fifty testers with direct transfers appears fifty times. An agent funding one
`DepositMany` and relaying fifty collections appears **once**, as a withdrawal
of an unremarkable total, at one timestamp.

The intermediate finding, for the record — the private door alone:

> You can pay someone who is not set up yet. They set up when they collect,
> not before you send.

That is a real difference and not a consolation. A private transfer requires
the recipient to be registered **at the moment you send** — you cannot pay
someone who has not arrived. A hash-locked claim requires it only at the
moment they collect, which may be days later, and the sender needs to know
nothing about them at all: no address, no wallet, no prior contact. Ready
cannot do this, because a wallet has no escrow. Almoner batches to addresses,
which presupposes the recipient exists on-chain. Every link project on the
board mints to someone who still has to complete the same onboarding.

The original question, for the record:

The claimant receives value into an open note credited by the escrow. If the
wallet registers on that first receive, the wallet-less story holds completely.
If it does not — if only a *deposit* registers, the way it appears to work for
the sender — then claim links can only be opened by people who have already
registered, and the single strongest differentiator above collapses to
"slightly more convenient than a transfer".

We have not tested it. It needs a second wallet that has never touched the
pool. Everything in section 3 rests on the answer, so it is the next thing we
do and it should have been the first.

Note that this is a **wallet-behaviour** question, not a protocol one. The
protocol permits it; whether Ready does it on a receive is what we cannot
predict from documentation, which is precisely the lesson of section 1.

---

## 6. State of the build

Live on Starknet mainnet:

| | |
|---|---|
| `LumenEscrow` | `0x43e41de87ebfaec2913a85398a68e011ab2a92bbddb9211956bfabe6ed57288` |
| `LumenSplitter` | `0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0` |

Shipped since the transformation: the Send composer as the account's first
screen; recipient-registration detection that offers a claim link instead of a
transfer that would revert; `DepositMany` for N wallet-less recipients in one
operation; the splitter wired as a pre-exit scatter into unequal notes; a
self-only reading of the user's own public address; and a first-run flow that
shows one instruction rather than four dead affordances.

273 TypeScript tests, 57 Cairo tests. `strk20.json.transactions` is **still
empty** — no product flow has yet run against the live pool, which remains the
single highest-risk item and outranks everything in this document.

Deployment cost, for planning: a declare is charged per Sierra felt, roughly
**0.0105 STRK per felt** at current prices. Our two classes (2425 and 2369
felts) cost ~26 and ~25 STRK to declare; deploying an instance afterwards is
~0.13 STRK. A contract change is therefore a ~25 STRK decision, not a free one.

---

## 7. The one place the original advice would change

The advice said the differentiator is *removing the decision to choose
privacy*. After section 1, that is only reachable for a user who has already
registered — and registration is exactly the decision, taken in someone else's
app.

So the differentiator is not that Lumen removes a decision. It is that Lumen
**removes the recipient from the problem entirely**: they need no wallet, no
registration, no decision, and no prior relationship with any of this. The
sender still has one wall to climb, once. The recipient has none, ever.

That is a smaller claim than the original and a much harder one to dispute,
and it is the only version we can currently prove on mainnet.
