/**
 * LumenEscrow — mainnet deploy, on starknet.js.
 *
 * Replaces the starkli path, which is unusable today: starkli 0.4.2 is the
 * latest release and still asks for the `pending` block tag, which mainnet
 * removed in favour of `pre_confirmed`. Every starkli call fails with
 * "unknown block tag 'pending'". starknet.js 10.4.0 speaks the current spec.
 *
 * Key handling: the starkli keystore is a standard Ethereum v3 file (scrypt +
 * aes-128-ctr). The password is typed into THIS process at run time with echo
 * off; the decrypted key exists only in memory, is never written, logged or
 * printed, and the buffer is zeroed as soon as the deploy finishes.
 *
 * Usage:
 *   node contracts/deploy.mjs
 *     [--keystore ~/.starkli-wallets/lumen/keystore.json]
 *     [--account  ~/.starkli-wallets/lumen/account.json]
 *     [--rpc      https://rpc.starknet.lava.build:443]
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { scryptSync, createDecipheriv } from 'node:crypto'
import { keccak_256 } from '@noble/hashes/sha3'
import { Account, CallData, RpcProvider, hash } from 'starknet'

const POOL_ADDRESS = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const DEFAULT_RPC = 'https://rpc.starknet.lava.build:443'

const ESC = String.fromCharCode(27)
const bold = (s) => `${ESC}[1m${s}${ESC}[0m`
const dim = (s) => `${ESC}[2m${s}${ESC}[0m`
const yellow = (s) => `${ESC}[33m${s}${ESC}[0m`

function die(message) {
  console.error(`${ESC}[31m${message}${ESC}[0m`)
  process.exit(1)
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const expand = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)

const KEYSTORE = expand(
  arg('keystore', process.env.STARKNET_KEYSTORE || '~/.starkli-wallets/lumen/keystore.json'),
)
const ACCOUNT = expand(
  arg('account', process.env.STARKNET_ACCOUNT || '~/.starkli-wallets/lumen/account.json'),
)
const RPC = arg('rpc', process.env.STARKNET_RPC || DEFAULT_RPC)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/** Read a line from the terminal with echo suppressed. */
function askPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData)
          if (stdin.isTTY) stdin.setRawMode(wasRaw)
          stdin.pause()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '') {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

/** Decrypt an Ethereum keystore v3. Returns the private key as 0x-hex. */
function decryptKeystore(json, password) {
  const c = json.crypto || json.Crypto
  if (!c) throw new Error('Not a keystore file: no crypto section.')
  if (c.kdf !== 'scrypt') throw new Error(`Unsupported kdf: ${c.kdf}`)

  const { n, r, p, dklen, salt } = c.kdfparams
  const derived = scryptSync(Buffer.from(password, 'utf8'), Buffer.from(salt, 'hex'), dklen, {
    N: n,
    r,
    p,
    maxmem: 1024 * 1024 * 1024,
  })

  const ciphertext = Buffer.from(c.ciphertext, 'hex')
  // MAC = keccak256(derivedKey[16:32] || ciphertext). A wrong password fails here.
  const mac = Buffer.from(
    keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext])),
  ).toString('hex')
  if (mac !== String(c.mac).toLowerCase()) {
    derived.fill(0)
    throw new Error('Wrong password.')
  }

  const decipher = createDecipheriv(
    'aes-128-ctr',
    derived.subarray(0, 16),
    Buffer.from(c.cipherparams.iv, 'hex'),
  )
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  derived.fill(0)
  const key = `0x${plain.toString('hex')}`
  plain.fill(0)
  return key
}

const readFelt = (result) => BigInt(Array.isArray(result) ? result[0] : result.result[0])

