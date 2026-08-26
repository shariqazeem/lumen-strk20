# Lumen — build dossier

**Private money, by default.**

A consumer money network on Starknet where paying, receiving and saving never
publish a financial profile — and where you can pay someone who has no wallet at
all. This is everything that exists today, how it looks, how it works, and an
honest read on whether it wins.

| | |
|---|---|
| **Live** | [lumen-strk20.vercel.app](https://lumen-strk20.vercel.app) |
| **Walkthrough** | [`/app?preview`](https://lumen-strk20.vercel.app/app?preview) — sample data, no wallet needed |
| **Tests** | 222 green (172 TypeScript · 50 Cairo) |
| **Code** | ~13.3k lines source · ~3.2k lines tests · 32 commits |
| **Contracts** | 2 Cairo anonymizers (LumenEscrow, LumenSplitter) |
| **Mainnet** | ⚠ Deploy pending — `strk20.json` still empty |

---

## 1. The thesis

### Cryptography holds. Behaviour betrays.

A privacy pool gives you an anonymity set; ordinary use spends it. The 2026
"Anonymity Gap" work on shielded UTXO systems keeps measuring the same result:
provenance, value constraints, timing and habit shrink the *effective* anonymity
set by 40–59% on real deployments, and plenty of transactions collapse to a
handful of candidates. The leak is not in the proofs. It is in what people do —
and that is the application layer's job, not the chain's.

Lumen's answer has two halves:

- **A silent engine** that runs those exact attacks against your own next move
  and quietly rewrites what would leak.
- **A network shape** — two kinds of link — so privacy spreads by being used
  rather than by being explained.

> Ordinary money movement should not create a public financial profile.

---

## 2. How it got here

Three pivots in one week. The order matters, because each step removed a reason
judges could dismiss it.

| | |
|---|---|
| **was** | **Aether** — a deanonymization dashboard that scored how linkable you were. Scientifically right, commercially dead: nobody optimises a privacy score. |
| **then** | **Lumen** — the analysis engine went silent and became a money app. Better, but it read as "a nice wallet," and the board already has wallets. |
| **now** | **Lumen, the network** — the app is the account surface; the product is **claim links** (pay anyone, wallet optional) and **pay pages** (get paid from a bio or invoice). Every link recruits its recipient. |

---

## 3. The surface — what a person actually touches

**Home.** One black-glass card holds the private balance, revealed only through
an explicit wallet consent. Three verbs: Pay · Receive · Add. Below: Spaces,
People, and an activity list that tells the truth twice — what you did, and what
the chain saw.

**Observer View.** The signature interaction. One tap on "What the world sees"
redacts the entire app to exactly what any explorer can ever know: your deposits,
and a single line reading *"N private operations — invisible."* Privacy stops
being a claim and becomes something you look at.

**Pay with a link.** For someone with no wallet. The escrow amount is public, so
the engine tunes it; the claim secret rides in the URL fragment, which browsers
never send to any server. Unclaimed after a week? Take it back.

**Get paid.** A standing pay page — name, avatar, USD presets priced live — or a
one-off request that locks an exact amount for an invoice. Both are just links;
there is no backend anywhere.

**Convert.** AVNU private swaps as one calm sheet: debounced live quotes, rate,
USD value. Value changes token inside the pool — observers see an executor talk
to an AMM, never you.

**Receipts & Cash out.** Every payment mints a receipt carrying one fact you can
hand to one person. Cash out sits one level deeper in the menu, warned and
guard-checked: the exit is where private money historically gets traced.

**Spaces & People.** Spaces are a private partition of the one shielded balance,
held on-device — moving between them is instant and free because nothing touches
the chain (a boundary the chain could see would itself leak). People is the
address book of relationship identities.

---

## 4. Design system — strict monochrome, one dark object

The interface is porcelain white and warm grey. The single dark thing on screen
is your private balance — a slab of black glass. No gradients, no accent hue; the
only colour on the surface comes from emoji. Hierarchy is carried by weight,
scale, and the black-on-white inversion, which is also how severity reads: a
guard warning doesn't turn amber, it turns **black**.

### Palette

| Token | Hex | Role |
|---|---|---|
| Canvas | `#f3f2f0` | the ground |
| Card | `#ffffff` | raised surfaces |
| Card soft | `#faf9f7` | recessed panels |
| Sunk | `#eae8e4` | chips, tracks, inactive |
| Ink | `#121214` | text, and every emphasis |
| Ink soft | `#3c3c41` | secondary text |
| Ink muted | `#77767c` | tertiary text |
| Ink faint | `#b1b0b6` | hints |
| Rule | `rgba(18,18,20,0.08)` | hairlines |
| Glass | `#0c0c0e` → `#17171a` | the private balance object |

### Type

Inter for everything human, JetBrains Mono for hashes and addresses. Money is
always tabular. Display sizes run to 76px on the landing with −0.04em tracking;
the app tops out at 46px on the balance.

### Form

24px card radius, 28px sheets, pill buttons at 52px. Two-layer shadows, hairline
borders at 8% ink. One modal surface — a bottom sheet on the Apple curve
`cubic-bezier(0.32, 0.72, 0, 1)` that defers unmount so closing never pops.

### Motion

Staggered rise on load, scroll reveals, a pointer-tilted hero device, a count-up
balance, an endless marquee and a climbing exposure feed. Every loop honours
`prefers-reduced-motion`.

### Voice

No seed phrases, no notes, no nullifiers, no jargon. "Your money." "Nothing
public." "This one is public." The copy is where the privacy model is taught, and
it never overclaims.

---

## 5. The engine — it never shows you a score

Before any wallet prompt, the guard runs the attacks against the action you are
about to take. Where the amount is Lumen's own — a deposit, a cash-out, an escrow
— it *rewrites* it. Where the amount is a promise to another person, it warns
instead. All of it is pure and deterministic: same inputs, same review, always.

| Action | What it checks | What it does |
|---|---|---|
| **Pay** | Cross-relationship amount reuse in a 48h window; cadence periodicity by coefficient of variation | Warns — the amount is a contract with someone else |
| **Add money** | Round numbers, amounts reused inside the window | Rewrites: 100 → 99.889991, ≤2% drift, seeded per account per day |
| **Claim link** | Same hygiene — the escrowed amount is public forever | Tunes the escrow amount, with a "keep exact" escape hatch |
| **Cash out** | Exit↔entry amount correlation, roundness, recent-activity timing | Warns, retunes, and proposes an irregular window from a de-periodised exponential schedule |

The maths underneath is the deanonymization engine this repo originally shipped
as a product — amount correlation, round-number salience, timing windows,
cadence, anonymity-set thinning, exit matching — now run on the defender's side.

---

## 6. Architecture — two contracts, no server

**LumenEscrow (Cairo).** The claim-link anonymizer. `privacy_invoke` with
Deposit / Claim / Refund, dual domain-separated Poseidon commitments (a refund
secret is unusable on the claim path), expiry-gated refunds, per-token solvency
accounting so an unbacked entry cannot exist, and events.

**LumenSplitter (Cairo).** Splits one withdrawal into up to 16 non-round open
notes atomically — the amount-entropy primitive, for splits whose size is only
known at execution time.

**The rails.** Wallet API `WalletAccountV6` throughout: the wallet owns viewing
keys, note discovery, proving and submission. Live pool fee read from
`get_fee_amount` (6 STRK, not the documented 4). `assertNeverUnshields`
mechanically refuses any withdrawal that is not the escrow or an explicit
cash-out.

**No backend, on purpose.** Claim secrets and whole pay pages travel in the URL
fragment, which browsers never transmit. Product data lives in localStorage keyed
per account. There is no server to subpoena, no analytics, no account. It is a
privacy claim and a cost structure at once.

### The detail worth pointing at

The commitment hash that carries the money is pinned by the *same* test vector in
both the Cairo suite and vitest. If the client and the contract ever drift on
that hash, links would be minted the contract cannot find — funds stuck. Two
languages, one assertion, both suites fail together.

---

## 7. State of play

| | |
|---|---|
| ✅ **shipped** | Landing, app, claim pages, pay pages — four routes, deployed and live |
| ✅ **shipped** | Both Cairo anonymizers, written and fully tested against a simulated pool |
| ✅ **shipped** | Silent engine wired into every money-moving flow |
| ✅ **shipped** | Observer View, receipts, Spaces, People, Links, Convert, PWA install |
| ✅ **shipped** | Sample walkthrough at `/app?preview` for judges with no wallet |
| ⬜ **pending** | **Mainnet deploy of LumenEscrow** — until it lands, claim links stay hidden in production |
| ⬜ **pending** | **Three real mainnet transactions** — `strk20.json` is still empty |
| ⬜ **pending** | **Demo video** |

---

## 8. The honest read — is it a winner?

Scored against the sprint's own criteria, with the gaps stated plainly rather
than buried.

### STRK20 depth (30%) — **strong**

Two anonymizer contracts of our own, private transfers, shielded balances, AVNU
private swaps, live fee reads, open notes, the escrow pattern the organizers' own
repo only prototypes. Most entries consume the pool; this one extends it.

### Innovation — **strong**

Claim links remove the requirement that killed every other private-payment entry:
the recipient needing a registered wallet first. Nothing on the board leads with
it. Observer View and the silent engine are unique, and the research grounding is
real rather than decorative.

### Design & product — **strong**

The strict monochrome direction is genuinely differentiated in a field of
gradient web3 dashboards, and the copy teaches the privacy model without a single
piece of jargon. This is the most defensible axis.

### Working mainnet product — **unproven**

This is the gap, and it is the one judges weight hardest. Zero transactions
recorded. The escrow has never executed against the real pool — only against a
faithful mock. Calldata shape, the withdraw-to-helper leg and note maturity all
meet reality for the first time on deploy day, and that is exactly where
integration surprises live.

### Docs & open source (15%) — **strong**

README rewritten around the network, an honest privacy-boundary table, a deploy
walkthrough that executes nothing, MIT licence, dense commentary throughout. The
contracts are labelled draft and unaudited — honest, and a judge may still poke
at it.

### Verdict

On thesis, craft and depth, this is competitive with anything on that board — and
the claim-link angle is the kind of thing a judge remembers the next morning. The
risk is not the idea, the design, or the code. It is that a beautiful,
well-tested product with an empty `strk20.json` loses to a plainer one that moved
real money. **Everything that separates this from a winner is a few hours of
deploy-and-record work** — and it cannot be faked in the video, so it has to
happen first.

---

## 9. The demo that wins it

1. **Your pay page** collects a payment from a stranger — privately.
2. **A claim link** pays a friend who has no wallet; they install, claim, and
   arrive already private.
3. **Convert** moves value between tokens without leaving the pool.
4. **Flip to Observer View** — the chain saw a deposit and nothing else. Cut.

---

*Lumen — private money, by default · STRK20 · Starknet mainnet · Private Sprint 2026*
