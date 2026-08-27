# Lumen — engineering handoff

Everything another agent needs to pick this up cold: what it is, what exists,
how it works, what is deployed, what is left, and the specific traps that cost
hours to find.

Written 2026-08-27. Repo `shariqazeem/lumen-strk20`, branch `main`, 45 commits.

---

## 1. What this is

**Lumen is the private inbox for money on Starknet.** Money arrives from links,
pay pages and other apps; it stays private; and the account keeps those
arrivals from lining up into a public profile of the person.

Positioning line: *"Your payments shouldn't become a map of your life."*

It is deliberately **not** framed as a payments app. The STRK20 sprint has ~10
link-payment projects, 7 payroll projects and StarkWare's own PriPay reference
implementation. Every one of them protects a **single transaction**. Lumen's
claim is that it protects the **person across all of them** — which is what the
2026 "Anonymity Gap" research says actually breaks privacy: provenance and
behaviour across a sequence, never inside one transfer.

Practical consequence for anyone editing this: **payments are plumbing, not the
pitch.** The first screen is what arrived. The second object is what the engine
did. Pay/page/split live in sheets. Do not promote them back to the top.

### Prior art to avoid resembling

The founder previously built StarkPay (payment links for AI agents — won a
bounty), Pulse (QR tipping) and EarnFlow (DeFi savings). The lesson drawn from
those results: **wins came from a novel counterparty, not a novel payment.**
"People paying people, but private" is the losing shape. Keep the account/inbox
framing.

---

## 2. Current state

