/**
 * Mainnet deploy, on starknet.js.
 *
 * Deploys one contract per run, named by `--contract`:
 *
 *   node contracts/deploy.mjs                        # LumenEscrow (default)
 *   node contracts/deploy.mjs --contract splitter    # LumenSplitter
 *
 * The private key is decrypted in memory from the keystore, is never written
 * anywhere, and never leaves this process.
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

/**
 * Which contract this run deploys.
 *
 * The splitter takes a fee recipient and a cap it can never exceed. Lumen
 * charges nothing, so the recipient is the zero address and the cap is zero —
 * a contract that cannot take a fee is a stronger promise than one that
 * chooses not to.
 */
const TARGETS = {
  escrow: {
    name: 'LumenEscrow',
    args: () => [POOL_ADDRESS],
    describe: () => `pool = ${POOL_ADDRESS}`,
    env: 'NEXT_PUBLIC_LUMEN_ESCROW_ADDRESS',
  },
  splitter: {
    name: 'LumenSplitter',
    args: () => [POOL_ADDRESS, '0x0', 0],
    describe: () => `pool = ${POOL_ADDRESS}, fee_recipient = 0x0, max_fee_bps = 0`,
    env: 'NEXT_PUBLIC_LUMEN_SPLITTER_ADDRESS',
  },
}

const TARGET = TARGETS[arg('contract', 'escrow')]
if (!TARGET) die(`Unknown --contract. Use one of: ${Object.keys(TARGETS).join(', ')}`)

const KEYSTORE = expand(
  arg('keystore', process.env.STARKNET_KEYSTORE || '~/.starkli-wallets/lumen/keystore.json'),
)
const ACCOUNT = expand(
  arg('account', process.env.STARKNET_ACCOUNT || '~/.starkli-wallets/lumen/account.json'),
)
const RPC = arg('rpc', process.env.STARKNET_RPC || DEFAULT_RPC)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/** Read a line from the terminal with echo suppressed. */
/** The deployer's STRK balance, in wei. Fees are paid in STRK on v3. */
async function strkBalance(provider, address) {
  const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
  const result = await provider.callContract({
    contractAddress: STRK,
    entrypoint: 'balanceOf',
    calldata: [address],
  })
  const [low, high] = result
  return BigInt(low ?? 0) + (BigInt(high ?? 0) << 128n)
}

/** STRK, for humans. */
function strk(wei) {
  return `${(Number(wei) / 1e18).toFixed(4)} STRK`
}

/** What a set of resource bounds could cost at worst. */
function ceiling(bounds) {
  let total = 0n
  for (const key of ['l1_gas', 'l2_gas', 'l1_data_gas']) {
    const b = bounds?.[key]
    if (!b) continue
    total += BigInt(b.max_amount ?? 0) * BigInt(b.max_price_per_unit ?? 0)
  }
  return total
}

/**
 * Tighten an estimate into bounds the account can actually afford.
 *
 * On a v3 transaction the account must be able to cover the *ceiling*, not the
 * likely cost, so the ceiling is what gets checked against the balance before
 * anything is signed.
 *
 * starknet.js already pads the quoted price (about 1.4x, as protection against
 * the gas price moving between estimate and inclusion), so padding it again is
 * what turns a 25 STRK ceiling into 35. Only the gas *amount* gets headroom
 * here, and only a little: consumption barely varies, and an under-bounded
 * transaction fails after paying.
 */
function tighten(estimate, headroom = 1.05) {
  const scale = (value) => (BigInt(value ?? 0) * BigInt(Math.round(headroom * 100))) / 100n
  const source = estimate?.resourceBounds ?? {}
  const bounds = {}
  for (const key of ['l1_gas', 'l2_gas', 'l1_data_gas']) {
    const b = source[key]
    if (!b) continue
    // BigInt throughout: starknet.js multiplies these internally, and a hex
    // string meeting a BigInt there throws "cannot mix BigInt and other types"
    // *after* the fee check has already passed.
    bounds[key] = {
      max_amount: scale(b.max_amount),
      // The price the network quotes already carries starknet.js's headroom;
      // padding it again is what compounds a 1.4x into a 3x.
      max_price_per_unit: BigInt(b.max_price_per_unit ?? 0),
    }
  }
  return bounds
}

