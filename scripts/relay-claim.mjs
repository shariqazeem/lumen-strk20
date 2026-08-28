/**
 * Deliver a claim on someone else's behalf.
 *
 * `claim_to_address` is ungated: the preimage is the authority, not the
 * caller. So a third party can collect a link *for* a recipient who has
 * nothing — no shielded balance, no pool registration, no gas, and not even a
 * deployed account contract. A Starknet address can receive an ERC-20 before
 * its account exists; it only needs deploying to *send*.
 *
 * That is the shape an autonomous payout service wants: the agent funds one
 * batch, then delivers each leg to a name it was given, and the recipient does
 * nothing at all until they decide to spend.
 *
 *   node scripts/relay-claim.mjs --secret 0x… --to 0x…
 *
 * The relayer's own transaction is public — it names the recipient and the
 * amount, exactly as the second door promises. It reveals nothing about who
 * funded the link: that was a pool withdrawal, and the pool names nobody.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Account, RpcProvider } from 'starknet'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const RPC = arg('rpc', 'https://rpc.starknet.lava.build:443')
const ESCROW = arg('escrow', process.env.LUMEN_ESCROW ?? '')
const SECRET = arg('secret')
const TO = arg('to')

if (!SECRET || !TO || !ESCROW) {
  console.error('Usage: node scripts/relay-claim.mjs --escrow 0x… --secret 0x… --to 0x…')
  process.exit(1)
}

const { decryptKeystore, askPassword } = await import(path.join(ROOT, 'scripts/keystore.mjs'))
const keystorePath = arg('keystore', `${process.env.HOME}/.starkli-wallets/lumen/keystore.json`)
const accountPath = arg('account', `${process.env.HOME}/.starkli-wallets/lumen/account.json`)

const password = await askPassword('Keystore password: ')
const privateKey = decryptKeystore(JSON.parse(fs.readFileSync(keystorePath, 'utf8')), password)
const address = JSON.parse(fs.readFileSync(accountPath, 'utf8')).deployment.address

const provider = new RpcProvider({ nodeUrl: RPC })
const relayer = new Account({ provider, address, signer: privateKey })

const thin = (v) => `0x${BigInt(v).toString(16)}`
const call = {
  contractAddress: thin(ESCROW),
  entrypoint: 'claim_to_address',
  calldata: [thin(SECRET), thin(TO)],
}

console.log(`relaying claim to ${thin(TO)}`)
const estimate = await relayer.estimateInvokeFee([call])
console.log(`  fee estimate ${(Number(estimate.overall_fee) / 1e18).toFixed(6)} STRK`)

const { transaction_hash } = await relayer.execute([call])
console.log(`  tx ${transaction_hash}`)
await provider.waitForTransaction(transaction_hash)
console.log('  delivered')
