# Lumen — a private Bitcoin account on Starknet

**Hold Bitcoin privately. Earn on it without unshielding it. Pay anyone — including people who have never touched Starknet.**

Live: **[lumen-strk20.vercel.app](https://lumen-strk20.vercel.app)** · Mainnet · No backend, no database, no server that could hold your secrets.

---

## The one-line claim

> **Lumen stakes shielded Bitcoin into Endur without it ever becoming public** — and, as of writing, that has happened exactly once on Starknet mainnet, through this app.

Everything below is checkable. Every number was read off the chain, not estimated.

---

## Why this is not another privacy wallet

STRK20 launched with **strkBTC** — Starknet's shielded Bitcoin — and its liquid-staked form **xstrkBTC**. On launch they were the only two shieldable assets in the pool. Both can be held privately.

**But the step between them is public.**

Endur's vault is ERC-4626: `deposit` calls `transfer_from` against the caller's **public** ERC-20 balance. Inside the pool your Bitcoin is a commitment, not a balance — there is nothing for a vault to pull. So staking shielded strkBTC means:

```
unshield  →  deposit publicly  →  re-shield
```

Three public transactions. Two of them matching amounts on the same address, seconds apart. The pool's anonymity set does nothing for you, because the entry and the exit are provably the same person. **Privacy ends exactly where yield begins.**

The only way through is a contract that sits between the pool and the vault and does the whole thing atomically. STRK20 publishes an extension point for exactly that — `privacy_invoke` and open notes — and StarkWare's own words for what comes next are *"private balances and transfers into **private execution**."*

`LumenVault` is that contract, pointed at Bitcoin yield.

```
pool  →[withdraw strkBTC]→  LumenVault  →[ERC-4626 deposit]→  Endur
                                        ←[xstrkBTC]←
pool  ←[credited into an open note]←
```

One atomic pool operation. The chain sees an operation and an amount. It does not see your address, your balance, or that the stake is yours.

**Proven on mainnet:** [`0x1c0f54bf…`](https://voyager.online/tx/0x1c0f54bfc908796334dff47cdc6117d7591929d9329e5e833a6b76f99a10752) — 0.0001 strkBTC in, 0.00009934 xstrkBTC back into a shielded note. `preview_stake` quoted 0.00009934 and execution returned 0.00009934.

---

## The second thing nobody else has: a door out of the pool

A privacy pool has a one-way boundary. Money inside can be *addressed* to a stranger, but a stranger cannot step inside to collect it. A first-time recipient hits error **118 — not registered** — and no dapp can fix that for them, because the Wallet API has no register method.

So `LumenEscrow` has **two doors on one link**:

| door | who it is for | what it costs them |
|---|---|---|
| **`privacy_invoke` Claim** | someone already in the pool | lands in a shielded note; nothing about them is published |
| **`claim_to_address`** | someone with nothing | no pool membership, no shielded balance, no gas, no deployed account contract |

`claim_to_address` is ungated on purpose — **the Poseidon preimage is the authority, not the caller** — so anyone, including a relayer, can push it through for a recipient who owns nothing.

Verified on mainnet against a wallet that had none of those four things. It received 1.969194 STRK and performed no action at all.

---

## What is actually deployed

| contract | address | what it does |
|---|---|---|
| **LumenEscrow** | [`0x6c96b86d…`](https://voyager.online/contract/0x6c96b86d5f1eaee16be18ca4f346edb20c098f1106648cef3845b34723df272) | claim links: two doors, batch payouts, expiry-gated reclaim |
| **LumenVault** | [`0x73e57be7…`](https://voyager.online/contract/0x73e57be7d6c9d2321d7a01d0c2e426392fd5e736ecfbcd91d4216ba5d7a5f67) | stakes shielded strkBTC into Endur, never unshielding |
| **LumenSplitter** | [`0x44d15d99…`](https://voyager.online/contract/0x44d15d99fd2fa3a2d44e4c0e2b70e5efc2870009e2ed810380ab20a46b5c7a0) | splits one private amount into N non-round notes |
| LumenEscrow (v2) | [`0x43e41de8…`](https://voyager.online/contract/0x43e41de87ebfaec2913a85398a68e011ab2a92bbddb9211956bfabe6ed57288) | superseded, still holds and honours links minted against it |

**64 Cairo tests. 320 TypeScript tests. All green.**

---

## Six mainnet transactions, each proving one thing

| what it proves | transaction |
|---|---|
| **Private Bitcoin staking** — shielded strkBTC → Endur → shielded xstrkBTC, one operation | [`0x1c0f54bf…`](https://voyager.online/tx/0x1c0f54bfc908796334dff47cdc6117d7591929d9329e5e833a6b76f99a10752) |
| **Batch payout** — three people paid in one operation, under one flat fee | [`0x1056fd09…`](https://voyager.online/tx/0x1056fd098f3459be36fec57ca5ba6dcb09c4ab1f04810c49072d495c1bc5f5a) |
| **The private door** — a link collected into a shielded note | [`0x535cc6d3…`](https://voyager.online/tx/0x535cc6d39343a65ea22d26bdef83ebd0ab3f778c8f5690905b3b77354d75123) |
| **Reclaim** — uncollected money returned to its sender, out of a superseded contract | [`0x30b61745…`](https://voyager.online/tx/0x30b617458ee8adab1903f84eb7fdb3a4484ca3c21cfb8db4d1ea69d059d323) |
| **A link minted** — the guard moved it off a round 10 before signing | [`0x27c52c63…`](https://voyager.online/tx/0x27c52c631a9f036b4749bb736e305c8d742ce66f9b54cdebb40c267c81519d9) |
| **The first link** — minted from a shielded balance | [`0x747ea8c9…`](https://voyager.online/tx/0x747ea8c9ef941c278275c2c8e12e54b1ba7f1cab0c25d421a2718e45a6b5d52) |

Two more that are real but sit outside the manifest's rule, because they deliberately do not route through the pool:

- [`0x3af9f5cd…`](https://voyager.online/tx/0x3af9f5cdd408a9d92e38caaf4071895474a0d1d9790a96a3c798de23d57b20b) — **the public door.** Paid an address with no registration, no gas, no deployed account. Bypassing the pool is the entire point of it.
- [`0x5448e3d0…`](https://voyager.online/tx/0x5448e3d00587ab99e9b589234a5b8df67aa574e4f5571b8c291a77eb5cd2d42) — **a private swap with no paymaster** (see below).

---

## How deep the STRK20 integration goes

| surface | how Lumen uses it |
|---|---|
| Shielded balances | read through the Wallet API, on explicit user consent only |
| Private transfers | Send, batch payouts, scatter |
| **Anonymizer contracts** | three of our own, behind `privacy_invoke` and open notes |
| Open notes | `${openNoteIds[0]}` filled by our helper's return, in the receipt token |
| AVNU private swaps | **without the paymaster** — see below |
| Compliance posture | the pool's own viewing-key model; Lumen adds nothing and removes nothing |

### The private swap, without a paymaster

AVNU's SDK routes private swaps through its paymaster, and `toRpcFeeMode` hardcodes `mode: "sponsored_private"` regardless of the fee mode you pass. Sponsored mode is gated behind an API key — and a key shipped to a browser is a published key. Verified against the live paymaster: SNIP-29 code 163, `data: "x-paymaster-api-key is invalid"`.

Everything the paymaster contributed was *submission*, and the user's wallet already submits every other private operation. So Lumen asks AVNU only for what it alone knows — which executor, with what calldata, from the public build endpoint — assembles the STRK20 action set itself, and hands it to the wallet.

**No key, no credits, no server, one fewer party between the user and the pool**, and the paymaster's fee leg drops with it. See [`src/lib/strk20/swap.ts`](src/lib/strk20/swap.ts).

---

## The part most privacy apps skip

Cryptography is not what deanonymizes people. **Behaviour is.**

Lumen runs seven heuristics over your local ledger *before* anything is signed — amount correlation, exit-amount matching, round numbers, timing correlation, thin anonymity sets, repeated amounts, cadence periodicity — and acts on them silently. A round `10` becomes `9.845994`. You are never asked to think about privacy; you are paying someone.

The nudge is budgeted at ~2%, and that budget is tested at every scale a token can be denominated in. It was silently blown at 8 decimals — a 10,000-sat link drifted 8.12% — because the grain came from token decimals rather than the amount. [Fixed, and pinned by tests.](src/lib/lumen/__tests__/guard-drift.test.ts)

**And the app shows you its own worst case.** The *What the world sees* panel recomputes your public history from `starknet_getEvents` against an ordinary RPC — no indexer, no API key — because if it needed privileged access it would prove nothing. It reads **your own address only**; an earlier version accepted any address and was cut for being a doxxing tool wearing the product's brand.

---

## Honest limits

A README that only lists wins is marketing. These are in the code and the docs too.

- **The recipient must join the pool to claim privately.** Only they can do it. `claim_to_address` routes around it; it does not remove it.
- **The pool fee is flat** — 6 STRK per operation, whatever the size. Batching is therefore a 6× cost argument at six recipients, and reclaiming 2 STRK costs 6. The product says so rather than letting you find out.
- **The escrowed amount is public.** The recipient is not, the sender is not, and the roster is not.
- **Private transfers cannot be confirmed from the chain** — by design, they leave nothing but a flat fee. Every other operation here is confirmed against the chain rather than the wallet's promise, because a wallet that goes quiet after success is the worst thing a payments UI can display. It happened four times; [`src/lib/strk20/settle.ts`](src/lib/strk20/settle.ts) is the general answer.
- **LumenSplitter has no mainnet transaction.** Built, tested, deployed, unexercised.
- **The Bitcoin anonymity set is thin today** — under 1 BTC shielded pool-wide. Hold in the deep pool and convert at payout; the app's guard implies the same advice.

---

## Run it

```bash
npm install && npm run dev          # needs a STRK20-enabled wallet (Ready)
npm test                            # 320 TypeScript tests
cd contracts && snforge test        # 64 Cairo tests
```

## Read it

| doc | what it is |
|---|---|
| [`docs/WHAT-LUMEN-ACTUALLY-IS.md`](docs/WHAT-LUMEN-ACTUALLY-IS.md) | the engineering record — including what is *not* proven |
| [`docs/INTEGRATING-WITH-LUMEN.md`](docs/INTEGRATING-WITH-LUMEN.md) | wiring your own product into these contracts |
| [`docs/TRAPS.md`](docs/TRAPS.md) | every trap from eleven days of mainnet work, so the next build pays for none |
| [`docs/WHAT-MAINNET-TAUGHT-US.md`](docs/WHAT-MAINNET-TAUGHT-US.md) | what running it for real changed about the design |

**This design has already been built on.** [Sage](https://sagepays.xyz), an autonomous payout agent with real users, derived its own `SageClaims` contract from `LumenEscrow` in two days — its own tags, its own deployment, no runtime dependency. The two docs above are what it was built from.

## Stack

Next.js 15.5 · React 19 · Tailwind v4 · zustand · starknet.js 10.4.0 · `@starknet-io/types-js` 0.10.3 · AVNU SDK 4.2.0 · Cairo 2.15 · Scarb · snforge

## License

MIT. The contracts are unaudited — read them before trusting them with anything you cannot lose.
