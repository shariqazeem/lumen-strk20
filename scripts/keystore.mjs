/**
 * Keystore handling, shared by the deploy and relay scripts.
 *
 * The password is typed into the running process with echo off; the decrypted
 * key exists only in memory and is never written, logged or printed.
 * Ethereum keystore v3: scrypt then aes-128-ctr, with a keccak MAC that fails
 * loudly on a wrong password.
 */

import { createDecipheriv, scryptSync } from 'node:crypto'
import { keccak_256 } from '@noble/hashes/sha3'

export function askPassword(prompt) {
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

export function decryptKeystore(json, password) {
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
