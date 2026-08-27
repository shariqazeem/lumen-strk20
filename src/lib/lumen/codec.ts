'use client'

/**
 * Compact link encoding.
 *
 * Everything a link needs travels in the URL fragment, so the fragment's
 * length is the product's shareability. JSON was costing three ways at once:
 * key names, quoting, and a 66-character hex address — then base64 added
 * another third on top. A pay page came out near 190 characters of noise.
 *
 * This packs the same payload as bytes:
 *
 *   - the address and the claim secret are raw bytes, not hex text
 *   - the token is a one-byte index into our own list, not an address
 *   - amounts are length-prefixed big-endian, so an 18-decimal balance fits
 *     without forcing every link to carry 32 bytes
 *   - optional fields cost one flag bit when absent, not a key and two quotes
 *
 * Result is roughly a third of the old length. Old JSON links still decode —
 * `decodeLegacy` in the callers handles anything minted before this.
 */

import { TOKEN_LIST, type TokenSymbol } from '@/lib/strk20/config'

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

class Writer {
  private bytes: number[] = []

  u8(value: number): void {
    this.bytes.push(value & 0xff)
  }

  /** Fixed-width big-endian felt bytes, left-padded. */
  felt(value: string, width: number): void {
    let big = BigInt(value)
    const out = new Array<number>(width).fill(0)
    for (let i = width - 1; i >= 0; i -= 1) {
      out[i] = Number(big & 0xffn)
      big >>= 8n
    }
    this.bytes.push(...out)
  }

  /** 1-byte length, then bytes. Values longer than 255 bytes are truncated. */
  varbytes(data: Uint8Array): void {
    const slice = data.subarray(0, 255)
    this.u8(slice.length)
    this.bytes.push(...slice)
  }

  varstr(text: string): void {
    this.varbytes(new TextEncoder().encode(text))
  }

  /** A bigint as the fewest bytes that hold it. */
  varnum(value: bigint): void {
    if (value <= 0n) {
      this.u8(0)
      return
    }
    const out: number[] = []
    let big = value
    while (big > 0n) {
      out.unshift(Number(big & 0xffn))
      big >>= 8n
    }
    this.varbytes(Uint8Array.from(out))
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

class Reader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.bytes.length) throw new Error('truncated')
    return this.bytes[this.offset++]
  }

  /**
   * Returns the canonical zero-padded form. Dropping leading zeros would give
   * the same felt but a different string, which breaks exact round-trips and
   * surprises anything comparing addresses as text.
   */
  felt(width: number): string {
    if (this.offset + width > this.bytes.length) throw new Error('truncated')
    let big = 0n
    for (let i = 0; i < width; i += 1) big = (big << 8n) | BigInt(this.bytes[this.offset++])
    return `0x${big.toString(16).padStart(width * 2, '0')}`
  }

  varbytes(): Uint8Array {
    const length = this.u8()
    if (this.offset + length > this.bytes.length) throw new Error('truncated')
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  varstr(): string {
    return new TextDecoder().decode(this.varbytes())
  }

  varnum(): bigint {
    const raw = this.varbytes()
    let big = 0n
    for (const byte of raw) big = (big << 8n) | BigInt(byte)
    return big
  }
}

function toBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Addresses compare as text all over the app, so re-pad to the canonical form. */
function canonicalAddress(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`
}

/** Token index in our own list — one byte instead of a 66-character address. */
function tokenIndex(symbol: TokenSymbol): number {
  const index = TOKEN_LIST.findIndex((token) => token.symbol === symbol)
  if (index < 0) throw new Error(`Unknown token: ${symbol}`)
  return index
}

function tokenAt(index: number): TokenSymbol {
  const token = TOKEN_LIST[index]
  if (!token) throw new Error(`Unknown token index: ${index}`)
  return token.symbol
}

/* ------------------------------------------------------------------ */
/* claim links                                                         */
/* ------------------------------------------------------------------ */

export interface CompactClaim {
  secret: string
  token: TokenSymbol
  amount: bigint
  from?: string
  note?: string
}

const CLAIM_VERSION = 1
const FLAG_FROM = 1 << 0
const FLAG_NOTE = 1 << 1

export function encodeClaim(payload: CompactClaim): string {
  const writer = new Writer()
  writer.u8(CLAIM_VERSION)
  writer.u8((payload.from ? FLAG_FROM : 0) | (payload.note ? FLAG_NOTE : 0))
  // Secrets are 248-bit by construction, so 31 bytes always suffice.
  writer.felt(payload.secret, 31)
  writer.u8(tokenIndex(payload.token))
  writer.varnum(payload.amount)
  if (payload.from) writer.varstr(payload.from.slice(0, 40))
  if (payload.note) writer.varstr(payload.note.slice(0, 80))
  return toBase64url(writer.finish())
}

export function decodeClaim(fragment: string): CompactClaim | null {
  try {
    const reader = new Reader(fromBase64url(fragment.replace(/^#/, '')))
    if (reader.u8() !== CLAIM_VERSION) return null
    const flags = reader.u8()
    const secret = reader.felt(31)
    const token = tokenAt(reader.u8())
    const amount = reader.varnum()
    if (BigInt(secret) <= 0n || amount <= 0n) return null
    return {
      secret,
      token,
      amount,
      ...(flags & FLAG_FROM ? { from: reader.varstr() } : {}),
      ...(flags & FLAG_NOTE ? { note: reader.varstr() } : {}),
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* pay pages                                                           */
/* ------------------------------------------------------------------ */

export interface CompactPage {
  name: string
  address: string
  emoji?: string
  /** USD preset buttons, whole dollars. */
  presets?: number[]
  /** A locked request: exactly this token and raw amount. */
  request?: { token: TokenSymbol; amount: bigint }
  note?: string
}

const PAGE_VERSION = 1
const PAGE_EMOJI = 1 << 0
const PAGE_PRESETS = 1 << 1
const PAGE_REQUEST = 1 << 2
const PAGE_NOTE = 1 << 3

export function encodePage(payload: CompactPage): string {
  const writer = new Writer()
  writer.u8(PAGE_VERSION)
  writer.u8(
    (payload.emoji ? PAGE_EMOJI : 0) |
      (payload.presets?.length ? PAGE_PRESETS : 0) |
      (payload.request ? PAGE_REQUEST : 0) |
      (payload.note ? PAGE_NOTE : 0),
  )
  // Variable width: every Starknet address is under 2^252, so the top byte is
  // always zero, and many have longer zero runs. Fixed 32 bytes paid for all
  // of them.
  writer.varnum(BigInt(payload.address))
  writer.varstr(payload.name.slice(0, 40))
  if (payload.emoji) writer.varstr(payload.emoji.slice(0, 8))
  if (payload.presets?.length) {
    const presets = payload.presets.slice(0, 3)
    writer.u8(presets.length)
    for (const preset of presets) writer.varnum(BigInt(Math.max(0, Math.round(preset))))
  }
  if (payload.request) {
    writer.u8(tokenIndex(payload.request.token))
    writer.varnum(payload.request.amount)
  }
  if (payload.note) writer.varstr(payload.note.slice(0, 80))
  return toBase64url(writer.finish())
}

export function decodePage(fragment: string): CompactPage | null {
  try {
    const reader = new Reader(fromBase64url(fragment.replace(/^#/, '')))
    if (reader.u8() !== PAGE_VERSION) return null
    const flags = reader.u8()
    const address = canonicalAddress(reader.varnum())
    const name = reader.varstr()
    if (BigInt(address) <= 0n || !name.trim()) return null

    const emoji = flags & PAGE_EMOJI ? reader.varstr() : undefined

    let presets: number[] | undefined
    if (flags & PAGE_PRESETS) {
      const count = reader.u8()
      presets = []
      for (let i = 0; i < count; i += 1) presets.push(Number(reader.varnum()))
      presets = presets.filter((value) => Number.isFinite(value) && value > 0)
    }

    let request: CompactPage['request']
    if (flags & PAGE_REQUEST) {
      const token = tokenAt(reader.u8())
      const amount = reader.varnum()
      if (amount <= 0n) return null
      request = { token, amount }
    }

    const note = flags & PAGE_NOTE ? reader.varstr() : undefined

    return {
      name,
      address,
      ...(emoji ? { emoji } : {}),
      ...(presets?.length ? { presets } : {}),
      ...(request ? { request } : {}),
      ...(note ? { note } : {}),
    }
  } catch {
    return null
  }
}
