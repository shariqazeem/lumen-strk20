# Launch post for X

Attach the trailer (`lumen-trailer.mp4`) to the first post. The demo video
stays unlisted on YouTube and goes in the last post of the thread, for whoever
wants the long version.

Handles used: `@Starknet` and `@StarkWareLtd`. Endur is named in text rather
than tagged, because a wrong handle tags a stranger — add theirs if you know it.

---

## The post

> Shielded balances were step one. This is step two: private execution.
>
> Lumen stakes shielded Bitcoin into Endur on @Starknet mainnet without it
> ever going public.
>
> Pays anyone — even people who've never touched Starknet.
>
> On STRK20 by @StarkWareLtd. Live: lumen-strk20.vercel.app

*(Under 280. The video carries the rest.)*

---

## The thread

Reply to your own post, one at a time. Each fits in 280.

**2/**
> The problem: Endur's vault reads your public balance.
>
> Inside the pool your BTC isn't a balance, it's a commitment. Nothing to pull.
>
> So "private staking" meant unshield → stake → re-shield. Three public txs,
> matching amounts, one address. Privacy ended where yield began.

**3/**
> Lumen puts a contract between the pool and the vault.
>
> STRK20 withdraws to it, it deposits into Endur, and the xstrkBTC lands back
> inside a private note — one atomic operation.
>
> The chain sees a pool op and an amount. Not your address. Not that it's yours.

**4/**
> It also tells you when NOT to.
>
> The observatory reads the pool live, by asset, over 48h. Right now almost
> nobody is moving strkBTC — so it says so, and suggests holding STRK until you
> need it.
>
> A privacy product that argues against its own headline feature.

**5/**
> Small thing I love: type a round number and it offers 297.02 instead.
>
> Round deposits are the easiest thing to pick back out of a public record.
> Lumen fixes that before the chain can remember it.

**6/**
> Paying someone outside the pool.
>
> A privacy pool is a one-way door — only the recipient can let themselves in.
> So every Lumen link has two doors: a private note if they're in, straight to
> their wallet if they're not.
>
> Proven on mainnet into a wallet that had never joined.

**7/**
> Proof, not promises:
>
> 6 mainnet transactions
> 4 contracts
> 0 backend
>
> Every one checkable on Voyager.
>
> Repo: github.com/shariqazeem/lumen-strk20
> Demo (2:33): youtube.com/watch?v=_B7ItOfdxQg
>
> Built for the STRK20 Privacy Sprint. #Starknet #STRK20

---

## If you have X Premium — the single long post

Use this instead of the thread if you'd rather not split it. Attach the trailer.

> Shielded balances were step one. This is step two: private execution.
>
> Every STRK20 wallet can hide a balance. What none of them could do was let
> you USE that balance without it going public first. Staking shielded
> Bitcoin into Endur meant unshield → stake → re-shield: three public
> transactions with matching amounts on one address. Privacy ended exactly
> where yield began.
>
> Lumen is a private Bitcoin account on @Starknet that fixes that. A contract
> sits between the pool and Endur's vault: STRK20 withdraws to it, it deposits,
> and the xstrkBTC lands back inside a private note — one atomic operation. The
> chain sees a pool op and an amount. Not you. That's the first private stake
> into Endur on mainnet.
>
> Three more things it does that I haven't seen elsewhere:
>
> — It tells you when NOT to. The observatory reads the pool live, by asset,
> over 48 hours, and if almost nobody is moving your asset, it says so and
> suggests waiting. A privacy product that argues against its own feature.
>
> — It rewrites round numbers. Type 300, it offers 297.02, because round
> deposits are the easiest thing to pick back out of a public record.
>
> — It pays people outside the pool. A privacy pool is a one-way door — only
> the recipient can let themselves in — so every Lumen link has two doors: a
> private note if they're in, straight to their wallet if they're not. Proven
> on mainnet into a wallet that had never joined.
>
> 6 mainnet transactions. 4 contracts. 0 backend. All checkable on Voyager.
>
> Built on STRK20 by @StarkWareLtd for the Privacy Sprint.
>
> Live: lumen-strk20.vercel.app
> Repo: github.com/shariqazeem/lumen-strk20
> Demo: youtube.com/watch?v=_B7ItOfdxQg

---

## Posting notes

- **Post the trailer natively.** Upload the MP4 to X directly, never a YouTube
  link in post 1 — native video autoplays in the feed, links don't.
- **Reply to yourself immediately** with 2/ through 7/. A thread that finishes
  in the first minutes gets shown as a thread.
- **Pin it.** For the judging window, it should be the first thing on your
  profile.
- **Don't say "the only project".** Say what Lumen does and let the reader
  draw the comparison. One overclaim someone can check costs more than the
  line gains — and "first private stake into Endur on mainnet" is already the
  strongest checkable version of it.
- The tags in the post are the only two handles I'm certain of. If the Sprint
  or Endur have accounts you know, add them to post 7, not post 1 — post 1
  should read clean.
