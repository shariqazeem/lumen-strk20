'use client'

/**
 * The wallet boundary — everything the app asks a wallet to do passes here.
 *
 * Two failures on mainnet produced this module, and both were invisible from
 * inside the actions that caused them.
 *
 * A wallet queues what it cannot show at once, so a second request raised
 * while one is open does not fail — it waits, and then appears as a prompt the
 * user has no context for, typically right after they finished the first. The
 * paths that trigger it do not look like duplicates: reading balances is a
 * wallet prompt wearing the clothes of a refresh button, and a request the app
 * has stopped *waiting* on is still live inside the wallet. Guarding each
 * caller missed both, so the lock lives here and is released when the wallet
 * answers rather than when we stop listening.
 *
 * And a wallet's promise can simply hang: the user approves and the response
 * never routes home, or they reject and nothing rejects back. Either way the
 * UI insists it is waiting while the money has already moved. So the wallet is
 * raced against the chain — the wallet is the fast path, the chain is the
 * authority — and whichever answers first ends the wait.
 */

export const WALLET_BUSY_MESSAGE =
  'Your wallet is still holding a request — finish or dismiss that one before starting another.'

export const WALLET_SILENT_MESSAGE =
  'Your wallet never answered, and the chain does not show this yet. Check the wallet — that ' +
  'request is still open in it. Reload this page once you have finished or dismissed it.'

let outstanding: Promise<unknown> | null = null

/**
 * Leave a breadcrumb when a request is turned away.
 *
 * A duplicate prompt was reported on mainnet that this app cannot account for:
 * `strk20InvokeTransaction` is a single request to the wallet, and the store
 * marks itself submitting synchronously, so a second prompt should not be
 * reachable from here. Either something is calling twice by a route not yet
 * found, or the wallet is raising the second one itself. Those look identical
 * on screen and call for opposite fixes, so the refusal says so out loud: a
 * duplicate prompt with this line in the console is ours, and a duplicate
 * prompt without it is not. Silent on the normal path.
 */
function noteRefusal(): void {
  console.info(
    '[lumen] refused a second wallet request while one was still open — ' +
      'this one came from the app, not the wallet.',
  )
}

/** Send one request to the wallet, or refuse because one is already open. */
export function walletRequest<T>(work: () => Promise<T>): Promise<T> {
  if (outstanding !== null) {
    noteRefusal()
    return Promise.reject(new Error(WALLET_BUSY_MESSAGE))
  }
  const run = work()
  const release = () => {
    outstanding = null
  }
  // Attaching handlers here also means a rejection arriving after the caller
  // stopped awaiting `run` — the raced case below — is never an unhandled one.
  outstanding = run.then(release, release)
  return run
}

/** True while the wallet still owes an answer. */
export function walletIsBusy(): boolean {
  return outstanding !== null
}

/**
 * How long to keep watching, and how often to ask.
 *
 * The window has to outlast proving plus a human reading a prompt, or the app
 * starts inventing failures for transactions that are about to succeed.
 */
export const CLAIM_WATCH_MS = 4 * 60_000
export const CLAIM_POLL_MS = 6_000

/** Resolves `'settled'` once the chain says it landed, else `null` at the deadline. */
export async function pollUntilSettled(
  settled: () => Promise<boolean>,
  deadline: number,
): Promise<'settled' | null> {
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS))
    try {
      if (await settled()) return 'settled'
    } catch {
      // A flaky RPC read is not evidence that nothing happened. Ask again.
    }
  }
  return null
}

/**
 * Wait for an answer from whichever side gives one first.
 *
 * `null` means neither did. The request is still live inside the wallet at
 * that point, so the lock stays held: a retry would queue a second prompt
 * behind the first, which is the failure this whole module exists to stop.
 */
export function raceTheChain<T>(
  work: Promise<T>,
  settled: () => Promise<boolean>,
  now: number = Date.now(),
): Promise<T | 'settled' | null> {
  return Promise.race([work, pollUntilSettled(settled, now + CLAIM_WATCH_MS)])
}
