# Lumen — engineering handoff

Everything another agent needs to pick this up cold: what it is, what exists,
how it works, what is deployed, what is left, and the specific traps that cost
hours to find.

Written 2026-08-27, revised the same day after the landing film, the brand and
the wallet-connect fix landed. Repo `shariqazeem/lumen-strk20`, branch `main`,
53 commits.

---

> **Read [WHAT-MAINNET-TAUGHT-US.md](WHAT-MAINNET-TAUGHT-US.md) first if you
> are picking this up after 28 Aug 2026.** Four constraints surfaced during the
> first real mainnet session that no amount of reading the docs would have
> found — an irreducible wallet-side registration step, a flat 6 STRK pool fee,
> what the wallet already does on its own, and the one thing still untested
> that the whole pitch rests on. It narrows several claims made below.

## 0. What changed since the first version of this document

Eight commits. If you read the earlier revision, these are the parts that are
now different rather than merely expanded:

| | |
|---|---|
| **The landing page** | No longer sections and cards. The top is a scroll-scrubbed canvas film — §5.5. Do not add a video asset; there is a reason it is drawn |
| **The account** | Now a three-pane shell — sidebar, top pill, sticky observer rail — §5.2. The hamburger is gone on desktop |
| **Emoji** | Removed from the product entirely. Monograms for people, an icon set for spaces — §5.4 |
| **Links** | A compact binary codec, and a deliberate presentation that makes the fragment the argument — §4.3, §5.3 |
| **The mark** | Redrawn as an aperture; icons, tile and social card all generate from one geometry — §5.6 |
| **Connect** | A real bug is fixed: `WalletAccountV6.connect` was handing back addressless accounts — §6.2 |
| **Tests** | 200 → 237 |

**A later revision than the above** turned the product from *"the private inbox
for money"* into *"private payments that feel like normal payments"*. Send is
now the first thing on the account screen and it is a composer, not a button —
§1 and §5.3b. This **reverses** the earlier instruction that arrivals come
first and payments are plumbing. That framing was right about what makes Lumen
different and wrong about what makes it used. If you find a stray sentence
still calling Lumen an inbox, it is stale; the composer is the product.

---

## 1. What this is

**Lumen is private payments that feel like normal payments.** Name, amount,
Send. The rail underneath happens to be STRK20; the user never learns that,
and never decides it.

Positioning line: *"Send money. Lumen handles the privacy."*
The landing film still opens on the problem — *"your payments shouldn't become
a map of your life"* — because the diagnosis is what earns the product.

**The problem is not that people need better privacy.** STRK20 already hides
the transfer. The problem is that people do not choose private transactions
when the private path is a *different workflow* from the normal path. PSE's
2026 research found 86% of surveyed Ethereum users had abandoned a privacy
flow at least once, with privacy importance rated high and satisfaction low;
their interview study named the blockers as wallet support, key management,
fragmented balances and the difficulty of spending privately at all. Earlier
usability work found only a quarter of participants could complete a real
private purchase. The gap is human, not cryptographic.

So the product does not teach privacy. **It removes the decision to choose
it.**

Practical consequence for anyone editing this: **Send is the product.** It is
the first thing on the screen and it is a composer, not a button that opens
one. Everything else — claim links, pay pages, split, convert, spaces — is
support. Do not add a privacy mode, a shield step, a toggle, or a button
reading PRIVATE in capitals; each of those teaches that privacy is a special
occasion, which is the exact failure being fixed.

**The differentiator, stated carefully.** "Easiest private payment on Starknet"
is the most occupied sentence on the sprint board — claim links, Whisper Pay,
VeilPayouts, SABLE. Four things keep Lumen from filing next to them, and all
four are structural rather than cosmetic:

1. **Send is the product**, not one verb in a wallet.
2. **The engine stays under the floor** — it rewrites a deposit amount or
   holds a cash-out without asking (§4.4). The user did not open a privacy
   app; they paid someone.
3. **Observer comes after, never before** — it is proof the easy path was
   genuinely private, not a pitch for privacy.
4. **Claim links are the loop**, not the pitch — a stranger receives $50
   without knowing what STRK20 is, and is now inside the network.

### Prior art to avoid resembling

