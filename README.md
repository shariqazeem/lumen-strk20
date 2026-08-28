# Lumen

**Your Bitcoin shouldn't become a map of your life.**

Lumen is the private account for Bitcoin on Starknet. Name, amount, Send —
that is the whole interaction. There is no shielding step, no privacy mode and
no toggle, because the reason people do not use private transfers is not that
they dislike privacy: it is that the private path is a *different workflow*
from the normal one, and a second workflow loses every time. So Lumen does not
have one.

Underneath, every send is an [STRK20](https://strk20-by-example.org) private
transfer, and the flagship asset is
[strkBTC](https://www.starknet.io/blog/strkbtc-is-live-private-bitcoin-arrives-on-starknet/) —
the first asset built on STRK20, backed 1:1 by BTC locked on the Bitcoin base
layer.

**Where this fits.** StarkWare spent 2026 completing three sides of a triangle:
STRK20 made privacy native to any Starknet asset, strkBTC made Bitcoin the
first of them, and in August a StarkWare researcher mined
[the first quantum-safe Bitcoin transaction](https://starkware.co/blog/the-first-quantum-safe-bitcoin-transaction-has-been-mined/)
using hash-based rather than curve-based constructions. All three exist at the
infrastructure level. None of them has a consumer surface. Lumen is that
surface — and its claim links are already hash locks, Poseidon preimages with
no elliptic curve in the path (see [What Lumen does not claim](#what-lumen-does-not-claim)).

Money also arrives from more than one place — a claim link, your page, a team
split, another app entirely. Each of those is private on its own. Together they
are exactly how a public profile of you gets built. Lumen is the account they
land in, and the thing that stops them lining up: it holds your
*unlinkability*, across every counterparty and across time.

Built on the live [STRK20](https://strk20-by-example.org) privacy pool,
Starknet **mainnet**. Non-custodial: the user's privacy-enabled wallet holds
every key, discovers every note, and approves every move — Lumen never sees
private state and never asks for a viewing key.

**Live at [lumen-strk20.vercel.app](https://lumen-strk20.vercel.app).**
`LumenEscrow` is deployed on mainnet at
[`0x293c8a95…8cd8`](https://voyager.online/contract/0x293c8a9541d00d0762797a16353f2505aeeaef650bf9f3e8f0a68a98d9b8cd8),
so claim links are live. Nothing in the product is sample data.

## What Lumen does not claim

Lumen is **not a quantum-safe product**, and Starknet is not quantum-ready
today. Three things are true and are the only three claimed:

1. **The claim link is a hash lock.** `LumenEscrow` stores
   `poseidon(LUMEN_ESCROW_CLAIM:V1, secret)` and never the secret or any public
   key, so there is no elliptic curve between minting a link and the money
   moving.
2. **The pool's integrity rests on STARKs**, which have never depended on
   elliptic-curve assumptions.
3. **The account signature is rotatable.** Native account abstraction lets a
   Starknet account change its signature scheme without a protocol change, and
   post-quantum signers already run on mainnet.

What is *not* covered: the account signature that authorises a transaction is
still elliptic-curve, and so is the bridge. Naming that here is deliberate —
the people scoring this sprint wrote the quantum-safe Bitcoin work, and a
privacy product that overclaims is worse than one that underclaims.

## Why this is not the other private-payment projects

The sprint has ten link-payment apps, seven payroll apps, and a reference
payroll implementation from StarkWare itself. **Every one of them protects a
single transaction.** None protects the *person* across all of them — which is
precisely where the 2026 Anonymity Gap work says privacy actually dies:
provenance and behaviour across a sequence, never inside one transfer.

That gap is only closable by something that holds history:

- **Not PriPay / ShadowPay / Private Payroll** — those are a company's book.
  Lumen is the recipient's account.
- **Not VeilPayouts / kelpay / SABLE** — those mint a link and finish. Lumen is
  where the link lands and keeps mattering.
- **Not Preflight / VeilCheck** — those check one signature. Lumen keeps a
  month, and can catch this action correlating with last Tuesday's.
- **Not Pulse or a tip jar** — the unit here is an account with a job, not a
  payment with a nicer screen.

Those projects are not competitors so much as **suppliers**: every one of them
can pay into a Lumen account, and the moment two of them do, only Lumen is in
a position to keep those two arrivals from becoming one profile.

## What the account actually does

1. **Incoming.** The first screen is what arrived, not what you hold. Links
   this device holds but has not claimed, and balance growth its own ledger
   cannot explain — shown as *"we can't see who sent it, and neither can
   anyone else,"* because a private transfer publishes no sender. It never
   renders a source label it cannot defend.
2. **The decision journal.** Before anything is signed the engine checks the
   move against everything already done, rewrites what would leak, and writes
   down what it did: *12 moves made privately · 5 amounts rewritten · 1
   flagged.* Agency with receipts — and the only feature here that structurally
   requires history.
3. **Observer View.** One tap redacts the account to exactly what an explorer
   can ever know, and it appears again after every action as *"what the world
   just saw."*

Payments are the plumbing underneath: claim links for people with no wallet,
a pay page for a bio or an invoice, and group send that pays several people as
one operation nobody can split apart.

---

## The idea

Ordinary money movement should not publish a financial profile.

On a transparent chain, salaries, rent, friends and savings form one connected
graph with your name on it. Cryptographic pools hide individual transactions —
but 2026 research on shielded UTXO systems (the "Anonymity Gap" line of work)
keeps measuring the same result: provenance, value constraints, timing and
habit shrink the *effective* anonymity set by 40–59% on real deployments, and
plenty of transactions collapse to a handful of candidates. The leaks are not
in the cryptography. They are in behaviour — and behaviour is the app layer's
job.

Lumen's answer is to make the private path the only easy path, to make good
behaviour automatic — and to make the network recruit itself:

0. **Links are the product.** A claim link carries a secret in its URL
   fragment (fragments never reach a server); the `LumenEscrow` anonymizer
   holds the value until the recipient's brand-new wallet claims it into an
   open note. A pay page travels the same way — the page *is* the link, no
   backend anywhere. Every link recruits its recipient; every page recruits
   its payers.

1. **Relationship boundaries.** Each person you pay sees only what you send
   them. Nothing connects one relationship to another — and the app enforces
   the *behavioural* half of that promise too, warning when a distinctive
   amount or a rigid cadence would bridge two boundaries.

2. **Private receipts.** A payment can be *proven* without being *published*.
   Every payment mints a receipt carrying exactly one fact — this amount, this
   moment, this settlement transaction — that the payer can hand to exactly
   one counterparty. The settlement is publicly verifiable yet names no
   sender, recipient or amount.

3. **The silent engine.** For every action, Lumen answers internally: does
   this create a public record? does the amount re-link me (round, reused,
   mirroring a deposit)? does the timing stitch two events together? Where the
   action is Lumen's own (a deposit, a cash-out) the engine *rewrites* it — a
   tuned non-round amount, a suggested waiting window. Where the amount is a
   contract with another person, it warns instead. The user never sees a
   score. They just stay private.

## What the user sees

- **Incoming** — the first screen: links waiting for you, and arrivals this
  device cannot attribute. The balance is an object further down, not the
  brand.
- **What Lumen did** — the decision journal, second on the screen and in its
  own sheet.
- **Pay with a link** — for someone with no wallet: the guard tunes the
  public escrow amount, the link carries the claim secret, `/claim` walks the
  recipient from "what is this" to a private balance. Unclaimed after the
  window? Take it back.
- **Get paid** — a standing pay page (`/pay/you`, presets priced live) or a
  one-off request that locks an exact amount. Payments to either are private
  transfers.
- **Pay several people** — one operation, one pool fee, and no recipient can
  see what any other received.
- **Convert** — AVNU private swaps: value changes token inside the pool;
  observers see an executor talk to an AMM, never you.
- **Spaces** — Rent, Travel, Rainy day: a private partition of the one
  shielded balance, kept on-device. Moving between spaces is instant and free
  because nothing touches the chain — a boundary the chain could see would
  itself leak.
- **People** — the address book of relationship identities.
- **Activity** — every entry tells the truth twice: what you did, and what
  the public chain saw (almost always: *nothing*).
- **Cash out** — deliberately one level deeper in the menu, warned, and
  guard-checked: the exit is where private money historically gets traced.

No seed phrases, no "notes", no "nullifiers", no jargon anywhere on the
surface.

## Honest privacy model

| Never public                              | Public, by nature                        |
| ----------------------------------------- | ---------------------------------------- |
| Who you pay, and how much                 | Adding money (an ERC-20 deposit)         |
| Your balance and everything in it         | Cashing out (a withdrawal)               |
| Spaces, people, notes-to-self, history    | That the pool processed *something*      |
| Receiving money                           |                                          |

Both boundary crossings run through the guard first, so what is public cannot
be matched against what is not. Private transfers are submitted by a relayer;
the transaction sender on-chain is the relayer for all users.

Product data (people, spaces, receipts, the action ledger) lives in
`localStorage` on the user's device, keyed per account. There is no server and
no analytics.

## The guard, concretely

`src/lib/lumen/guard.ts` — pure, deterministic, unit-tested underneath by the
engine it draws from:

- **Pay** (`reviewPay`): route privacy (a private transfer has no public
  leg), cross-relationship amount reuse inside a 48 h window, cadence
  detection (coefficient of variation over inter-payment gaps).
- **Add money** (`reviewShield`): deposits are public forever, so round or
  recently-used amounts are *rewritten* into pool-typical, non-round, fresh
  ones (`nudgeAmount`, ≤ ~2 % drift, deterministic per account per day, with a
  one-tap "keep exact" escape hatch).
- **Cash out** (`reviewCashOut`): exit↔entry amount correlation against every
  deposit in the window (the classic mixer heuristic), roundness, and timing —
  if the user was active minutes ago, the engine proposes an irregular
  execution window drawn from a de-periodised exponential schedule.

The engine underneath (`src/lib/engine/`, `src/lib/deanon/`) is a seeded,
reproducible implementation of the attacks themselves — amount correlation,
round-number salience, timing windows, cadence periodicity, anonymity-set
thinning, exit matching. Same inputs, same review, always: a decision the user
can audit.

## STRK20 integration

Everything chain-touching goes through the user's wallet via the Wallet API
(`WalletAccountV6`, API ≥ 0.10.3):

- `strk20InvokeTransaction` with `deposit` / `transfer` / `withdraw` action
  lists (`src/lib/strk20/actions.ts`)
- `strk20Balances` for shielded balances — called only as an explicit,
  consent-prompting "reveal", never to feature-detect
- Capability detection by advertised Wallet API version
- Live pool fee from `get_fee_amount` (mainnet returns 6 STRK today, not the
  documented 4 — read, never hardcoded)
- Pool: [`0x040337…812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a)
  on mainnet; note maturity (~10 blocks) surfaced in the add-money flow
- `assertNeverUnshields` guards every action list Lumen builds: a `withdraw`
  to anything but a same-transaction helper is refused mechanically. The only
  code path that can produce a public withdrawal is the explicit cash-out
  flow.
- **`LumenEscrow`** (`contracts/src/escrow.cairo`) — the claim-link
  anonymizer: `privacy_invoke` with Deposit / Claim / Refund, dual
  domain-separated poseidon commitments (a refund secret is unusable on the
  claim path), expiry-gated refunds, per-token solvency accounting (an
  unbacked entry cannot exist), events. The commitment math is pinned by the
  *same* test vector in both the snforge suite and vitest — client and
  contract can never drift on the hash that carries the money.
- **`LumenSplitter`** (`contracts/src/splitter.cairo`) — `privacy_invoke`
  splitting one withdrawal into up to 16 non-round open notes atomically.
- **AVNU private swaps** live in the product (Convert): the wallet proves,
  AVNU's relayer submits, the output lands in a fresh note.
- Claim links stay hidden in the UI until `NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS`
  points at a deployed instance — `contracts/deploy.sh` prints the exact
  declare/deploy walkthrough for both helpers.

## Run it

```bash
npm install
cp .env.example .env.local   # add a Starknet mainnet RPC URL (Alchemy free tier works)
npm run dev
```

Open `http://localhost:3000`. The app needs a privacy-enabled Starknet wallet
(e.g. [Ready](https://www.ready.co/)) on mainnet.

```bash
npm run typecheck && npm run lint && npm test   # 172 tests: engine, rails, codecs
(cd contracts && scarb test)               # 50 tests: both anonymizers
npm run build
```

## Repository map

```
src/
  app/                  landing (/), the app (/app), claim pages (/claim),
                        pay pages (/pay/[name])
  components/lumen/     the product surface — home, sheets, guard panel,
                        receipt, links, pay page owner sheet, convert
  lib/lumen/            store, guard, people, spaces, receipts, links, paypage
  lib/strk20/           wallet, action builders, escrow rails, pool reads,
                        AVNU swaps
  lib/engine/           seeded splitter, timing scheduler, privacy scoring
  lib/deanon/           the attack heuristics the guard runs in reverse
contracts/              LumenEscrow + LumenSplitter (Cairo anonymizers),
                        50-test snforge suite, deploy walkthrough
docs/                   the pivot brief and attack model
```

## License

MIT — see [LICENSE](LICENSE).