/** Refuse before spending rather than after. */
function affordable(label, bounds, balance) {
  const worst = ceiling(bounds)
  console.log(dim(`     ${label} ceiling ${strk(worst)}  ·  balance ${strk(balance)}`))
  if (worst > balance) {
    die(
      `${label} could cost up to ${strk(worst)} but the deployer holds ${strk(balance)}.\n` +
        `Send at least ${strk(worst - balance)} more STRK to the deployer and run this again.`,
    )
  }
}

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
  console.log(bold(`${TARGET.name} — mainnet deploy`))
  console.log(dim(`  rpc      ${RPC}`))
  console.log(dim(`  keystore ${KEYSTORE}`))
  console.log()

  for (const file of [KEYSTORE, ACCOUNT]) {
    if (!fs.existsSync(file)) die(`Missing file: ${file}`)
  }

  const sierraPath = path.join(
    ROOT,
    `contracts/target/dev/lumen_splitter_${TARGET.name}.contract_class.json`,
  )
  const casmPath = path.join(
    ROOT,
    `contracts/target/dev/lumen_splitter_${TARGET.name}.compiled_contract_class.json`,
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

  // starknet.js v10 takes a single options object; the pre-v10 positional form
  // silently constructs a default provider and leaves address undefined.
  const account = new Account({ provider, address, signer: privateKey })

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

  if (process.argv.includes('--price-deploy-step')) {
    const probeClass = arg('probe-class', '0x7455f2335fa2fc44096af7f518b7d8f9e12bd0835ff8b735feb1ccf7e4484e6')
    const est = await account.estimateDeployFee({
      classHash: probeClass,
      constructorCalldata: CallData.compile([POOL_ADDRESS]),
    })
    console.log(dim(`     deploy-instance ceiling ${strk(ceiling(tighten(est)))}`))
    console.log(dim(`     deploy-instance estimate ${strk(est.overall_fee)}`))
    privateKey = null
    return
  }

  // --- 1. declare ---------------------------------------------------------
  console.log(`${bold(`1/4  Declaring ${TARGET.name}`)}  (costs gas)`)
  const classHash = hash.computeContractClassHash(sierra)
  console.log(dim(`     class hash ${classHash}`))

  const declared = await provider
    .getClass(classHash)
    .then(() => true)
    .catch(() => false)

  if (declared) {
    console.log('     already declared — skipping')
  } else {
    const estimate = await account.estimateDeclareFee({ contract: sierra, casm })
    if (process.argv.includes('--explain-fee')) {
      console.log(
        dim(
          `     estimate ${JSON.stringify(estimate, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
        ),
      )
    }
    const resourceBounds = tighten(estimate)
    affordable('declare', resourceBounds, await strkBalance(provider, address))
    const result = await account.declare({ contract: sierra, casm }, { resourceBounds })
    console.log(dim(`     tx ${result.transaction_hash}`))
    await provider.waitForTransaction(result.transaction_hash)
    console.log('     declared')
  }
  console.log()

  // --- 2. deploy an instance ----------------------------------------------
  console.log(`${bold('2/4  Deploying the escrow')}  (costs gas)`)
  console.log(dim(`     constructor: ${TARGET.describe()}`))
  const payload = { classHash, constructorCalldata: CallData.compile(TARGET.args()) }
  const deployEstimate = await account.estimateDeployFee(payload)
  const deployBounds = tighten(deployEstimate)
  affordable('deploy', deployBounds, await strkBalance(provider, address))
  const deployment = await account.deployContract(payload, { resourceBounds: deployBounds })
  console.log(dim(`     tx ${deployment.transaction_hash}`))
  await provider.waitForTransaction(deployment.transaction_hash)
  const escrow = deployment.contract_address
  console.log(`     escrow ${escrow}`)
  console.log()

  privateKey = null

  // --- 3. verify ----------------------------------------------------------
  console.log(bold('3/4  Verifying'))
  const readView = async (entrypoint, calldata = []) =>
    provider
      .callContract({ contractAddress: escrow, entrypoint, calldata })
      .then(readFelt)
      .catch(() => null)

  const check = (label, value, expected, note) => {
    const ok = value !== null && expected(value)
    console.log(ok ? `     ${label} — ${note}` : yellow(`     ${label} = ${value} — unexpected`))
    return ok
  }

  if (TARGET.name === 'LumenEscrow') {
    check(
      'get_outstanding(STRK)',
      await readView('get_outstanding', [STRK]),
      (v) => v === 0n,
      'a fresh escrow owes nothing',
    )
  } else {
    check(
      'pool_address',
      await readView('pool_address'),
      (v) => v === BigInt(POOL_ADDRESS),
      'wired to the real STRK20 pool',
    )
    check('fee_recipient', await readView('fee_recipient'), (v) => v === 0n, 'nobody collects')
    check('max_fee_bps', await readView('max_fee_bps'), (v) => v === 0n, 'cannot ever charge')
  }

  // The three ways a deploy silently lands wrong: a stale artifact, a class
  // that is not the one just built, and a client whose calldata no longer
  // matches the ABI. Each is invisible until money is already moving.
  const onChainClass = await provider.getClassHashAt(escrow).catch(() => null)
  if (onChainClass && BigInt(onChainClass) === BigInt(classHash)) {
    console.log('     class at address matches the local build')
  } else {
    console.log(yellow(`     class mismatch: chain says ${onChainClass}, built ${classHash}`))
  }

  const deployedAbi = await provider
    .getClassAt(escrow)
    .then((c) => (typeof c.abi === 'string' ? JSON.parse(c.abi) : c.abi))
    .catch(() => null)
  // Cairo 2 ABIs nest functions inside `interface` entries; looking only at
  // the top level finds nothing and reports "?" as if the deploy were wrong.
  const flatAbi = Array.isArray(deployedAbi)
    ? deployedAbi.flatMap((item) => (item.type === 'interface' ? (item.items ?? []) : [item]))
    : []
  const invoke = flatAbi.find((item) => item.name === 'privacy_invoke')
  const localArgs = TARGET.name === 'LumenEscrow' ? 9 : null
  if (localArgs === null) {
    // The splitter has its own shape; nothing to compare here.
  } else if (invoke?.inputs?.length === localArgs) {
    console.log(`     privacy_invoke takes ${localArgs} arguments, as the client sends`)
  } else {
    console.log(
      yellow(
        `     privacy_invoke takes ${invoke?.inputs?.length ?? '?'} arguments but the client sends ${localArgs} — every call will revert.`,
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
    .filter((line) => line && !line.startsWith(`${TARGET.env}=`))
    .join('\n')
  fs.writeFileSync(envPath, `${kept ? `${kept}\n` : ''}${TARGET.env}=${escrow}\n`)
  console.log('     .env.local updated')

  const submissionPath = path.join(ROOT, 'strk20.json')
  const submission = JSON.parse(fs.readFileSync(submissionPath, 'utf8'))
  // Replace by name rather than append: a redeploy supersedes its predecessor,
  // and a submission listing two LumenEscrows leaves a judge guessing which one
  // is live — while the older one now reverts on every call.
  submission.contracts = (submission.contracts || []).filter(
    (entry) => entry.name !== TARGET.name,
  )
  submission.contracts.push({
    name: TARGET.name,
    address: escrow,
    class_hash: classHash,
    network: 'mainnet',
  })
  fs.writeFileSync(submissionPath, `${JSON.stringify(submission, null, 2)}\n`)
  console.log('     strk20.json updated')

  console.log()
  console.log(bold('Done.'))
  console.log(`
  ${TARGET.name.padEnd(11)} ${escrow}
  Class hash  ${classHash}
  Explorer    https://voyager.online/contract/${escrow}

  Next: add this to Vercel and redeploy so it goes live in production —

    ${TARGET.env}=${escrow}
`)
}

main().catch((error) => die(`\n${error?.message || error}`))