| | |
|---|---|
| **Live** | https://lumen-strk20.vercel.app |
| **Escrow (mainnet)** | [`0x293c8a95…8cd8`](https://voyager.online/contract/0x293c8a9541d00d0762797a16353f2505aeeaef650bf9f3e8f0a68a98d9b8cd8) |
| **Escrow class hash** | `0x7455f2335fa2fc44096af7f518b7d8f9e12bd0835ff8b735feb1ccf7e4484e6` |
| **Pool (STRK20)** | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| **Deployer account** | `0x046a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101` (~19 STRK) |
| **Tests** | 200 TypeScript (12 files) + 50 Cairo = 250 |
| **Code** | ~13.8k lines source, ~3.6k lines tests |
| **Stack** | Next.js 15.5.19 (App Router), React 19, Tailwind v4, zustand, starknet.js 10.4.0, Cairo/Scarb 2.15, snforge 0.56 |

**Deployed and verified.** The escrow's class at that address matches the
locally built one, and its `pool` storage slot holds the real STRK20 pool.
`get_outstanding(STRK)` returns 0.

**The one gap:** `strk20.json` has `contracts` filled but `transactions` still
empty, and `demo_video` is empty. No real pool transaction has been made yet.
Every flow below is typechecked, unit-tested and built, but **has never
executed against the live pool.** That is the highest-risk remaining work.

---

## 3. Routes

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Marketing landing (static) |
| `/app` | `src/app/app/page.tsx` | The account. Connect screen if no wallet, else Incoming |
| `/claim` | `src/app/claim/page.tsx` | Recipient claims a link. Secret in URL fragment |
| `/pay/[[...slug]]` | `src/app/pay/[[...slug]]/page.tsx` | Someone's pay page. Payload in fragment; path segment is cosmetic |

`/app/page.tsx` is the sheet router: a single `SheetRoute | null` in state, and
every sheet stays mounted through its exit animation. Route kinds:
`pay · receive · add · out · menu · new-person · new-space · space · receipt ·
links · my-page · convert · journal · split · activity`.

---

## 4. Architecture

### 4.1 The store — `src/lib/lumen/store.ts`

One zustand store, the only place wallet + pool + product meet. Everything
chain-touching goes through the user's wallet (`WalletAccountV6`); Lumen never
sees a key or private state.

State: `status · account · address · walletName · balances ·
balancesRevealedAt · registered · prices · poolFee · ledger · people · spaces ·
receipts · links · journal · arrivals · lastTx · submitting · error`

Actions: `connect · disconnect · revealBalances · loadMarket · addPerson ·
removePerson · addSpace · removeSpace · moveIntoSpace · pay · addMoney ·
cashOut · paySplit · sendClaimLink · claimFromLink · refundLink · syncLinks ·
convert · noteDecision · clearError · devPreview`

Every chain action follows the same shape: `requireAccount` → build actions →
`assertNeverUnshields` where relevant → `strk20InvokeTransaction` →
`appendLedger` → set `lastTx` → `watchTx` in the background (90s timeout, then
"unknown" rather than a lie).

### 4.2 Product data — device-local, no server

| Module | Key | Holds |
|---|---|---|
| `history.ts` | `lumen:ledger:v1:<addr>` | The action ledger (bigints as strings) |
| `people.ts` | `lumen:people:v1:<addr>` | Address book |
| `spaces.ts` | `lumen:spaces:v1:<addr>` | Envelope partitions of one balance |
| `receipts.ts` | `lumen:receipts:v1:<addr>` | Per-payment receipts |
| `links.ts` | `lumen:links:v1:<addr>` | Links **you sent** (holds refund secrets) |
| `inbox.ts` | `lumen:inbox:v1` | Links **you received** — **NOT** account-keyed |
| `journal.ts` | `lumen:journal:v1:<addr>` | What the guard decided |
| `arrivals.ts` | `lumen:arrivals:v1:<addr>` + `lumen:balancesnap:v1:<addr>` | Inferred arrivals + balance baseline |
| `paypage.ts` | `lumen:paypage:v1:<addr>` | Your page settings |

**`inbox.ts` is deliberately device-global, not keyed by account.** A claim link
is routinely opened before any wallet exists — that is the entire point of the
flow. Keying it by account would drop exactly the arrivals a new user is about
to claim. Do not "fix" this.

Address keys are normalised through `BigInt(addr).toString(16)` so padded and
unpadded felts share one key.

### 4.3 The guard — `src/lib/lumen/guard.ts`

Pure, deterministic. Returns a `GuardReport { level, checks[], suggestedAmount?,
suggestedWindow? }` where level is `protected | tuned | attention`.

- `reviewPay` — cross-relationship amount reuse in 48h, cadence periodicity
  (coefficient of variation). **Warns only** — the amount is a promise to
  another person.
- `reviewShield` — round/reused amounts on a public deposit. **Rewrites**
  via `nudgeAmount` (≤ ~2% drift, seeded per account per day, always downward).
- `reviewCashOut` — exit↔entry correlation against deposits in window,
  roundness, recent-activity timing; proposes an irregular execution window
  from `recommendWindows`.
- `guardSeed(address, now)` — stable per account per day, so rewrites are
  reproducible and auditable within a day without becoming a fingerprint.

Underneath sit `src/lib/engine/` (seeded splitter, timing scheduler, privacy
scoring) and `src/lib/deanon/` (the attack heuristics). Those are the original
"Aether" engine, now run on the defender's side. 129 of the 200 tests cover them.

### 4.4 STRK20 rails — `src/lib/strk20/`

- `wallet.ts` — connection, capability detection **by advertised Wallet API
  version** (never by probing `strk20Balances`, which triggers a consent
  prompt), `readShieldedBalances`, `formatUnits`/`parseUnits`.
- `actions.ts` — `buildShield`, `buildPrivateTransfer`, `buildExplicitUnshield`,
  `openNoteRef`, `assertNeverUnshields`, `explainWalletError`.
- `escrow.ts` — claim-link rails. Action builders, 248-bit secrets, the
  fragment codec, `readEscrowEntry`, `REFUND_WINDOWS`.
- `pool.ts` — `readPoolFee` from `get_fee_amount`.
- `swap.ts` — AVNU private swaps (`fetchSwapQuote`, `executeAvnuPrivateSwap`).
- `config.ts` — pool address, token list, explorer links, `sameAddress`.

**`assertNeverUnshields` is a hard safety rail.** It refuses any `withdraw`
action whose recipient is not on the passed allowlist. Only two call sites are
allowed to produce a withdrawal: the explicit cash-out flow, and the escrow
fund leg (allowlist `[ESCROW_ADDRESS]`).

### 4.5 Contracts — `contracts/`

Scarb package `lumen_splitter` (name predates the rename; the *contracts* are
`LumenEscrow` and `LumenSplitter`).

**`LumenEscrow`** (`escrow.cairo`) — the claim-link anonymizer, deployed.
`privacy_invoke(operation, claim_commitment, refund_commitment, expiry, token,
amount, secret, note_id)` with `EscrowOperation::{Deposit=0, Claim=1, Refund=2}`.

- Dual domain-separated Poseidon commitments: `LUMEN_ESCROW_CLAIM:V1` and
  `LUMEN_ESCROW_REFUND:V1`. A refund secret is unusable on the claim path.
- Expiry-gated refunds. **A claim stays valid after expiry** until the sender
  actually reclaims — that is what makes short windows safe.
- Per-token solvency accounting (`outstanding`): a deposit the delivered
  balance does not back is rejected, so an unbacked entry cannot exist.
- Pool-gated: `privacy_invoke` asserts `caller == pool` pinned at construction.
- Emits `Deposited` / `Claimed` / `Refunded`.

**`LumenSplitter`** (`splitter.cairo`) — splits one withdrawal into up to 16
non-round open notes atomically. **Built and tested but NOT deployed.** No UI
uses it yet.

**The cross-language vector.** `test_claim_commitment_matches_client_vector` in
`tests_escrow.cairo` and the matching case in `src/lib/strk20/__tests__/escrow.test.ts`
pin the *same* Poseidon output for secret `0x1234`:
`0x308c7c8531f0e0d2789204d5bd59baa4b55308631b86215304789c774ac500d`.
If client and contract ever drift on that hash, links would be minted the
contract cannot find — funds stuck. **Never change one side alone.**

---

## 5. UI / UX

### 5.1 Design system — `src/app/globals.css`

**Strict monochrome. The only colour in the product comes from emoji.**

The rule that governs everything: **black is value, white is chrome.**

| Token | Value | Role |
|---|---|---|
| `--color-canvas` | `#f3f2f0` | the ground |
| `--color-card` | `#ffffff` | raised surfaces |
| `--color-card-soft` | `#faf9f7` | recessed panels |
| `--color-sunk` | `#eae8e4` | chips, tracks, inactive |
| `--color-ink` | `#121214` | text and every emphasis |
| `--color-ink-soft` | `#3c3c41` | secondary text |
| `--color-ink-muted` | `#77767c` | tertiary |
| `--color-ink-faint` | `#b1b0b6` | hints |
| `--color-rule` | `rgba(18,18,20,0.08)` | hairlines |
| `--color-glass` → `--color-glass-raised` | `#0c0c0e` → `#17171a` | the black glass |

`--color-good` and `--color-warn` both resolve to `#121214` — **severity is
carried by black-on-white inversion, not hue.** A guard warning does not turn
amber; it turns black.

Type: Inter (UI), JetBrains Mono (hashes/addresses/labels). Money is always
`font-variant-numeric: tabular-nums` via the `.tabular` class.

Form: 24px card radius, 28px sheets, 52px pill buttons, two-layer shadows,
hairlines at 8% ink.

Key classes: `.card` `.card-press` `.glass` `.btn .btn-ink .btn-quiet
.btn-small` `.sheet` `.rise .rise-1…5` `.reveal .reveal-stagger` `.unblur`
`.pop` `.marquee` `.feed-scroll` `.stroke-text` `.tabular`.

Every animation honours `prefers-reduced-motion`.

### 5.2 Screens

**Connect** (`connect.tsx`) — three situations on one page: a privacy wallet is
present (one-tap connect), only ordinary wallets (explain, point at Ready), or
nothing (three-step path). No demo entry — see §7.

**Incoming** (`home.tsx`) — the first screen, in this order:

1. Header: mark, name, menu.
2. **Waiting for you** — claim links this device holds, unclaimed. **Black
   glass cards** (value), each an `<a>` straight to `/claim#…` reconstructed
   from the inbox entry.
3. **Arrived** — balance growth the local ledger cannot explain. One line each,
   with the disclaimer stated **once** for the group: *"Nobody published who
   sent these — so nobody can read them, including us."*
4. **What Lumen did** — the journal digest (3 figures), taps into the sheet.
5. **The balance** — black glass, consent-gated reveal, Convert/Refresh.
6. **The verbs, weighted** — `Pay someone` full-width primary; `Get paid` and
   `Add money` as quiet utility cards. Deliberately asymmetric.
7. First-run state (when nothing at all exists): a black glass card, *"Add
   money once. After that, nothing you do here is public."*
8. **See what the world sees** — mobile-only invitation (`lg:hidden`).

**Desktop (≥1024px):** two columns. Your view on the left (max 460px), and the
**ObserverPanel permanently on the right**, sticky. The thesis is visible with
zero interaction. On mobile the observer replaces the screen via the toggle.

**Sheets** — one modal surface (`sheet.tsx`), Apple curve
`cubic-bezier(0.32, 0.72, 0, 1)`, deferred unmount so closing never pops,
Escape + backdrop dismiss, `locked` while a wallet prompt is in flight.

| Sheet | What it does |
|---|---|
| `pay-sheet` | person → amount → pay. Also entry to claim link + split |
| `split-sheet` | N recipients, per-person or split-evenly, one operation |
| `add-money-sheet` | deposit, guard rewrites the amount, warns wallet prompts twice |
| `cash-out-sheet` | two-step warned exit, guard runs hardest checks |
| `my-page-sheet` | standing pay page or exact-amount request |
| `receive-sheet` | address QR (dot-matrix, `qrcode-generator`) |
| `journal-sheet` | the full decision log |
| `activity-sheet` | the full ledger (moved off home) |
| `links-sheet` | links you sent: copy, sync status, reclaim |
| `convert-sheet` | AVNU private swap with debounced live quotes |
| `receipt-sheet` | one payment, one fact, copy/share |
| `space-sheets` | create a space; move value in/out (device-local only) |
| `person-sheet` | add a contact |
| `menu-sheet` | account, pool, activity, page, convert, links, cash out |

**`WorldSaw`** (in `bits.tsx`) is the trust moment: every success state ends
with "what the world just saw", stated honestly per action — a private transfer
published nothing; a deposit published an amount and does not pretend otherwise.

### 5.3 Copy rules

No jargon on the surface: no "notes", "nullifiers", "shielding", "pool" in
user-facing text. Never claim to know something the protocol does not publish.
Never render a source label for an arrival — see §6.1.

---

## 6. Hard constraints (read before changing anything)

### 6.1 The Wallet API exposes exactly three STRK20 methods

```
strk20Balances(tokens)            -> aggregate balance per token, right now
strk20PrepareInvoke(actions, sim) -> build and prove
strk20InvokeTransaction(actions)  -> submit
```

**There is no note enumeration, no arrival feed, no transaction history**, and
`strk20Balances` triggers a wallet consent prompt so silent polling is not
possible either.

| Want to show | Knowable? |
|---|---|
| Links you hold but haven't claimed | **yes** — app-local |
| Anything you did in Lumen | **yes** — our ledger |
| Links you minted + their status | **yes** — escrow `get_entry` |
| That the balance grew since last check | **yes** — delta, amount only |
| *Who* paid you | **no** |
| *When* it arrived | **no** |
| *How many* separate arrivals | **no** |
| Which app/rail it came from | **no** |

This is why `arrivals.ts` infers rather than observes, and why the UI says "we
can't see who sent it — and neither can anyone else." **That honesty is the
product.** Any change that renders a confident source label is a regression.

### 6.2 starkli cannot talk to Starknet mainnet

starkli **0.4.2 is its latest release** (July 2025) and still requests the
`pending` block tag. Mainnet moved to `pre_confirmed`; every call fails with
`unknown block tag 'pending'`, which presents as an **indefinite hang**, not an
error. Verified against two independent endpoints. There is nothing to upgrade
to.

**Use `contracts/deploy.mjs` instead** (starknet.js 10.4.0). It decrypts the
starkli keystore (standard Ethereum v3, scrypt + aes-128-ctr) in memory with a
password typed at run time, deploys the account if needed, declares, deploys,
verifies, and writes `.env.local` + `strk20.json`.

### 6.3 RPC endpoints

- **Blast is dead.** Its public Starknet RPC returns *"Blast API is no longer
  available"* on every call — and starkli auto-selects it when no endpoint is
  given. `deploy.mjs` pins an endpoint explicitly for this reason.
- **Working keyless endpoint:** `https://rpc.starknet.lava.build:443` (spec
  0.8.1, returns `0x534e5f4d41494e`).
- For heavy use set `NEXT_PUBLIC_STARKNET_RPC_URL` / `STARKNET_RPC` to your own
  Alchemy key. Declare is a ~135KB payload and public endpoints throttle it.

### 6.4 starknet.js v10 API changes

`Account` takes **a single options object**: `new Account({ provider, address,
signer })`. The pre-v10 positional form is accepted silently — the provider
becomes the options bag, a default provider is constructed, and `address` lands
undefined, surfacing much later as `Cannot read properties of undefined
(reading 'toLowerCase')`.

### 6.5 Pool facts

- **The pool fee is 6 STRK**, not the 4 in the published docs. Always read
  `get_fee_amount`; `FALLBACK_POOL_FEE_STRK` is a first-paint fallback only.
- A shield is **two transactions** (ERC-20 approve, then deposit) — the wallet
  prompts twice. The UI says so, or the second prompt reads as a bug.
- New notes need **~10 blocks** to mature before they are spendable.
- Private transfers are relayer-submitted; the on-chain sender is the relayer
  for every user. Never attribute activity from the transaction sender.
- **Error 118 = NOT_REGISTERED** is not a failure. It means the account has
  never touched the pool; the wallet registers it on the first deposit.
  `revealBalances` treats it as the empty state.
- USDC must be **native Circle** `0x033068f6…35fb`, not bridged USDC.e
  (~19,600 shielded events vs 80 — the bridged venue has no anonymity set).

### 6.6 Cairo

**Cairo has no block comments.** `/* … */` is a syntax error; use `//`. This
broke the escrow test suite once.

### 6.7 Next.js / deploy

`NEXT_PUBLIC_*` values are **inlined into the JS bundle at build time**, not
into the HTML. Grepping page HTML for an env value will always fail — check the
chunks under `/_next/static/`. Changing an env var in Vercel requires a
**redeploy** to take effect.

---

## 7. The dev preview

`/app?dev` fills the account with representative data so the UI can be built
and reviewed without a wallet. It is guarded on `process.env.NODE_ENV !==
'development'` in **both** the store (`devPreview`) and the page, so it cannot
be reached in a production build.

The founder's instruction is that **nothing shipped may be sample data.** A
previous `?preview` mode existed as a product feature and was removed for
exactly this reason. Keep `devPreview` development-only.

It seeds through the real persistence modules (`rememberLink`, `recordDecision`)
so the surface exercises real code paths, and clears the inbox + journal first
so repeated entries do not inflate the numbers.

---

## 8. Running it

```bash
npm install
cp .env.example .env.local     # add NEXT_PUBLIC_STARKNET_RPC_URL
npm run dev                    # then /app?dev to see the surface
```

```bash
npm run typecheck && npm run lint && npm test    # 200 tests
(cd contracts && scarb build && scarb test)      # 50 tests
npm run build
```

Deploy a contract (needs the funded deployer + its keystore password):

```bash
node contracts/deploy.mjs
```

**If the dev server renders unstyled HTML or throws stale module errors, delete
`.next` and restart.** Running `npm run build` while `npm run dev` is live
clobbers the dev server's chunks — that has caused two false alarms already.

---

## 9. What is left

**Blocking the submission, in order:**

1. **Real mainnet transactions.** Add money → mint a claim link (use the 10-min
   window so a reclaim can be filmed) → claim it from a second browser → split
   to two people. Record every hash in `strk20.json`.
2. **First real QA pass.** Incoming, the journal, group send and the WorldSaw
   panels have never rendered against a live wallet. Their first real render
   will find bugs.
3. **Demo video** → `strk20.json.demo_video`.

**Proposed but not started — the founder was asked and has not answered:**

**`DepositMany` on `LumenEscrow`.** Today one `privacy_invoke` carries one
commitment, so paying N wallet-less people is N transactions. A `DepositMany`
operation would make *"pay 10 people who have never touched crypto, in one
private operation, one fee"* true. Nobody on the board can do this — Almoner
does batch disbursement to **addresses**, and every link project mints one link
at a time. It is a contract change plus a redeploy (one command now).

**Known rough edges:**

- `LumenSplitter` is built and tested but unused and undeployed.
- Spaces are device-local only — the copy is honest about this, but a fresh
  reader may mistake them for on-chain state.
- The Scarb package is still named `lumen_splitter`; renaming changes artifact
  filenames referenced in `deploy.mjs`.
- `docs/DOSSIER.md` (self-assessment) and `docs/TRANSFORMATION.md` (strategy)
  predate the last three commits; the README is current.

---

## 10. Working agreements with the founder

- **Do not rebuild.** The stack is enough; the miss has always been positioning
  and proof, not code.
- **Proof outranks features.** An empty `strk20.json` beats any story.
- **Be honest in copy and in reports.** Never overclaim what is private, and
  flag what has not been verified rather than implying it works.
- **Design:** keep the monochrome system, keep it phone-shaped, no dashboards,
  no tables. "Infra-shaped" is a positioning word, never a visual instruction.
- **Never generate or hold a private key** that controls funds, and never sign
  mainnet spends on the founder's behalf. `deploy.mjs` is the pattern: they
  type the password, the key lives only in that process.