The founder previously built StarkPay (payment links for AI agents — won a
bounty), Pulse (QR tipping) and EarnFlow (DeFi savings). Those products all
shipped a *set of verbs*. The correction here is not a different counterparty,
it is **one interaction done absurdly well**, with everything else demoted
below it. If you find yourself adding a sixth verb to the sidebar, that is the
old failure returning.

Specifically ruled out for this sprint, after being considered: a merchant
SDK / "Accept Lumen" button, a private intent network, private conditional
orders, and a privacy OS. The first is scope; the rest are lanes STRK20 has
already named, where execution risk beats a working mainnet product.

---

## 2. Current state

| | |
|---|---|
| **Live** | https://lumen-strk20.vercel.app |
| **Escrow (mainnet)** | [`0x293c8a95…8cd8`](https://voyager.online/contract/0x293c8a9541d00d0762797a16353f2505aeeaef650bf9f3e8f0a68a98d9b8cd8) |
| **Escrow class hash** | `0x7455f2335fa2fc44096af7f518b7d8f9e12bd0835ff8b735feb1ccf7e4484e6` |
| **Pool (STRK20)** | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| **Deployer account** | `0x046a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101` (~19 STRK) |
| **Tests** | 237 TypeScript (16 files) + 50 Cairo = 287 |
| **Code** | ~15.9k lines source, ~3.1k lines tests |
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
| `/` | `src/app/page.tsx` | The landing. A scroll-scrubbed film, then the chapters — §5.5 |
| `/app` | `src/app/app/page.tsx` | The account. Connect screen if no wallet, else the shell around Incoming |
| `/claim` | `src/app/claim/page.tsx` | Recipient claims a link. Secret in URL fragment |
| `/pay/[[...slug]]` | `src/app/pay/[[...slug]]/page.tsx` | Someone's pay page. Payload in fragment; path segment is cosmetic |

`/app/page.tsx` is the sheet router and the only place `AppShell` is mounted: a
single `SheetRoute | null` in state, and every sheet stays mounted through its
exit animation. Route kinds:
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

### 4.3 Link encoding — `src/lib/lumen/codec.ts`

Links are the product's whole distribution, so the fragment's length is its
shareability. JSON-in-base64 paid three times over — key names, quoting, and a
66-character hex address — and a pay page came out near 190 characters of
noise. The compact codec packs the same payload as bytes:

- address and claim secret as **raw bytes**, not hex text; the address is
  variable-width because every Starknet address has a zero top byte
- token as a **one-byte index** into `TOKEN_LIST`, not an address
- amounts length-prefixed, so an 18-decimal balance does not force every link
  to carry 32 bytes
- each absent optional field costs **one flag bit**, not a key and two quotes

Measured against a real mainnet address: a pay-page fragment is **56
characters** where the JSON form was 148, and a claim fragment is **62** where
it was 240. Full URLs land near 100 characters — Stripe-link territory, and
about as short as a self-contained serverless link can be, since the address
alone is 32 bytes. `Reader.felt` returns the canonical zero-padded form —
dropping leading zeros gives the same felt but a different string, which breaks
round-trips and surprises anything comparing addresses as text.

**Both callers keep a legacy JSON decoder** (`paypage.ts`, `strk20/escrow.ts`)
so links minted before the codec still open. Never remove those without a
deprecation window; a dead link is money someone cannot reach.

`inbox.ts` **parses the claim secret as a felt at the boundary**. Under JSON a
corrupt secret was inert text; under the codec it throws while re-encoding the
link, so it has to die on the way in.

### 4.4 The guard — `src/lib/lumen/guard.ts`

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

### 4.5 STRK20 rails — `src/lib/strk20/`

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

### 4.6 Contracts — `contracts/`

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

**Strict monochrome. There is no colour in the product at all.**

Emoji used to be the one exception — avatars and space icons carried it. They
are gone (§5.4). Nothing renders a hue now; the palette below is the whole
system.

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
`.pop` `.marquee` `.feed-scroll` `.stroke-text` `.tabular` `.chapter`
`.float-hint` `.film-aware`.

Every animation honours `prefers-reduced-motion`.

**`body` uses `overflow-x: clip`, never `hidden`.** `hidden` turns the body
into a scroll container, which breaks every `position: sticky` on the page and
moves the scroll offset off `window`. That silently killed the landing film
once; do not change it back.

### 5.2 The app shell — `src/components/lumen/shell.tsx`

The account is a **dashboard that does not look like one**. Three panes on a
wide screen:

- **Sidebar**, fixed 236px, hairlines and type rather than a slab of chrome.
  It replaces every hamburger — there is no menu button on desktop. Items:
  **Send** (the account screen), Send a link, Get paid, Add money, What Lumen
  did, Links you sent, Activity; Cash out sits alone at the bottom, away from
  everything else, above the account chip. Send leads because Send is the
  product. There is no badge on it — a count of money *waiting to be claimed*,
  sitting on an item called Send, reads as "two sends pending".
- **Top pill**, centred: *Your view* / *What the world sees*. The thesis is one
  tap, always.
- **Content** capped at 560px with a sticky 320px **observer rail** on the
  right, so what the world sees needs no interaction at all.

On a phone the sidebar becomes a bottom bar using each item's `short` label,
and the observer rail becomes the pill's second state.

### 5.3 Screens

**Landing** (`src/app/page.tsx`) — see §5.5, it is a film now.

**Connect** (`connect.tsx`) — two columns, not a wizard. Left: the wordmark, the
headline *"The account that keeps your arrivals from lining up."*, the wallet
buttons (or an install prompt pointing at Ready when no privacy wallet is
present), and the non-custodial line. Right: the observer's empty view, with
the film's closing frame above it (`FilmStill`) so the walk from landing to
wallet reads as one piece rather than two products. Ordinary non-privacy
wallets are listed by name below, described honestly as having no private
balances yet. No demo entry — see §7.

**The account** (`home.tsx`) — one screen, in this order:

1. **The composer** (`send.tsx`) — see §5.3b. This is the product.
2. **The balance** — black glass, consent-gated reveal, Convert/Refresh. It
   sits directly under the composer because it is what the composer spends.
3. **Waiting for you** — claim links this device holds, unclaimed. **Black
   glass cards** (value), each an `<a>` straight to `/claim#…` reconstructed
   from the inbox entry.
4. **Arrived** — balance growth the local ledger cannot explain. One line each,
   with the disclaimer stated **once** for the group: *"Nobody published who
   sent these — so nobody can read them, including us."*
5. **What Lumen did** — the journal digest (3 figures), taps into the sheet.
6. **Get paid / Add money** — equal utility weight. They are not the product.
7. First-run state (when nothing at all exists): a black glass card, *"Add
   money once. After that, nothing you do here is public."*

### 5.3b The composer — `src/components/lumen/send.tsx`

Two fields and a button. **Nothing before Send may mention privacy as a
choice.**

- **Two steps on purpose.** Before a recipient is chosen there is no Send
  button at all — a full-width disabled slab sitting on an empty screen is
  worse than no button. Choosing a person reveals the amount and Send
  together, and moves focus to the amount.
- **The guard runs, invisibly.** `reviewPay` is called on submit and its
  verdict goes to `noteDecision` — the journal — not to a panel. Do not
  reintroduce a pre-flight approval step; that is the second workflow this
  whole design exists to delete.
- **One explanation, once.** *"Private by default. Nothing about this becomes
  public."* Not a badge, not a mode, not a capitalised button.
- **Observer is offered after**, from the success state, beside the receipt.
- The sheet at `pay-sheet.tsx` no longer lists contacts. It exists for the two
  things the composer cannot do — a claim link and a split — and is reached
  from the sidebar's **Send a link**. Two ways to pay the same person would be
  exactly the confusion this change removes.

`home.tsx` also exports **`ObserverPanel`**, which the shell mounts in the rail.

**Pay page** (`/pay/[[...slug]]`) — the surface a payer sees, and the one most
likely to be someone's first contact with Lumen, so it carries the argument
rather than just a form. On a phone: monogram, *Pay {name}*, a *Private
payment* pill, optional preset chips, the amount field, then **what this
payment leaves behind** — your name never asked for, your address not
published, the amount not published, their other payers invisible to you, your
other payments invisible to them. On a wide screen that list moves to a second
column beside the card, because a lone 440px card on a desktop reads as a phone
screenshot. Wallet-less visitors get an install prompt, not a dead end.

**Claim page** (`/claim`) — the secret lives in the fragment. Its invalid state
is deliberately designed: *"This pay page didn't load — the page travels after
the # in the link, and some apps cut it off. Ask for the link again."* Chat
apps really do truncate fragments; a blank screen there would look like theft.

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
| `menu-sheet` | mobile only — the sidebar covers this on desktop |

**`WorldSaw`** (in `bits.tsx`) is the trust moment: every success state ends
with "what the world just saw", stated honestly per action — a private transfer
published nothing; a deposit published an amount and does not pretend otherwise.

**`ShareLink`** (`share-link.tsx`) is how every link is handed over — the claim
link and both pay-page flavours. A raw URL in monospace was the ugliest thing
in the product *and* a wasted argument, because everything after the `#` is why
these links work without an account: browsers never put a fragment in a
request. So the split is drawn deliberately — readable half in ink, private
half **named** ("the claim secret — this is the money") rather than dumped,
with a tap to inspect the real string, and a line stating that the fragment
never reaches any server. `onHandOff` fires on copy/share, which is when a pay
page stops being a draft and gets saved.

### 5.4 Avatars and icons — no emoji anywhere

Emoji are **gone from the product**, deliberately and completely. An avatar
picker asked people to make a decision nobody wants to make in order to get
paid, and the result made a payments product read like a chat app.

- **People** wear **monograms** — `initials()` in `people.ts`. `Shariq Shaukat`
  → `SS`, `amara` → `a`, `ines_roy` → `ir`. It splits on space, dot, underscore
  and hyphen, handles non-Latin scripts, and returns `•` for an address, which
  would otherwise monogram as a stray `0`. Six tests pin this.
- **Spaces** wear icons from our own set: `SPACE_ICONS = goal · home · travel ·
  rainy · work · gift`, keyed **by meaning, not by glyph**, so the drawing can
  change without rewriting anyone's saved spaces. `SpaceGlyph` in `icons.tsx`
  maps key → component.
- **Pay pages no longer carry an avatar at all**, which shortened their links
  again. Links minted while they did still decode — `CompactPage.emoji` is read
  and discarded, because those bytes have to be stepped over either way.

If you are adding a surface, do not reach for an emoji. Add an icon to
`icons.tsx` in the house style: 24×24 viewBox, `currentColor`, `strokeWidth`
1.7–1.8, round caps.

### 5.5 The landing film — `src/components/landing/`

The top of the landing page is **one continuous shot, scrubbed by the scroll**,
not a stack of sections. The thesis is a claim about *accumulation* — that a
sequence of private payments becomes a public portrait — and cards are
structurally incapable of showing accumulation, because a card is a thing that
has already finished happening.

**The script.** A life's payments arrive one at a time, unordered. Lines get
drawn between them. The clusters resolve into sentences a stranger can write
about you — *pays rent on the 1st · same employer since March · refills a
prescription monthly · was in another city on the 14th*. The sentences are
struck through. The frame **cuts** to black. What comes back is the same
account with nothing left to read, and the CTA.

**It is drawn, not filmed.** A generative canvas is a few kB where a video is
megabytes, it is sharp at every density, it scrubs exactly instead of
buffering, and it holds the real palette. The whole sequence made the page
*smaller* than the markup it replaced. **There is no video asset and there
should not be one.**

| File | Role |
|---|---|
| `film-engine.ts` | Pure drawing. No React. `buildGraph`, `paint`, `paintAmbient`, `groundDarkness`, `ACT`, `CLUSTERS` |
| `film.tsx` | The projector: `ScrollFilm`, `FilmStill`, `FilmBackdrop` |
| `__tests__/film-engine.test.ts` | 14 tests pinning the act structure |

**Things that will bite you:**

- **The acts are timing, not layout.** `ACT` maps progress `0..1` to
  `arrive · wire · name · strike · cut · erase · calm`. Beat copy in
  `FILM_BEATS` (in `page.tsx`) is keyed to the same numbers. Move one and move
  the other, or the copy lands over the wrong image.
- **The cut is a cut.** A crossfade from paper to ink spends its middle on
  grey, and grey was the worst frame in the film. `ACT.cut` is two frames wide
  and lands *after* `ACT.strike`, so nothing is ever read on mud. A test
  asserts no frame outside that window is grey.
- **Narrow frames get a different layout.** Below 760px the graph moves up and
  the sentences list underneath, arriving one at a time. Seven anchored
  sentences do not fit a phone; amount labels are dropped there entirely.
- **`data-film-ground` lives on `<html>`.** The film publishes light/dark so
  the nav can invert (`.film-aware`, `.film-mark` in globals.css) instead of
  going black-on-black for a third of the sequence. **Every exit path must
  clear it** or a client-side navigation carries a dark ground to the next
  page. That was a real bug.
- **Frame callbacks get throttled** in occluded tabs. If one has not arrived in
  260ms the film drops the spring and tracks the scroll exactly — stiff, but a
  film lagging a whole act behind the copy is worse.
- **Act II sits over `FilmBackdrop`**, the same graph drifting at very low
  contrast, so the page never reads as though the movie ended and the credits
  started. Each chapter's argument is `lg:sticky` while its artifact scrolls
  past it. The closing band carries `FilmStill at={0.7}` — the film's own black
  frame — under the ask.

**Reviewing it:** `npm run film` renders the frames as PNGs
(`--width 390 --height 780` for the phone layout). In development,
`/?film=0.62` pins a single frame so beat copy can be composed against the
image it sits on. Both exist because a scroll-driven canvas fails *quietly* —
nothing throws, the frame just stops saying what it was supposed to say.

### 5.6 Brand — `scripts/brand.mjs`

The mark is **an aperture: three blades, closed down to a point.** Not an eye,
a shield or a lock — every surveillance product and every crypto wallet already
wears one of those, and an aperture is the honest shape for a thing whose job
is deciding how much gets through. Three blades rather than six because six
merge into a blob at 16px, which is where a mark actually has to work.

The geometry exists in **three places that must agree**:

| Where | What |
|---|---|
| `LumenMark` in `icons.tsx` | 24×24, `currentColor` — nav, sidebar, connect, pay, claim |
| `public/icon.svg` | 512 maskable tile, glyph at 62% for launcher masks |
| `GEOMETRY` in `scripts/brand.mjs` | draws `icon-{180,192,512}.png` and `og.png` |

Change one, change all three, or the favicon quietly stops matching the app.
`npm run brand` regenerates every raster.

`public/og.png` (1200×630) is wired into `metadata.openGraph.images` and
`metadata.twitter.images`. Before it existed, every pasted link rendered bare
in every chat app. The constellation plate behind it is
`docs/brand/constellation.jpg`; the headline is composited by `npm run brand`,
never baked into the source image, so it can be reworded without regenerating
anything.

**Known compromise:** the card's type is set in Arial, not Inter. `next/font`
resolves Inter at build time into `.next`, and the canvas needs a font file it
can register from disk. Close enough at card size, but if the wordmark ever has
to match exactly, vendor an Inter `.ttf` into `docs/brand/` and register that
instead.

Source images live in `docs/brand/`, **not** `public/`, which would serve them
to anyone who guessed a filename. They carry C2PA content credentials — signed
manifests recording that they are AI-generated. Those were deliberately left
intact; nothing that ships contains a source bitmap anyway, since the mark is
new geometry and the card is composited fresh.

### 5.7 Copy rules

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

### 6.2 `WalletAccountV6.connect` returns an addressless account, silently

```js
static async connect(provider, walletProvider, ...) {
  const { accounts } = await standardConnect(walletProvider, silentMode)
  const accountAddress = accounts[0]?.address   // <- undefined, no error
  return new WalletAccountV6({ ..., address: accountAddress, ... })
}
```

That `?.` is the whole problem. Several wallets — Ready among them — resolve
`connect()` **the moment their approval window opens**, before the user has
approved anything, so `accounts` is empty and `connect` hands back an account
with `address: undefined` and throws nothing. Taking that at face value is what
made a first connect appear to fail and a reload appear to fix it: by the
second load the wallet had remembered the approval.

`connectWallet` in `strk20/wallet.ts` now checks the result, waits up to 90s
for the wallet-standard `change` event (with a 400ms poll under it, because not
every wallet emits it), then asks once more. `standard:connect` is idempotent
for an authorised wallet, so the second call opens no second window. If it
still shares nothing, the error **names the wallet** rather than implying the
app broke.

**Do not "simplify" this back to a single `await`.** Five tests in
`strk20/__tests__/wallet.test.ts` cover it, including a zero address, which is
a wallet saying "no account" in a different dialect.

That test file mocks `starknet` with a **three-export factory**, not
`importOriginal`. Spreading the real package costs seconds of module loading
per run and timed the suite out.

### 6.3 Wallet payloads: minimal hex, and three shape rules

All four verified against Ready X on mainnet with
`strk20PrepareInvoke(actions, true)`, which dry-runs without submitting or
signing. Each rule below is the difference between two action arrays that
were otherwise identical — one passing, one returning **114
INVALID_REQUEST_PAYLOAD**, an error that names no field.

**1. Felts are minimal hex, never zero-padded.** `0x43e4…`, what `num.toHex`
produces. The same felt padded to 64 digits is rejected. `walletFelt` in
`config.ts` is the only way an address should reach the wallet, and a test
pins it. Padding was introduced once as a *fix* for this error and made it
worse — the short address had been right for the wrong reason.

**2. `invoke` must arrive with the `withdraw` that funds the helper.** An
invoke on its own is rejected, minimal hex or not, with empty calldata or
full.

**3. An `OPEN` note must be filled by the helper's return.** An open note on
its own is rejected, and so is one in front of a helper that returns an empty
span. Our Deposit credits nothing back, so it opens no note; Claim and Refund
return one `OpenNoteDeposit` each, so they do.

**Wallet placeholders are not felts.** `${openNoteIds[0]}` and
`${poolAddress}` are substituted during assembly and must pass through
untouched — `walletFelt` returns anything unparseable as-is for exactly this
reason.

`/diag` dry-runs the four escrow flows as the app builds them. Reach for it
before reasoning about a payload: two rounds of inference from documentation
did not solve this, and one run of the wallet's own verdict did. Note that it
must report the *connected* wallet — taking the first STRK20-capable wallet
instead once labelled a Ready result as Xverse.

### 6.4 starkli cannot talk to Starknet mainnet

starkli **0.4.2 is its latest release** (July 2025) and still requests the
`pending` block tag. Mainnet moved to `pre_confirmed`; every call fails with
`unknown block tag 'pending'`, which presents as an **indefinite hang**, not an
error. Verified against two independent endpoints. There is nothing to upgrade
to.

**Use `contracts/deploy.mjs` instead** (starknet.js 10.4.0). It decrypts the
starkli keystore (standard Ethereum v3, scrypt + aes-128-ctr) in memory with a
password typed at run time, deploys the account if needed, declares, deploys,
verifies, and writes `.env.local` + `strk20.json`.

### 6.5 RPC endpoints

- **Blast is dead.** Its public Starknet RPC returns *"Blast API is no longer
  available"* on every call — and starkli auto-selects it when no endpoint is
  given. `deploy.mjs` pins an endpoint explicitly for this reason.
- **Working keyless endpoint:** `https://rpc.starknet.lava.build:443` (spec
  0.8.1, returns `0x534e5f4d41494e`).
- For heavy use set `NEXT_PUBLIC_STARKNET_RPC_URL` / `STARKNET_RPC` to your own
  Alchemy key. Declare is a ~135KB payload and public endpoints throttle it.

### 6.6 starknet.js v10 API changes

`Account` takes **a single options object**: `new Account({ provider, address,
signer })`. The pre-v10 positional form is accepted silently — the provider
becomes the options bag, a default provider is constructed, and `address` lands
undefined, surfacing much later as `Cannot read properties of undefined
(reading 'toLowerCase')`.

### 6.7 Pool facts

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

### 6.8 Cairo

**Cairo has no block comments.** `/* … */` is a syntax error; use `//`. This
broke the escrow test suite once.

### 6.9 Next.js / deploy

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
npm run typecheck && npm run lint && npm test    # 237 tests
(cd contracts && scarb build && scarb test)      # 50 tests
npm run build
```

Asset and review scripts:

```bash
npm run brand                                    # icons + og.png from GEOMETRY
npm run film                                     # landing film frames as PNGs
npm run film -- --width 390 --height 780         # the phone layout
```

Deploy a contract (needs the funded deployer + its keystore password):

```bash
node contracts/deploy.mjs
```

**If the dev server renders unstyled HTML, 404s `main-app.js`, or reports a
syntax error in a file that is provably fine, delete `.next` and restart.**
Running `npm run build` while `npm run dev` is live clobbers the dev server's
chunks. This has now caused **four** false alarms, including one where a stale
overlay reported a parse error in a file that typechecked, linted and built
cleanly. Check the file on disk before believing the overlay.

`.claude/launch.json` also defines a **`lumen-built`** configuration
(`npm run start`) for previewing the production build, which has no HMR and so
cannot go stale. Rebuild before starting it — a `.next` the dev server has
touched will fail with `Cannot find module './157.js'`.

---

## 9. What is left

**Blocking the submission, in order:**

1. **Real mainnet transactions.** Add money → mint a claim link (use the 10-min
   window so a reclaim can be filmed) → claim it from a second browser → split
   to two people. Record every hash in `strk20.json`.
2. **Answer one unknown first: does claiming a link activate a fresh account,
   or does only a deposit?** The whole wallet-less pitch rests on a
   never-registered wallet being able to claim. If only a deposit registers an
   account, that flow has a hole in it and the copy on the first-run card is
   wrong. Test it with a wallet that has never touched the pool, before
   anything else.
3. **First real QA pass.** Incoming, the journal, group send and the WorldSaw
   panels have never rendered against a live wallet. Their first real render
   will find bugs.
4. **Demo video** → `strk20.json.demo_video`. The landing film is a natural
   opening shot; `npm run film` gives you the frames.

**Proposed but not started — the founder was asked and has not answered:**

**`DepositMany` on `LumenEscrow`.** Today one `privacy_invoke` carries one
commitment, so paying N wallet-less people is N transactions. A `DepositMany`
operation would make *"pay 10 people who have never touched crypto, in one
private operation, one fee"* true. Nobody on the board can do this — Almoner
does batch disbursement to **addresses**, and every link project mints one link
at a time. It is a contract change plus a redeploy (one command now).

**Verified in this session, so you do not have to re-check:**

- The wallet connect path (§6.2) — the double-refresh is fixed and tested, but
  **it has not been driven against a real Ready wallet**. Confirm on a fresh
  browser profile.
- The landing film's act structure — 14 tests plus rendered stills at desktop
  and phone sizes. The **scrubbing itself is unverified**: the review
  environment reported zero scroll events and zero animation frames, so nobody
  has watched it move. Scroll it once before filming a demo.
- `og.png` and the icons are live and byte-identical to what the build
  produces.

**Known rough edges:**

- `LumenSplitter` is built and tested but unused and undeployed.
- Spaces are device-local only — the copy is honest about this, but a fresh
  reader may mistake them for on-chain state.
- The Scarb package is still named `lumen_splitter`; renaming changes artifact
  filenames referenced in `deploy.mjs`.
- `docs/DOSSIER.md` (self-assessment) and `docs/TRANSFORMATION.md` (strategy)
  predate the landing film, the brand and the emoji removal. `docs/BRAND-PROMPTS.md`
  records what was generated and what was chosen. This file and the README are
  current.
- `@napi-rs/canvas` and `tsx` are devDependencies purely so `npm run brand` and
  `npm run film` work. Nothing shipped imports them.

---

## 10. Working agreements with the founder

- **A deploy is a push.** The Vercel project is git-integrated — there is no
  deploy script, no CLI deploy and no Actions workflow, so production builds
  from whatever is on `origin/main` and can never be ahead of the repo. Ship
  finished work rather than letting it sit uncommitted; do not pad the log to
  look busy.
- **Do not rebuild.** The stack is enough; the miss has always been positioning
  and proof, not code.
- **Proof outranks features.** An empty `strk20.json` beats any story.
- **Be honest in copy and in reports.** Never overclaim what is private, and
  flag what has not been verified rather than implying it works.
- **Design:** keep the monochrome system. The account **is** a dashboard now
  (§5.2) — the instruction was "make it a dashboard that doesn't feel like a
  generic dashboard", not "avoid dashboards". No emoji, anywhere, ever (§5.4).
  "Infra-shaped" is a positioning word, never a visual instruction: build
  infrastructure, do not make it *look* like infrastructure people lose
  interest in.
- **Stop adding features.** The founder's own diagnosis of three previous
  projects is that they shipped a set of verbs. One interaction done absurdly
  well beats six done adequately. A sixth sidebar item is the old failure
  returning.
- **Show, do not describe.** The recurring note across every round of feedback
  was that the product kept *explaining* its argument instead of *displaying*
  it. The observer rail, the connect screen's redacted panel, and the landing
  film are all the same correction. Prefer showing.
- **Never generate or hold a private key** that controls funds, and never sign
  mainnet spends on the founder's behalf. `deploy.mjs` is the pattern: they
  type the password, the key lives only in that process.
