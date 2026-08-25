# Lumen

**Private money, by default.**

Lumen is a consumer money app for Starknet. Pay people, get paid, and set
money aside — without any of it becoming a public financial profile. Balances,
recipients, amounts and history never appear on-chain; every relationship gets
its own privacy boundary; and a silent engine checks each move against the
statistical attacks that actually undo private money.

Built on the live [STRK20](https://strk20-by-example.org) privacy pool,
Starknet **mainnet**. Non-custodial: the user's privacy-enabled wallet holds
every key, discovers every note, and approves every move — Lumen never sees
private state and never asks for a viewing key.

**Live at [lumen-strk20.vercel.app](https://lumen-strk20.vercel.app).**
No wallet installed? Open [`/app?preview`](https://lumen-strk20.vercel.app/app?preview)
for a sample-data walkthrough — clearly labeled, and chain actions stay
disabled until a real wallet connects.

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

Lumen's answer is to make the private path the only easy path, and to make
good behaviour automatic:

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

- **Home** — one dark-glass card holding the private balance (revealed only
  through an explicit wallet consent), three verbs: **Pay · Receive · Add**.
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
- AVNU private-swap rails (`src/lib/strk20/swap.ts`) and the
  `LumenSplitter` Cairo helper (`contracts/`, `privacy_invoke` splitting one
  withdrawal into up to 16 open notes atomically) are wired for the next
  step: in-pool conversion and one-transaction note compaction.

## Run it

```bash
npm install
cp .env.example .env.local   # add a Starknet mainnet RPC URL (Alchemy free tier works)
npm run dev
```

Open `http://localhost:3000`. The app needs a privacy-enabled Starknet wallet
(e.g. [Ready](https://www.ready.co/)) on mainnet; `/app?preview` walks the
full product with labeled sample data and no wallet.

```bash
npm run typecheck && npm run lint && npm test   # 158 tests, engine + rails
npm run build
```

## Repository map

```
src/
  app/                  landing (/) and the money app (/app)
  components/lumen/     the product surface — home, sheets, guard panel, receipt
  lib/lumen/            store, guard, people, spaces, receipts
  lib/strk20/           wallet, action builders, pool reads, AVNU swaps
  lib/engine/           seeded splitter, timing scheduler, privacy scoring
  lib/deanon/           the attack heuristics the guard runs in reverse
contracts/              LumenSplitter (Cairo) — multi-note splits via privacy_invoke
docs/                   the pivot brief and attack model
```

## License

MIT — see [LICENSE](LICENSE).
