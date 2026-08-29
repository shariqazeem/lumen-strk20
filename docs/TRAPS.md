# Traps

Every one of these cost real time on this project between 18 and 29 August 2026.
Written for anyone building payments on STRK20 so they cost you none. Ordered by
when you hit them.

Each entry is: what you see → why → what to do.

---

## 1. Writing the Cairo

**A function that always reverts is worse than no function.** Endur redeems
through a withdraw queue with a zero liquid buffer, so an `unstake` operation
could never fill an open note atomically. Shipping it would have looked complete
and failed every time. Check the venue's actual liquidity before you commit to
an operation existing.

**Measure what arrived; never trust a declared amount.** The helper is stateless
and holds nothing between transactions, so its whole balance *is* what the
pool's withdraw leg just delivered. Read `balance_of(get_contract_address())`.
A caller who declares less than was delivered strands the difference; one who
declares more gets a revert late instead of a rejection early.

**Approve, never transfer, when returning value to the pool.** The pool pulls.
Approve exactly the amount you are promising in the returned `OpenNoteDeposit`
— a promise larger than the allowance aborts the transaction, smaller strands
tokens inside your contract.

**Flip a flag; do not delete.** `take_entry` writes `claimed: true` rather than
clearing the entry. That is what lets a client tell *already collected* from
*never existed*, and it makes both exits idempotent. If you delete, every
"already claimed" message becomes "no such link".

**Separate the hash domains.** `poseidon(CLAIM_TAG, s)` and
`poseidon(REFUND_TAG, s)` with different tags, so a reclaim key can never spend
a link and a link can never trigger a reclaim. One tag is a vulnerability, not a
simplification.

**Pin addresses at deployment, do not take them in calldata.** A vault address
passed in calldata is a vault address an attacker passes, and your contract
approves whatever it is handed. Pin it, and assert the relationship in the
constructor — `LumenVault` checks `vault.asset() == asset` so a deploy naming
the wrong underlying aborts instead of silently approving the wrong token.

**Read the balance once per batch, not once per leg.** `assert_solvent` over N
legs with N reads is N times the cost for the same answer.

**Cap the batch.** `MAX_BATCH = 32`. Without it a caller can build a transaction
that runs out of gas halfway and you learn about it on mainnet.

---

## 2. Testing the Cairo

**A constructor panic is an `Err`, not a catchable panic.** `#[should_panic]`
does not see it; `.unwrap()` swallows the reason and reports
`Result::unwrap failed`. Match on the result instead:

```cairo
match contract.deploy(@calldata) {
    Result::Ok(_) => panic!("the deploy should have been refused"),
    Result::Err(data) => assert(*data.at(0) == errors::EXPECTED, 'WRONG_REASON'),
}
```

**Test at the real exchange rate, not 1:1.** Endur returned 99,415,375 shares
for 100,000,000 assets. A suite that only ever tests 1:1 passes while the
rounding is wrong.

**Test at dust.** Bitcoin has 8 decimals, so a realistic first payment is 1,000
units, not `10**18`. Amount handling that works at whole tokens can divide to
zero at dust.

---

## 3. Declaring and deploying

**Budget by Sierra length before you spend.** Declaring costs about
**0.0102 STRK per Sierra felt**. Check it first:

```bash
node -e "console.log(require('./target/dev/<pkg>_<Contract>.contract_class.json').sierra_program.length)"
```

1,422 felts cost 14.51 STRK; 2,574 cost about 26. A declare that runs out of
funds still burns the fee.

**Set `sierra-replace-ids = false`** under `[cairo]` in `Scarb.toml`. It embeds
human-readable identifiers that inflate Sierra length for debugging value that
does not exist on mainnet. snforge is unaffected — test panics come from felt
short strings. This is free money.

