# Demo video script — ~2:50

Speak it, don't read it. Short lines on purpose. If you fluff one, keep going —
the only thing that must be exact is the number **0.00009934**.

Have ready before you hit record:
- `/app` open, wallet connected, **hard-reloaded**
- a second tab on `voyager.online` with the stake transaction already loaded
- one claim link already minted and copied, so you never wait on a wallet on camera

---

## 0:00 — Cold open · the money card

> "This is a Bitcoin account on Starknet.
> The balance is real, it's on mainnet, and nobody can see it but me."

*(pause on the card — `strkBTC` chip visible)*

---

## 0:12 — Click **What the world sees**

> "Here's what an explorer gets.
> Private balance — nothing. Who paid me — nothing. Payment history — nothing.
> And that's not a mock-up. This panel is computed from public RPC, the same way anyone else would compute it. If it needed special access it'd prove nothing."

---

## 0:30 — **Convert**, STRK → strkBTC

> "So let's put Bitcoin in it."

*(pick STRK, type an amount, pick strkBTC — don't sign, you already did this)*

> "This swap happens inside the privacy pool. My STRK never becomes public, the Bitcoin never becomes public.
> An observer sees an executor talking to an AMM. Never me."

---

## 0:50 — **Earn on Bitcoin** — the centrepiece, slow down here

> "Now the part I think nobody else has.
> I want to earn on this Bitcoin. Endur is Starknet's liquid staking — the normal way to do it."

*(type the amount, let `You receive` populate)*

> "But Endur's vault is a normal ERC-4626 contract. It pulls tokens from your **public** balance.
> Inside the pool my Bitcoin isn't a balance — it's a commitment. There's literally nothing there for a vault to take.
> So the normal way is: unshield, deposit in public, shield again. Three public transactions, two of them matching amounts on the same address, seconds apart. Anyone reading the chain has my Bitcoin position and my identity."

*(point at the "You receive" number)*

> "Lumen deploys a contract that sits between the pool and Endur and does it in one atomic operation.
> Point one, one, one, one strkBTC in — and it quotes zero point zero zero zero nine nine three four back."

*(click Stake privately — or cut to the already-completed success screen)*

> "That's it. Staked, earning, still shielded. The chain sees one operation and an amount. Not my address, not my balance, not that it's mine."

---

## 1:45 — Cut to the Voyager tab

> "Here's that transaction on mainnet.
> It quoted zero point zero zero zero nine nine three four — and it returned zero point zero zero zero nine nine three four. Exactly.
> And as far as I can tell, that's the only shielded stake into Endur that's ever happened on Starknet."

---

## 2:05 — Back to the app · **Send a link**

> "Second thing. Paying someone."

*(open the already-minted link in a fresh window, or show the claim page)*

> "A privacy pool is a one-way door. Money inside can be sent to a stranger, but a stranger can't step in to collect it — they get an error, and no app can fix that for them.
> So every Lumen link has two doors.
> If you're already in the pool, it lands in a private note.
> If you have nothing — no wallet, no gas, not even a deployed account — it still pays you."

> "I tested that with a brand new wallet that had none of those four things. It got the money and did nothing at all."

---

## 2:35 — **Links you sent**

> "And if nobody collects, it comes home. Reclaimable, one tap. Money can't get stranded."

---

## 2:45 — Close, back on the money card

> "Six mainnet transactions, four contracts, no backend.
> Private Bitcoin you can actually earn on, and pay people with — including people who've never touched Starknet."

*(end)*

---

## If you have 30 seconds spare, add this after the stake

> "One more thing — it's not a one-way door. Unstake is right there, and it leaves as a private swap too. It never has to unshield."

## Things to avoid saying

- **"Nobody else is doing this"** — say *"as far as I can tell"* or *"the only one I could find."* One measurable overclaim costs more than the line gains.
- **"Fully anonymous"** — the amounts are public. Say *"the amount is public; who it's for isn't."*
- Don't read contract addresses aloud. They're on screen and in the README.
- Don't apologise for the small numbers. Say the amount plainly and move on — it's a real mainnet transaction, and that's the point.
