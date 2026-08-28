# What Lumen actually is

Written 29 Aug 2026, after the first full night of mainnet use. This is the
engineering record, not the pitch. Where the two disagree, this one is right.

---

## 1. In one paragraph

Lumen is a browser client for Starknet's STRK20 privacy pool, plus two Cairo
contracts of its own. **The pool provides the privacy** — shielded balances,
note commitments, proving, relayed submission. Lumen never sees a viewing key
and has no server. **Lumen's own contribution is an escrow**: a way to pay
someone who is not set up yet, by parking value behind a secret that travels
in a URL fragment and can be collected through either of two doors. Everything
else in the product is a payments interface wrapped around that one primitive.

---

## 2. The three layers

**Not ours — the STRK20 privacy pool.** Reached only through the user's
wallet (Ready), via `strk20InvokeTransaction`. The wallet handles note
discovery, proving and submission. Every private transaction is submitted by a
relayer, so the on-chain sender is never the user.

**Ours, on chain — two Cairo contracts.** Anonymizer helpers: the pool
withdraws to them, calls `privacy_invoke`, and credits whatever they return
into an open note, atomically.

**Ours, in the browser — a Next.js client.** No backend, no database, no API
routes. All state is `localStorage`. All chain reads are plain public RPC.

---

## 3. The contracts

### LumenEscrow — 466 lines, 35 Cairo tests

Live at `0x6c96b86d5f1eaee16be18ca4f346edb20c098f1106648cef3845b34723df272`.

`privacy_invoke` is the single entry point the pool calls, dispatching on an
operation enum:

| Operation | What it does |
|---|---|
| `Deposit` | Records one commitment + amount + expiry |
| `DepositMany` | Records up to 32 in one call, bound to the funds delivered |
| `Claim` | Takes an entry by claim preimage, returns it to an open note |
| `Refund` | Takes an entry by refund preimage, after expiry |

Plus one function the pool never touches:

`claim_to_address(secret, recipient)` — **the public door.** No pool gate, no
caller check: the preimage is the authority. It transfers the entry's tokens
straight to any address. This exists because the private door has a hard
prerequisite (see §7) and a person receiving their first money does not have
it.

Design details that matter:

- **Domain-separated commitments.** `poseidon('LUMEN_ESCROW_CLAIM:V1', s)` and
  `poseidon('LUMEN_ESCROW_REFUND:V1', s)`. A refund key can never spend a link
  and a link can never trigger a reclaim.
- **A refund maps to its claim commitment**, so a refund secret can find the
  entry it belongs to without the link.
- **`take_entry` flips `claimed`; it does not delete.** That is what lets the
  app tell "already collected" apart from "never existed" — and it is what
  makes both doors idempotent.
- **`assert_solvent`** reads the balance once per batch, not once per leg.
- Claims stay valid after expiry until a refund actually happens. Expiry opens
  the sender's door; it does not close the recipient's.

### LumenSplitter — 411 lines, 29 Cairo tests

Live at `0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0`.
Splits one private amount into N parts by basis points inside a single pool
operation. **Deployed and unit-tested, never exercised on mainnet.** It is the
one built thing with no receipt behind it.

### Three escrows exist, not one

`0x293c8a95…` (8-arg `privacy_invoke`, no batch, no public claim) and
`0x43e41de8…` (9-arg, batch, no public claim) were superseded on 28 Aug. **A
superseded escrow is never emptied** — the 2 STRK reclaim on 29 Aug came out
of the second one. `KNOWN_ESCROWS` is append-only and every read and exit
resolves which escrow holds a commitment before acting.

---

## 4. The client

Four routes:

- `/` — landing. A scroll-driven `<canvas>` film in seven acts
  (`arrive · wire · name · strike · cut · erase · calm`), pure drawing
  functions with 14 tests, plus five sections beneath it.
- `/app` — the product. One shell, one home surface, sixteen sheets.
- `/claim` — where a recipient meets the money. Reads the fragment, checks
  every known escrow, works with no wallet connected.
- `/pay/[[...slug]]` — a personal payment page.