**starkli 0.4.2 does not work against mainnet.** It still asks for the `pending`
block tag, which mainnet replaced with `pre_confirmed`; every call fails with
`unknown block tag 'pending'`. Use `sncast`, or starknet.js 10.4.0, which speak
the current spec. `sncast` reads a starkli keystore directly — pass `--keystore`
plus `--account` as a *path*.

**Do not pad resource bounds that are already padded.** A "safety margin" applied
twice turned a 25 STRK ceiling into 35. Add headroom to the amount only, once,
and log the number you are about to authorise.

**Do not mix BigInt and Number in fee maths.** JavaScript throws
`Cannot mix BigInt and other types`, mid-deploy, after you have already paid to
declare.

**A baseline recorded after the event is fiction.** "~19 STRK per deploy" was a
balance read *after* the first deploy had already been paid for. Cost is roughly
linear in Sierra length and had not changed at all. Record before, not after.

**Verify three things, or a wrong deploy looks right:**

1. *Stale artifact* — run `scarb build` immediately before declaring.
2. *Wrong class at the address* — compare `starknet_getClassHashAt` against the
   hash you just declared.
3. *ABI drift* — Cairo 2 ABIs nest functions inside `interface` entries. A
   top-level search finds nothing and reports a correct deploy as broken. Flatten
   first:
   ```js
   abi.flatMap((item) => (item.type === 'interface' ? (item.items ?? []) : [item]))
   ```

Then **read a view function back and assert the value.** "The transaction
succeeded" is not verification. For an anonymizer, reading a live rate off the
venue also proves it is reachable and unpaused — the two ways a correctly
deployed helper still reverts on its first real call.

**One account, one nonce.** Two tools deploying at once collide and one
transaction dies after paying. Sequential.

---

## 4. Talking to the wallet

**`INVALID_REQUEST_PAYLOAD (114)` is payload shape, and the docs contradict
themselves.** Four rules, all established by dry-run, all counter to at least
one reading of the documentation:

1. Felts go to the wallet as **minimal hex**, never zero-padded. `0x1`, not
   `0x00…01`. A padding "fix" was itself the bug.
2. An `invoke` action must be accompanied by a `withdraw`.
3. An `OPEN` note must be filled by the helper's return, and it is opened in the
   token the helper **returns** — not the one it consumes. Opening it in the
   input token makes the pool fill a note that does not exist, and you get a bare
   execution revert with nothing to read.
4. `${openNoteIds[0]}` and `${poolAddress}` pass through untouched.

**Calldata order is the signature's order.** It is deserialised straight into
`privacy_invoke`'s parameters. One field out of place is a revert with no
message.

**Guessing from documentation is the expensive path.** Two guesses, both wrong,
and the second made things worse. What worked: dry-runs changing exactly one
variable at a time. Budget for that instead of for reading.

**`strk20PrepareInvoke(actions, true)` is a dry run but still asks the wallet to
prove** — it produces a prompt. It is not a silent probe, and using it as one
queues prompts the user cannot account for.

**Never feature-detect with `strk20Balances`.** It is a balance read gated behind
a consent prompt. Query `supportedWalletApi` and compare versions instead.

**A shield is two transactions** — the ERC-20 approve must land before the
private deposit — so the wallet prompts twice. Label both steps or the second
reads as a duplicate-transaction bug.

**One wallet request at a time, and release the lock when the wallet answers —
not when you stop waiting.** A wallet queues what it cannot show at once, so a
second request raised mid-flight resurfaces later as a prompt with no context,
usually right after the user dismissed the first. Put the lock at the boundary,
not in each caller: reading balances is a wallet prompt wearing the clothes of a
refresh button, and it will be the one you forget.

**The wallet's promise can hang.** The transaction lands, the response never
routes home, and the UI insists it is waiting while the money has already moved
— the worst thing a payments UI can display. Race the wallet against the chain
and take the first answer. Every escrow operation has a chain-visible outcome:
a mint writes an entry, a claim or refund takes one. Private transfers do not,
by design, so that one path genuinely has to wait.

