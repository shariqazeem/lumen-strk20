# Lumen — the transformation

**Decision, backed by the real registry (154 registered, 93 public pitches).**

---

## 1. The position

> **Lumen is the private inbox for money.**

Money arrives by link or page. It stays private. The account stops your
arrivals from becoming one profile. You can pay, split, and prove one fact.

"Destination layer" is the README sentence for judges. The inbox is the human
one, and it is the one that goes on the landing page.

Not a wallet. Not a payout rail.

### Why this one

Every project on that board protects **one transaction**. One link. One payroll
run. One subscription. One tip. Nobody protects the **person across all of
them** — which is exactly where the Anonymity Gap research says privacy actually
dies: over sequences and across counterparties, never in a single transfer.

Three properties nothing else on the board has together:

1. **Honest by construction.** A private transfer publishes no sender, so
   Lumen genuinely cannot see who paid you — and says so on the row. That is
   the thesis rendered as UI, and a database-backed competitor cannot fake it.
2. **Competitors become suppliers — eventually.** VeilPayouts, Almoner and
   Aegis all *could* feed this. That is the Series A sentence, **not** a demo
   claim and **not** landing-page copy. This week we prove two Lumen rails.
3. **The stack is load-bearing.** A silent engine is useless to a one-shot tool
   and essential to an account that persists. Preflight and VeilCheck own
   one-shot leak checks — we did not invent leak detection. Our edge is
   **history**: this action against last Tuesday's, which only an account holds.

### What the market actually looks like

| Lane | Occupied by |
|---|---|
| Claim links | 10 projects — VeilPayouts, Redpocket, SABLE, kelpay, Almoner |
| Private payroll | 7 — including StarkWare's own PriPay |
| Group / batch pay | **Almoner** — walletless, many recipients, one flat fee |
| Recurring / subscriptions | Aegis, NIGHTSHIFT, Keepr |
| Pre-sign leak detection | **Preflight, VeilCheck** |
| "Is it really private" | **Crosslink** |
| Income proofs | Velum, Booty Bank |
| Generic private account | **"Private money account"** — our old one-liner, verbatim |

Do not fight any of these head-on. Sit above all of them.

---

## 2. The loop that makes it alive

```
Money arrives                      ← your page, a claim link, a split
        ↓
Lands private and STAYS private    ← never re-exposed on the way in
        ↓
The engine keeps your actions uncorrelated  ← only an account holds this
        ↓
You pay / split / prove            ← every action leaves nothing public
        ↓
Decision log shows what it did     ← agency with receipts
```

**Incoming is the heartbeat.** If nothing is arriving, the product is dead —
same as Sage with zero missions. Everything else is machinery.

---

## 3. The constraint that shapes everything

Verified against `starknet@10.4.0`. The Wallet API exposes **exactly three**
STRK20 methods:

```
strk20Balances(tokens)            -> aggregate balance per token, right now
strk20PrepareInvoke(actions, sim) -> build and prove
strk20InvokeTransaction(actions)  -> submit
```

There is **no note enumeration, no arrival feed, no transaction history**, and
`strk20Balances` triggers a wallet consent prompt, so silent polling is not
available either. What follows from that:

| Want to show | Knowable? | Why |
|---|---|---|
| Links you hold but haven't claimed | **Yes** | you hold the secret; app-local |
| Claims / sends / splits done in Lumen | **Yes** | our own ledger |
| Links you minted, and their on-chain status | **Yes** | our escrow's `get_entry` |
| That your balance grew since last check | **Yes** | balance delta, amount only |
| *Who* paid you | **No** | a private transfer publishes no sender |
| *When* it arrived | **No** | no event we can read |
| *How many* separate arrivals | **No** | two between checks look like one |
| Which app or rail it came from | **No** | notes carry no provenance |

Two arrivals plus a spend between checks can even net to zero. Say "since you
last looked", never "at 4:12pm".

**This is not a limitation to hide. It is the proof.** The engine's history
claim also tightens honestly: it keeps *what you do* from correlating with
*what you received* — true for everything transacted through Lumen, and
defensible under questioning.

---

## 4. The three surfaces

Replace the current Home. One column, phone-shaped, same theme.

### Incoming — the first screen

**Verified constraint (read section 3 before building this).** Lumen cannot
see who paid you, when, or through which app. Incoming therefore shows exactly
two things, both defensible:

**1. Links waiting for you.** Claim links you have opened but not yet claimed.
Lumen genuinely knows these — you hold the secret — so they carry full detail:
amount, sender's chosen name, note, expiry. This is the actionable half of an
inbox and the reason to come back.

**2. Arrivals since you last looked.** A balance increase Lumen cannot explain
from its own ledger. Amount only, stated exactly as what it is:

> **+52.88 USDC arrived**
> *We can't see who sent it — and neither can anyone else.*

That row is stronger than a source-labelled feed: it demonstrates the product
instead of describing it, and a database-backed competitor cannot fake it.