async function main() {
  console.log()
  console.log(bold('LumenEscrow — mainnet deploy'))
  console.log(dim(`  rpc      ${RPC}`))
  console.log(dim(`  keystore ${KEYSTORE}`))
  console.log()

  for (const file of [KEYSTORE, ACCOUNT]) {
    if (!fs.existsSync(file)) die(`Missing file: ${file}`)
  }

  const sierraPath = path.join(
    ROOT,
    'contracts/target/dev/lumen_splitter_LumenEscrow.contract_class.json',
  )
  const casmPath = path.join(
    ROOT,
    'contracts/target/dev/lumen_splitter_LumenEscrow.compiled_contract_class.json',
  )
  for (const file of [sierraPath, casmPath]) {
    if (!fs.existsSync(file)) {
      die(`Missing build artifact: ${file}\nRun: (cd contracts && scarb build)`)
    }
  }

  const sierra = JSON.parse(fs.readFileSync(sierraPath, 'utf8'))
  const casm = JSON.parse(fs.readFileSync(casmPath, 'utf8'))
  const accountCfg = JSON.parse(fs.readFileSync(ACCOUNT, 'utf8'))
  const keystore = JSON.parse(fs.readFileSync(KEYSTORE, 'utf8'))

  const password = await askPassword('Keystore password: ')
  let privateKey
  try {
    privateKey = decryptKeystore(keystore, password)
  } catch (error) {
    die(error.message)
  }

  const provider = new RpcProvider({ nodeUrl: RPC })
  const publicKey = accountCfg.variant.public_key
  const accountClassHash = accountCfg.deployment.class_hash
  const salt = accountCfg.deployment.salt
  const constructorCalldata = CallData.compile([publicKey])
  const address =
    accountCfg.deployment.address ||
    hash.calculateContractAddressFromHash(salt, accountClassHash, constructorCalldata, 0)

  console.log(dim(`  deployer ${address}`))
  console.log()

  const account = new Account(provider, address, privateKey)

  // --- 0. the deployer account itself -------------------------------------
  const alreadyLive = await provider
    .getClassHashAt(address)
    .then(() => true)
    .catch(() => false)

  if (!alreadyLive) {
    console.log(`${bold('0/4  Deploying the deployer account')}  (costs gas)`)
    const balance = await provider
      .callContract({ contractAddress: STRK, entrypoint: 'balanceOf', calldata: [address] })
      .then(readFelt)
      .catch(() => 0n)
    console.log(dim(`     balance ${(Number(balance) / 1e18).toFixed(4)} STRK`))
    if (balance === 0n) die('     The deployer holds no STRK. Fund it and re-run.')

    const result = await account.deployAccount({
      classHash: accountClassHash,
      constructorCalldata,
      addressSalt: salt,
      contractAddress: address,
    })
    console.log(dim(`     tx ${result.transaction_hash}`))
    await provider.waitForTransaction(result.transaction_hash)
    console.log(`     account live at ${result.contract_address}`)

    accountCfg.deployment = {
      status: 'deployed',
      class_hash: accountClassHash,
      salt,
      address,
    }
    fs.writeFileSync(ACCOUNT, `${JSON.stringify(accountCfg, null, 2)}\n`)
    console.log()
  } else {
    console.log(dim('     deployer account already deployed'))
    console.log()
  }

  // --- 1. declare ---------------------------------------------------------
  console.log(`${bold('1/4  Declaring LumenEscrow')}  (costs gas)`)
  const classHash = hash.computeContractClassHash(sierra)
  console.log(dim(`     class hash ${classHash}`))

  const declared = await provider
    .getClass(classHash)
    .then(() => true)
    .catch(() => false)

  if (declared) {
    console.log('     already declared — skipping')
  } else {
    const result = await account.declare({ contract: sierra, casm })
    console.log(dim(`     tx ${result.transaction_hash}`))
    await provider.waitForTransaction(result.transaction_hash)
    console.log('     declared')
  }
  console.log()

  // --- 2. deploy an instance ----------------------------------------------
  console.log(`${bold('2/4  Deploying the escrow')}  (costs gas)`)
  console.log(dim(`     constructor: pool = ${POOL_ADDRESS}`))
  const deployment = await account.deployContract({
    classHash,
    constructorCalldata: CallData.compile([POOL_ADDRESS]),
  })
  console.log(dim(`     tx ${deployment.transaction_hash}`))
  await provider.waitForTransaction(deployment.transaction_hash)
  const escrow = deployment.contract_address
  console.log(`     escrow ${escrow}`)
  console.log()

  privateKey = null

  // --- 3. verify ----------------------------------------------------------
  console.log(bold('3/4  Verifying'))
  const outstanding = await provider
    .callContract({ contractAddress: escrow, entrypoint: 'get_outstanding', calldata: [STRK] })
    .then(readFelt)
    .catch(() => null)

  if (outstanding === 0n) {
    console.log('     get_outstanding(STRK) = 0  — a fresh escrow owes nothing')
  } else {
    console.log(
      yellow(
        `     get_outstanding(STRK) = ${outstanding} — expected 0. Do not route value through this instance.`,
      ),
    )
  }
  console.log()

  // --- 4. wire it in ------------------------------------------------------
  console.log(bold('4/4  Wiring it into the app'))
  const envPath = path.join(ROOT, '.env.local')
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const kept = existing
    .split('\n')
    .filter((line) => line && !line.startsWith('NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS='))
    .join('\n')
  fs.writeFileSync(envPath, `${kept ? `${kept}\n` : ''}NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=${escrow}\n`)
  console.log('     .env.local updated')

  const submissionPath = path.join(ROOT, 'strk20.json')
  const submission = JSON.parse(fs.readFileSync(submissionPath, 'utf8'))
  submission.contracts = submission.contracts || []
  if (!submission.contracts.some((entry) => (entry.address || entry) === escrow)) {
    submission.contracts.push({
      name: 'LumenEscrow',
      address: escrow,
      class_hash: classHash,
      network: 'mainnet',
    })
  }
  fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`)
  console.log('     strk20.json updated')

  console.log()
  console.log(bold('Done.'))
  console.log(`
  Escrow      ${escrow}
  Class hash  ${classHash}
  Explorer    https://voyager.online/contract/${escrow}

  Next: add this to Vercel and redeploy so claim links go live in production —

    NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS=${escrow}
`)
}

main().catch((error) => die(`\n${error?.message || error}`))
