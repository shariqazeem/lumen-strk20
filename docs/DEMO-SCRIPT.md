# Demo script — 2:43, one take

Two rules that make this easy:

1. **Never say a number out loud.** The screen shows them. Numbers move between
   now and your recording, and a wrong one on camera costs more than it adds.
   Point at the screen instead — "look at that", "there it is".
2. **If something stalls, keep talking.** The script has a line for exactly that
   moment, marked ⏳. Dead air is the only real failure here.

---

## Before you press record — 15 minutes

**Everything you have is public STRK, so step 0 is shielding it.** Pool fees
come out of your *shielded* STRK, and four operations happen between here and
the end of the take. The pool charges a flat 6 STRK each, confirmed live
against `get_fee_amount` today.

Where the 334 STRK goes:

| | STRK | |
|---|---|---|
| Pool fees | 24 | shield, convert, link, stake |
| | | 18 if you skip the shield |
| Into strkBTC | 100 | the thing you stake on camera |
| Into the claim link | 25 | |
| Left public for gas | 34 | |
| Left over, shielded | ~151 | |

Nothing here is tight. If a number comes out different, you have room.

**0. Shield 300 STRK.** *Look at the STRK chip on the money card first — that
is your shielded balance. If it already reads about 150 or more, skip this step
entirely and save a fee.*

> Money card → **Add money** → **STRK** → `300` → **Add to private balance**.

The wallet asks **twice**, once to approve and once to deposit. Both are
expected, neither is a duplicate. The app may offer a tuned amount a little off
300 so the public deposit does not stand out in the record — take the tuned one,
that is the product doing its job.

Wait for it to land before the next step.

**1. Convert 100 STRK into strkBTC.** The Earn screen needs a real strkBTC
balance or it reads "Not enough" on camera. *Skip if the strkBTC chip already
shows one.*

> Money card → **Convert** → sell **STRK** → into **strkBTC** → `100` → confirm.

That is about 0.00004 strkBTC at today's rate, roughly three dollars. Small is
fine and the script never says the number out loud.

**2. Mint one claim link, in STRK.** So the claim page is ready and you never
wait on camera.

> **Send a link** → `25` STRK → **10 min** window → create → **Copy link**.

**3. Open these, in this order, and leave them open:**

- Tab 1 — `lumen-strk20.vercel.app/app`, wallet connected. **Leave it sitting
  for 30 seconds** before you record: the pool reading takes a few seconds and
  you want it already there.
- Tab 2 — the claim link, in a **private/incognito window** (this is the whole
  point: no wallet, nothing).
- Tab 3 — `voyager.online/tx/0x1c0f54bfc908796334dff47cdc6117d7591929d9329e5e833a6b76f99a10752`
  (checked today: succeeded, block 14111764)

**4. Glance at the observer view once.** Flip **What the world sees** and
scroll to **Visible on-chain** so you know which of the two it shows you: a list
of your Lumen deposits, or a card saying Lumen has published nothing. Both work
for the line you say — you just don't want to meet it for the first time on
camera. Flip back.

**5. Check one thing.** Open **Earn on Bitcoin** and confirm the grey note is
there — *"Almost nobody else is moving strkBTC right now."* If it hasn't
appeared, close the sheet, wait 20 seconds, open it again. Then close it and
start recording from the money card.

---

# The take

Every marker below is the words at a normal pace **plus** the clicking. The
core run lands at **2:43**. Voyager is optional and only if you're ahead.

---

## 0:00 · Money card

**[Sitting on the money card. `strkBTC` chip visible.]**

> "This is a Bitcoin account on Starknet. The balance is real, it's on mainnet,
> and nobody can see it but me."

---

## 0:10 · Click **What the world sees**

**[Click the toggle. Let the greyed-out card sit for a beat, then scroll to
**Visible on-chain**.]**

> "This is what an explorer gets. Balance, hidden. Who paid me, hidden.
> History, hidden. And forever — that's not a setting I can switch off.
>
> Then underneath, it lists what Lumen *did* publish. It doesn't hide its own
> footprint from me."