**Never render a source label we cannot defend.** `Your page` and `Direct` are
not knowable. The only honest labels are ones Lumen transacted itself:
`Claim link` (you claimed it here) and `Split` (received through our escrow).

Empty state is not a dead wallet. It is an invitation:
*"Nothing yet. Share your page and get paid privately."* + the page link.

The black-glass balance card **stays but demotes**: it is an object inside
Incoming, not the brand. Tap to reveal, as today.

### Send — one person or many

- **One person** → claim link (WhatsApp / Telegram / X), or direct if they are
  already on Lumen.
- **Several people** → one private split. Public sees one distribution; each
  person sees only their own amount. Keep this as a *supporting* feature, not
  the headline — Almoner owns the batch-disbursement pitch. We win on it being
  one tap inside an account people already hold.

### Your page — the cashtag

`lumen…/pay/you`. Presets, one-off invoices. This is the distribution surface:
the thing that goes in a bio, and the thing Starknet can promote on a stage.

---

## 5. The one new build: the decision log

This is the Sage property. Ship it.

A quiet, running record of what the engine did **while you were not looking**:

```
This month
  12 arrivals received privately
   5 amounts rewritten before signing
   2 spends held for a quieter window
   1 refused — it would have mirrored your deposit
```

Every line is tappable and explains itself in one human sentence. It is already
computable from the ledger plus the guard — the reports exist, they are simply
thrown away after each sheet closes. **Persist them.**

Why it wins: it is the only feature on the board that requires *history*. A
single-purpose tool structurally cannot produce it.

---

## 6. What gets demoted

Not deleted — moved into the menu or settings. They are machinery, not thesis.

- Spaces as a headline
- People / address book as a headline
- Convert as a headline
- "Add money" as the first verb
- Any exposure score or dashboard

Cash out and Convert stay in the menu. They are exits. Exits are where privacy
dies; never lead with them.

---

## 7. UI rules — it is a phone, not a dashboard

Keep the porcelain / black-glass / Inter + JetBrains Mono system exactly.

- **One column, always.** Bottom sheet for every money action. 52px pills.
- **No tables, no dashboards.** A table reads as PriPay / Paybook. Rows, chips
  and sheets read as an app.
- **Black glass only for the private balance.** One dark object per screen.
- **Alive, not decorative.** Movement comes from real state — arrivals landing,
  the decision log incrementing — never a fake activity feed, and never a public
  feed of who paid whom.
- **Observer View is the trust moment, not a page.** Offer it right after an
  action completes: *"Here's what the world just saw →"*.
- **First open with no wallet** shows Incoming's empty state and the page
  builder. The wallet appears when they claim or send — not before.
- **The claim page is the growth surface.** It must work on a phone inside
  Telegram. Big amount, one button, and copy that never says note, nullifier or
  pool.
- **"Infra-shaped" is a positioning word, never a visual instruction.** If
  Incoming becomes a feed of dense rows and the decision log becomes a stats
  panel, it reads as a dashboard and we lose the thing we are good at. Rows are
  chunky and few. The log is four sentences, not a chart. No tables anywhere.

### Copy that carries the position

- Landing: **"Money arrives. Nothing about you does."**
- Incoming empty: *"Nothing yet. Share your page and get paid privately."*
- After a claim: *"This is yours, privately. Here's what the world saw →"*
- Decision log header: *"What Lumen did for you this month."*

---

## 8. The 72 hours, in order

Non-negotiable order. Proof outranks features.

1. **Deploy LumenEscrow to mainnet.** Today. If calldata, the withdraw-to-helper
   leg or note maturity breaks, that pain is wanted now, not on demo day.
2. **Three or more real pool transactions.** Record every hash in
   `strk20.json`. This single line outranks everything else in this document.
3. **Pay real humans.** 5–10 claim links of your own money to friends, Telegram,
   other sprint builders. Some claim. Let at least one expire and refund.
   Screenshot Observer View afterwards.
4. **Rebuild Home into Incoming.** Ship the decision log alongside it.
5. **Rewrite the landing** around arrival, not the wallet.
6. **Demo video, 45–60 seconds, no architecture lecture:**
   pay page → stranger claims on a phone with no wallet → they pay someone else
   → group split → flip Observer View: one deposit, everything else invisible.

---

## 9. How we lose / how we win

**Lose if:** `strk20.json` stays empty · the landing still says wallet · the
cross-source claim is never shown · we look like VeilPayouts with better type.

**Win if:** the escrow is live on mainnet with real hashes · a person with no
wallet claims on their phone and stays private · money arrives from two or more
different rails and the engine shows they never correlated · the decision log
proves the product acted while nobody watched.

---

## 10. The honest line

The thesis was always right: cryptography holds, behaviour betrays, and the app
must make the private path the only easy path.

What was wrong was the **center of gravity** — an account you open to look at
money, rather than the place money arrives and stays private forever after.

Keep every contract. Keep the engine. Keep Observer View, receipts, escrow,
splitter, the no-server secrets, the design system. Change the first screen, add
the decision log, and put your own money through the loop the way you did with
Sage.

*Then it will have done something, not just looked like it could.*