One zustand store (`src/lib/lumen/store.ts`), 17 async actions, ~22 state
fields. Persistence is `localStorage`, keyed by account — **except the inbox**,
which is deliberately device-global, because a claim link is routinely opened
before any wallet exists and keying it by account would drop exactly the
arrivals a new user is about to collect.

**Nothing is transmitted.** The claim secret lives after the `#`, which
browsers never send to a server. There is no server to send it to.

### The wallet boundary

`src/lib/lumen/wallet-gate.ts` exists because two failure modes were invisible
from inside the actions that caused them:

- **One request at a time**, released when the wallet answers rather than when
  the app stops listening.
- **Race the wallet against the chain.** The wallet is the fast path; the chain
  is the authority; whichever answers first ends the wait.

Every escrow operation has a chain-visible outcome — a mint writes an entry, a
claim or refund takes one — so all four confirm from either side. Private
transfers have no such outcome by design and still wait on the wallet alone.

---

## 5. What the design actually is

Light, paper-like, near-monochrome. There is no brand colour.

| Token | Value | Used for |
|---|---|---|
| `--color-canvas` | `#f3f2f0` | Page |
| `--color-card` | `#ffffff` | Cards, sheets |
| `--color-ink` | `#121214` | Text, primary buttons |
| `--color-glass` | `#0c0c0e` | The money card, and only money |

Inter for text, JetBrains Mono for hashes and addresses. Cards at 24px radius,
sheets at 28px, a single sheet easing curve. **No emoji anywhere** — a custom
icon set replaced them on request.

The one structural idea in the UI is the **two-panel split**: *Your view* and
*What the world sees*. The right panel is not decoration — the Mirror
(`src/lib/mirror/read.ts`) recomputes a public address's history from
`starknet_getEvents` against an ordinary public RPC, no indexer and no API key,
because if Lumen needed privileged access to produce it the argument would be
worthless. It reads **your own address only**; an earlier version accepted any
address and was cut for being a doxxing tool wearing the product's brand.

### The guard

`src/lib/deanon` runs seven heuristics — amount correlation, exit-amount match,
round numbers, timing correlation, thin anonymity set, repeated amounts,
cadence periodicity — over the local ledger *before* anything is signed. Its
visible output is small on purpose: it silently rewrites round amounts
(10 → 9.845994) rather than opening a dialog. Nobody opened a privacy app;
they are paying someone.

---

## 6. What is proven on mainnet

Seven transactions, all recorded in `strk20.json`:

| Hash | Block | What it proves |
|---|---|---|
| `0x747ea8c9` | 14011191 | A link minted from shielded balance |
| `0x423c246a` | 14012471 | Two-door escrow deployed |
| `0x3af9f5cd` | 14013048 | **Public door.** Paid an address with no pool registration, no shielded balance, no gas, and no deployed account contract |
| `0x27c52c63` | 14013806 | Link minted; the guard moved it off a round 10 |
| `0x535cc6d3` | 14013837 | **Private door.** Same link shape, credited to an open note |
| `0x1056fd09` | 14014301 | **Batch.** Three people paid in one operation, one fee |
| `0x30b61745` | 14015553 | **Reclaim.** Uncollected money home, across escrow versions |

Two verified numbers behind those:

- **The pool fee is 6 STRK flat per operation**, read from `get_fee_amount()`
  and confirmed by arithmetic: 766.5299 − 2.8 − 6 = 757.7299 exactly. Three
  separate payments would have cost 18. That makes batching a cost argument,
  not only a privacy one.
- **A never-registered account cannot claim privately** — refused with 118.
  That is what `claim_to_address` was built to answer, and the walletless
  claim above is the answer working.

---

## 7. What is not true, or not proven

Listed because a document that only records wins is not an engineering record.

- **The splitter has no mainnet receipt.** Built, tested, deployed, unused.
- **The registration wall is real and no dapp can remove it.** To claim
  *privately*, the recipient must join the pool; their wallet does it on first
  use, but only they can trigger it. There is no register method in the Wallet
  API. The public door works around this; it does not remove it.
- **The flat fee makes small payments uneconomic.** Reclaiming 2 STRK cost 6.
  Nothing in the product hides this and nothing in the product fixes it.
- **Private transfers cannot be confirmed by the app.** They leave no
  observable outcome — that is the point of them — so the wallet-hang class of
  bug is still reachable on that one path.
