# Aether

**Shielded isn't private.**

A privacy pool gives you an anonymity *set*. Your behaviour spends it.

Aether runs the real deanonymization attacks — amount correlation, timing
windows, round numbers, cadence, thin anonymity sets — against your actual
public footprint on Starknet mainnet, scores how linkable you are, and then
closes each leak it finds through the live [STRK20](https://strk20-by-example.org)
pool. Attack, remedy, execute, re-attack.

Built for the STRK20 Private Sprint. Live at
**[aether-strk20.vercel.app](https://aether-strk20.vercel.app)** — the exposure
analysis needs no wallet, so you can point it at any address right now.

---

## The problem Aether exists to solve

The privacy stack has three layers. **Cryptographic hiding** — commitments,
nullifiers, proofs — is solved, and chains build it themselves; STRK20 *is*
that layer. **Protocol metadata** — relayers, stealth accounts, gas privacy —
is being solved, also by chains. The third layer is **statistical privacy: the
sequence of what you do**, and nobody owns it, because it isn't a protocol
primitive. It is opinionated, user-side discipline. It is an application.

That third layer is where deanonymization actually happens. Deposits and
withdrawals are public — only the *link* between them is hidden. Attacks
re-forge that link without touching the cryptography: a withdrawal that matches
a deposit to within a fraction of a percent, an exit twenty minutes after an
entry, a round 1,000, the same hour every week, a denomination tier with four
other users in it. This is the documented failure mode of every pool that has
been studied, and no amount of proving strength fixes it.

Most privacy tooling also treats the shielded pool as a stop on the way
somewhere else. Value goes in, waits, and comes out — and the moment it touches
a public protocol, the link is re-formed.

```
Traditional flow (high leakage)
  [Wallet A] ──▶ [Shield] ──▶ [Unshield] ──▶ [Ekubo / Vesu] ──▶ identity relinked ✗
```

The subtler failure is that privacy is not a property of a single transaction.
It is a property of a *sequence*. A user who shields 1,000 USDC every Monday at
09:00 has perfect per-transaction privacy and no privacy at all, because the
pattern itself is the fingerprint.

Aether closes the loop and then optimises the sequence:

```
Aether execution engine
                ┌───────────────────────────────────────────────┐
                │          STRK20 shielded environment          │
  [Wallet A] ─▶ │  [note] ─▶ privacy_invoke ─▶ [AVNU / Vesu]     │
                │      ▲                            │           │
                │      └────────── [new note] ◀─────┘           │
                └───────────────────────────────────────────────┘
                         capital never exits
```

---

## What it does

**The adversary runs first.** Seven heuristics — amount correlation, exit-minus-fee
reconstruction, round numbers, timing windows, thin anonymity sets, repeated
amounts, cadence — run against a target's observable footprint and report how
linkable it is, with the evidence attached. It needs no wallet: paste any
Starknet address at [/app](https://aether-strk20.vercel.app/app) and it runs.

The contrast is asserted in tests, not claimed:

| Footprint | Linkability | Band | Findings |
|---|---|---|---|
| Naive — round 1,000 in, same amount out 20 min later, weekly | **100** | exposed | 16 |
| Aether-managed — non-round splits, no matching exit, irregular spacing | **0** | shielded | 0 |

Same engine, same pool data. Only the behaviour differs.

**Everything else follows from that.**


- **Multi-asset private portfolio** — shielded balances across the pool's
  supported assets, never a public balance.
- **Five strategy modes** — privacy-first, stealth DCA, whale distribution,
  yield-max, balanced. Modes change only the weighting between expected return
  and privacy delta; they never relax the hard constraints.
- **A privacy-aware execution planner** that decides *what* to do, *how much* to
  split it into, and *when* — optimising return, cost and anonymity together.
- **A live Effective Privacy Score** with a full six-dimension breakdown,
  computed from real pool data rather than asserted.
- **Attacker view** — the same account rendered as a public observer sees it,
  so the claim is inspectable rather than promised.
- **Selective disclosure** — prove a statement (`private balance ≥ X`,
  `this strategy returned Y%`) without surrendering a viewing key.
- **Never unshields by default.** Capital stays in private notes for its entire
  lifecycle. Unshielding requires an explicit, separate user request.

---

> The idea in full: [docs/IDEA.md](docs/IDEA.md). The technical reasoning — what a pool hides, what stays public, each heuristic and
> its remedy, and an explicit list of what Aether does **not** claim — is in
> [docs/ATTACK-MODEL.md](docs/ATTACK-MODEL.md).

## The Effective Privacy Score

The score is a deterministic, client-side function of observable state. The
formula is public because a privacy score you cannot audit is marketing:

```
S_eff = 0.30·A_set + 0.25·H_amount + 0.20·H_time
      + 0.15·(100 − U_behaviour) + 0.10·(100 − R_exit)
```

| Term | Meaning | Source |
|---|---|---|
| `A_set` | anonymity set size, log-scaled over the denomination tier | live pool activity |
| `H_amount` | entropy of amount splits, penalising round human numbers | your action history |
| `H_time` | inter-arrival timing entropy vs. background pool traffic | your action history |
| `U_behaviour` | behavioural uniqueness — repeated asset/route/size triples, fixed hour-of-day | your action history |
| `R_exit` | exit correlation — amounts out that match amounts in | your action history |

The last two are *inverted* in the formula: they are stored as raw risk, where
higher is worse.

### Hard constraints

These are enforced in code, not by convention, and no strategy mode can
override them:

1. **Never unshield unless explicitly requested.** The planner has no path that
   produces a withdrawal to a user-controlled public address.
2. **Never reuse an exact previous amount within 48 hours.**
3. **Refuse any action** that would drop `S_eff` below the user's floor. Refused
   actions are surfaced with their reason, not silently dropped.
4. **Compact notes** before fragmentation degrades the anonymity set.

> On withdrawals: private DeFi legitimately emits `withdraw` actions that move
> value to a helper contract, which returns it to the pool inside the *same
> atomic transaction*. That is not an unshield. `assertNeverUnshields()` runs
> immediately before signing and permits a withdrawal only to a helper
> participating in that transaction — anything else throws.

---

## Architecture

Aether integrates through the **Starknet Wallet API**. The dapp never holds
viewing keys, never generates proofs, and never sees private state; the wallet
owns all of it.

```
User wallet (Ready / Xverse)
        │  WalletAccountV6
        ▼
┌──────────────────────────────────────────────────────────┐
│  Aether frontend — Next.js 15, TS strict, Tailwind       │
│  Exposure · Position · Remedy · Ledger · Disclose        │
├──────────────────────────────────────────────────────────┤
│  Privacy policy + strategy engine                        │
│  adversary + planner: pure, seeded — 158 tests           │
├──────────────────────────────────────────────────────────┤
│  Local action ledger (browser only)                      │
│  the behavioural history a chain deliberately can't hold │
├──────────────────────────────────────────────────────────┤
│  Execution — STRK20_ACTION builders · AVNU private swaps │
│  assertNeverUnshields() before every signature           │
└──────────────────────────────────────────────────────────┘
        │  strk20InvokeTransaction / executePrivateSwap
        ▼
  Live STRK20 pool · AVNU executor · relayer
```

The engine is pure TypeScript with no `Math.random()` and no ambient clock —
seed and `now` are parameters, so a plan is reproducible and the hard
constraints are testable. Plans are seeded per address per day: regenerate all
you like, the recommendation holds still for a day.

**The local ledger** records every action Aether executes, beside what a chain
observer saw of it. It exists only in your browser: the behavioural terms of
the privacy score need a history, and the chain refusing to hold that history
is precisely the product working. Clearing it resets those terms.

**Selective disclosure** builds canonical statement JSON (balance threshold,
strategy return, non-interaction with an address set) and is explicit about
the boundary: Wallet API 0.10.3 exposes no statement-proof method, so Aether
prepares the statement today and requests the proof when wallets ship support.
No signature theatre in the meantime.

### Live mainnet addresses

Every address below was confirmed on-chain by calling `name` / `symbol` /
`decimals` (or `getClassAt`) against two independent RPC providers, rather than
copied from documentation. Three of the values that documentation would have
given are wrong, so this mattered:

| | | |
|---|---|---|
| STRK20 pool | [`0x040337b1…ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) | live, `get_version() = "2.0"`, not paused |
| Ekubo anonymizer | `0x2a4ac595…d8d19ebd7` | **declared**, ABI exposes `privacy_invoke` |
| Vesu anonymizer | `0x3751128d…2a8e24aae` | **not declared on mainnet** |
| USDC (native) | `0x033068f6…ee93b35fb` | 6 dp |
| strkBTC | `0x0787150e…e945b3135` | 8 dp |
| STRK | `0x04718f5a…87c938d` | 18 dp |
| ETH | `0x049d3657…9e004dc7` | 18 dp |

Three corrections worth recording, because each would have failed silently:

- **USDC.** The obvious address (`0x053c9125…68a8`) is bridged **USDC.e**, not
  native USDC. Inside the pool the gap is decisive — roughly 19,600 shielded
  events for native against 80 for bridged. Routing to the bridged token would
  put value somewhere with essentially no anonymity set.
- **Pool fee.** Documentation says 4 STRK; `get_fee_amount()` returns **6**.
  Pre-filling a MAX amount from the documented figure fails *after* the user
  has signed.
- **Vesu anonymizer.** Its published class hash is not declared on mainnet
  (`getClassAt` returns "class hash not found" on both providers). The hash is
  real but comes from a release-candidate tag. **The private-lending route is
  therefore unavailable**, and the planner does not offer it. Ekubo and the
  AVNU private-swap route are both live.

The pool address is independently corroborated: it is the value shipped as
`PRIVACY_POOL_ADDRESS` in `@avnu/avnu-sdk@4.2.0`.

The pool has **no token allowlist** — its ABI contains no such function, and 35
different ERC-20s have been shielded through it. Aether's token list is a
product choice, not a protocol limit.

### Anonymizer contract

`contracts/` holds **AetherSplitter**, a Cairo `privacy_invoke` helper written
for this repo. It takes one input amount and credits it back as **N non-round
output notes in a single atomic pool transaction** — the on-chain half of the
amount-entropy remedy the engine recommends. Splitting across N transactions
instead costs a 6 STRK pool fee each and leaves a timing trail between the legs
that re-links the notes the split was meant to decorrelate.

The pool supports it: `${openNoteIds[N]}` is a zero-based index over the open
notes in one transaction, and `privacy_invoke` returns a `Span<OpenNoteDeposit>`
— a list, one entry per note. Split proportions are always supplied by the
caller (the planner's entropy stays reproducible; the contract invents no
randomness), and the contract asserts on-chain that the outputs sum to exactly
the input minus any declared fee. Only the pinned pool address may call it.

Draft, unaudited, and **not deployed** — declaring a class on mainnet spends gas
and is the repo owner's call. `contracts/deploy.sh` prints the exact starkli
commands without executing them or touching key material. Build with
`scarb build`, test with `snforge test` (29 tests). Details, the full calldata
layout, and the honest trade-off against plain in-pool transfers are in
[`contracts/README.md`](contracts/README.md).

### Pinned stack

STRK20 support landed in `starknet@10.4.0`. A bare `npm install starknet`
resolves to the `latest` line, which lacks `WalletAccountV6`,
`strk20InvokeTransaction` and `STRK20_ACTION` entirely. These versions are
pinned exactly and deliberately:

```
starknet                                    10.4.0
@starknet-io/get-starknet-discovery          6.0.3
@starknet-io/get-starknet-wallet-standard    6.0.3
@starknet-io/types-js                       0.10.3
@avnu/avnu-sdk                               4.2.0
```

---

## Running it

```bash
npm install
cp .env.example .env.local   # then paste your own Alchemy key
npm run dev
```

You need a privacy-enabled Starknet wallet (Ready; Xverse in progress) that
advertises Wallet API `>= 0.10.3`.

```bash
npm test        # engine unit tests
npm run typecheck
npm run build
```

**The RPC key is read from `NEXT_PUBLIC_STARKNET_RPC_URL` and is never
committed.** `.env.local` is gitignored.

---

## Reproducing the three mainnet transactions

Recorded in [`strk20.json`](./strk20.json) as they land.

1. **Shield** — deposit into the live pool, creating private notes.
2. **Private swap** — an AVNU private-mode swap; the output returns as a
   private note. On Voyager the caller is the executor contract, not the user.
3. **Private DeFi** — a Vesu anonymizer lend or a note-to-note rebalance.

Each is a separate transaction by design. Bundling the shield with the action it
funds would re-create the public link the whole product exists to break.

---

## Status

Under active development for the STRK20 Private Sprint (18–31 Aug 2026).
Transaction hashes, contracts and the demo link populate `strk20.json` as they
come to exist.

## Licence

MIT — see [LICENSE](./LICENSE).