When you write that fallback, **check the flag, not absence.** A settled entry is
still present; `take_entry` flips `claimed`. A check for disappearance reports
success as failure — a bug we shipped inside the fix for the original bug.

---

## 5. The pool and the money

**Read `get_fee_amount()`; do not hardcode.** It was 6 STRK flat per operation
on mainnet, and flat is the load-bearing word. Paying N people separately costs
6N; one `DepositMany` costs 6 once. Reclaiming 2 STRK costs 6 — so say in the
product that small amounts are not worth reclaiming, rather than letting someone
discover it.

**Subtract the fee before pre-filling a MAX amount**, or the operation fails
after the user has signed.

**Error 118 is not a failure you can fix.** The recipient has never joined the
pool, the Wallet API has no register method, and only they can do it — inside
their own wallet's screen. Design the recipient onboarding, or route around it
with an ungated public claim.

**A server cannot touch the private side at all.** Everything shielded goes
through `strk20InvokeTransaction`, a wallet request; the wallet holds the
viewing key and does the proving. A headless process can only call ungated plain
invokes. If your agent is autonomous, this decides your architecture — plan for
a human-signed batch, or a contract with a permissionless funding path.

**Attribute activity from the pool's `Deposit` event, never from the transaction
sender.** Everything is relayer-submitted, so the sender is the relayer for
every user.

**New notes mature ~10 blocks before they are spendable.** Build the wait into
the UX.

**A superseded contract is never emptied.** Keep an append-only list of every
address you have deployed, and resolve which one holds a commitment before
acting on it. An exit built against the current address finds no entry and
reverts with nothing readable — and the same assumption would tell a *recipient*
their money does not exist.

**AVNU's private swap needs a paymaster API key.** Its SDK's `toRpcFeeMode`
hardcodes `mode: "sponsored_private"` and ignores the fee mode you pass; that
mode is gated. A browser cannot hold the key. The way through: call the public
`/swap/build` endpoint for the executor address and its calls, assemble the
STRK20 action set yourself, and submit through the wallet. You also drop the
paymaster's fee leg, so it costs less.

---

## 6. The client

**`Intl` throws when `minimumFractionDigits > maximumFractionDigits`.** Computing
the two bounds from separate conditions is a `RangeError` in a render path,
which is a blank page reading "a client-side exception has occurred" — not a
mis-rounded number. It sat latent here for weeks and only surfaced when a token
priced in tens of thousands made typing `1` enough. Derive both from one
decision.

**`overflow: hidden` on the root silently breaks `position: sticky`.** Use
`overflow-x: clip`. On `body`, `hidden` also makes it a scroll container.

**`NEXT_PUBLIC_*` is inlined at build time.** Changing the value in your host's
dashboard does nothing until you rebuild — and a secret in one of these is a
published secret, since it ships in the client bundle.

**Delete `.next` when the impossible happens.** Unstyled HTML, a 404 on
`main-app.js`, syntax errors in files that are fine: stale cache, five or more
times. `rm -rf .next` before debugging anything that makes no sense.

**Local state lies.** A list of links you sent, or money waiting for you, is a
cache written optimistically. Reconcile it against the chain *before* painting,
or you will show money that is already gone and offer a button that can only
revert after a prompt and a fee. If nothing is pending, skip the check — the
common case stays instant.

**An observer panel that reads your own ledger is not an observer.** Ours
reported that nothing had crossed the public boundary while an 800 STRK shield
sat on chain. If your product claims to show what the world sees, compute it
from public RPC the way a stranger would, or do not claim it.

---

## 7. Discipline

Three habits that would have saved more time than any single fix above.

**Change one variable at a time.** Every payload problem here was solved that
way and none were solved by reasoning about documentation.

**Verify the semantics before writing the check.** Two separate bugs were checks
written against what the contract *seemed* to do. Read the storage write.

**Record the number before the event, not after.** Applies to balances, fees and
anything you will later call a baseline.