- **The batch offers no reclaim-window choice.** Hardcoded to 7 days; only the
  single-link flow has the selector.
- **Balance display needs wallet consent**, and Ready re-asks. The number is
  hidden until the user asks for it, which is honest but adds a step.
- **`src/lib/store/plan.ts` is dead** — imported by a test and nothing else.
- **There is no demo video**, and the leaderboard's last index is 12 commits
  and 7 transactions behind.

---

## 8. Where it went wrong, by class

### Payload shape — the expensive one

`INVALID_REQUEST_PAYLOAD (114)` on every link mint. Guessed twice from
documentation that contradicted itself, and the second guess — padding
addresses to 66 characters — *was itself the bug*. Solved only by dry-run
diagnostics that changed one variable at a time. Four rules came out of it:

1. Felts go to the wallet as **minimal hex**, not zero-padded.
2. An `invoke` action must be accompanied by a `withdraw`.
3. An `OPEN` note must be filled by the helper's return.
4. `${openNoteIds[0]}` and `${poolAddress}` pass through untouched.

### Treating the wallet's promise as the truth

Three separate hangs: a claim, then a claim again, then a reclaim. Each time
the transaction succeeded on chain and the button said "Waiting…". The first
fix covered one path; the second fix had a bug of its own (it checked whether
the entry had *disappeared*, but `take_entry` flips a flag); the third fix
finally generalised. **7 of 7 operations succeeded on chain; the UI's account
of them failed three times.**

### Treating local state as the truth

The inbox showed money already claimed. The sent-links list offered "Take it
back" on links someone had already collected — a button that could only
revert, after a wallet prompt and a fee. Both were caches nothing reconciled.
Both now read the chain before they paint.

### Assuming there is one escrow

Every exit was built against the current address. A link minted before a
redeploy sits in the older escrow, so the refund found no entry and reverted
with `TRANSACTION_EXECUTION_ERROR` and nothing to act on. The same assumption
would have told a *recipient* their money did not exist.

### Deploy cost

A failed deploy on resource bounds; the first fix padded already-padded bounds
and turned a 25 STRK ceiling into 35. The recorded "~19 STRK baseline" was
fiction — a balance read *after* the first deploy. Cost is roughly linear in
Sierra felts and had not changed.

### Caught by the user, not by me

- A diagnostic reported the wrong wallet — it used the first STRK20-capable
  wallet rather than the connected one, and labelled a Ready result as Xverse.
- The observer panel said nothing had crossed the public boundary while an
  800 STRK shield sat on chain, because it read only the local ledger.
- A "3.1 BTC" figure in a draft; the actual quantum-safe transaction moved
  10,000 satoshis.

### Housekeeping

A stale `.next` cache produced unstyled HTML, a 404 on `main-app.js`, and
phantom syntax errors — five or more times. `overflow-hidden` on the root
silently broke `position: sticky` and with it the landing film.

---

## 9. Numbers

| | |
|---|---|
| Commits | 98, from 18 Aug to 29 Aug 2026 |
| TypeScript (app) | ~17,500 lines across `src/app`, `src/components`, `src/lib` |
| TypeScript (tests) | 3,789 lines · **292 tests** |
| Cairo (contracts) | 980 lines · **64 tests** in 1,309 lines |
| Routes | 4 |
| Sheets | 16 |
| Store actions | 17 |
| Mainnet transactions | 7 |
| Contracts live | 2 (plus 2 superseded escrows still readable) |
| Backend | none |

Stack: Next.js 15.5.19, React 19.1, Tailwind v4, zustand 5, starknet.js
10.4.0, `@starknet-io/types-js` 0.10.3, AVNU SDK 4.2.0, Scarb + snforge.

---

## 10. What is left

1. A demo video. `strk20.json.demo_video` is still `""`.
2. One README line naming Sage as the first customer of the batch primitive.
3. A splitter operation on mainnet, if there is time — it is the only built
   thing with no receipt.
4. The duplicate wallet prompt: not reachable from this app as written
   (`strk20InvokeTransaction` is a single request, and the store marks itself
   submitting synchronously). The gate now logs when it refuses a request, so
   the next occurrence says which side raised it.