---

## 0:32 · **Earn on Bitcoin** — the centrepiece

**[Open Earn on Bitcoin. Type the full amount. Let "You receive" fill in.]**

> "Here's the part I think nobody else has. I want to earn on this Bitcoin.
>
> Endur is Starknet's liquid staking, but its vault pulls from your **public**
> balance — and inside the pool my Bitcoin isn't a balance, it's a commitment.
> There's nothing there to take.
>
> So normally: unshield, stake in public, shield again. Three public
> transactions that hand an observer my Bitcoin **and** my identity."

**[Point at the "You receive" number.]**

> "Lumen puts a contract between the pool and Endur and does it in one."

**[Click **Stake privately**. Confirm in the wallet. Keep talking.]**

---

## 1:19 · The observatory — say this *while it processes*

**[Point at the grey note under "You receive".]**

> "And while that goes through — the thing I'm proudest of.
>
> The app just told me **not** to do it.
>
> It reads the pool live, by asset, over two days, and right now it says Bitcoin
> has almost no company here.
>
> That's the product arguing against its own headline feature. If it only ever
> said yes, it wouldn't be measuring anything."

**⏳ Only if the wallet is still going — otherwise skip straight down:**

> "And every operation is confirmed against the chain, not the wallet's promise.
> When a wallet goes quiet, the app asks the chain instead."

**[Success screen appears.]**

> "There it is. Staked, earning, still shielded. The chain sees one operation
> and an amount — not my address, not my balance, not that it's mine."

---

## 1:58 · Tab 2 — the claim link, private window

**[Switch to the incognito window with the claim link already open.]**

> "Second thing. Paying someone.
>
> A privacy pool is a one-way door. You can send money to a stranger, but a
> stranger can't step in to collect it.
>
> So every link has two. In the pool, it lands in a private note. No wallet, no
> gas, no deployed account — it still pays you.
>
> This window has no wallet in it, and I proved that door on mainnet."

---

## 2:31 · Close

**[Back to tab 1, on the money card.]**

> "Private Bitcoin you can earn on, and pay people with — including people who
> have never touched Starknet.
>
> Six mainnet transactions, four contracts, no backend. That's Lumen."

**[Stop. — 2:43]**

---

## Optional · Tab 3 — Voyager · +20s

Only if you're clearly ahead of the markers. Slot it after the success screen,
before the claim link.

**[Switch to the Voyager tab.]**

> "Same thing earlier, on mainnet. The app quoted a number before I signed and
> the contract returned exactly that number.
>
> As far as I can tell, that's the only shielded stake into Endur that has ever
> happened."

---

# If you are running long

There is one optional beat and it's already at the end — just don't add it.
If you're past **2:00** when the success screen lands, go straight to the claim
link and finish. The stake is never cut.

# Never say

- **"Nobody is doing this."** Say *"as far as I can tell"* or *"the only one I
  could find."* One overclaim a judge can check costs more than the line gains.
- **"Fully anonymous."** Amounts are public. Say *"the amount is public; who
  it's for isn't."*
- **"That panel is computed from a public RPC."** It isn't. The greyed-out card
  is an illustration of what is knowable, and the list under it comes from
  Lumen's own ledger. The genuinely RPC-computed reading is behind **Now read
  your public address**, which is a different screen and takes about eight
  seconds — too slow for this take.
- Any specific count from the observatory. Point at it.
- Don't read contract addresses aloud.
- Don't apologise for small amounts. Say nothing about the size — it's a real
  mainnet transaction, which is the entire point.

# If the stake fails on camera

Don't stop and don't re-record. Say:

> "That one's still settling — here's the same thing from earlier, on mainnet."

Then switch to tab 3 and carry on. The Voyager receipt does the same job.

Do not retry the stake on camera. A second attempt costs another 6 STRK and,
more to the point, the first one has usually landed by then — you would be
staking twice.
