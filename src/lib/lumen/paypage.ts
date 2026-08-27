'use client'

/**
 * Pay pages — a shareable page that collects private payments.
 *
 * There is no server, so the page IS the link: display name, address, emoji
 * and presets travel in the URL fragment, exactly like a claim link's secret.
 * The path segment (`/pay/shariq`) is cosmetic; the fragment is the truth.
 * Nothing here is secret — a pay page deliberately publishes its owner's
 * receiving address, the same fact the Receive QR shows — but payments TO it
 * are private transfers: no public sender, amount, or link between payers.
 *
 * Two flavours share one codec:
 *   - the standing page ("pay me anything"), optionally with USD presets
 *   - a request link ("pay me exactly this"), amount locked by the sender
 */

import { TOKENS, type TokenSymbol } from '@/lib/strk20/config'
import { decodePage, encodePage } from './codec'

export interface PayPagePayload {
  v: 1
  /** Display name. */
  n: string
  /** Receiving Starknet address. */
  a: string
  /** Avatar emoji. */
  e?: string
  /** USD preset buttons for the standing page. */
  p?: number[]
  /** Request lock: exactly this token and raw amount. */
  r?: { t: TokenSymbol; a: string }
  /** Note shown under the name ("for the design work"). */
  m?: string
}

/** The owner's saved page settings, device-local. */
export interface MyPageConfig {
  name: string
  emoji: string
  presets: number[]
}

const KEY_PREFIX = 'lumen:paypage:v1:'

function configKey(account: string): string {
  try {
    return `${KEY_PREFIX}${BigInt(account).toString(16)}`
  } catch {
    return `${KEY_PREFIX}${account.trim().toLowerCase()}`
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadMyPage(account: string): MyPageConfig | null {
  const store = storage()
  if (!store) return null
  try {
    const text = store.getItem(configKey(account))
    if (!text) return null
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    if (typeof r.name !== 'string' || !r.name.trim()) return null
    return {
      name: r.name,
      emoji: typeof r.emoji === 'string' && r.emoji ? r.emoji : '🙂',
      presets: Array.isArray(r.presets)
        ? r.presets.filter((p): p is number => typeof p === 'number' && p > 0).slice(0, 3)
        : [],
    }
  } catch {
    return null
  }
}

export function saveMyPage(account: string, config: MyPageConfig): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(configKey(account), JSON.stringify(config))
  } catch {
    // Device-local convenience only; the link still works.
  }
}

/* ------------------------------------------------------------------ */
/* codec                                                               */
/* ------------------------------------------------------------------ */

/** Legacy JSON links only — new links use the compact codec. */
function fromBase64url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  return decodeURIComponent(escape(atob(padded)))
}

/** `Shariq Shaukat` → `shariq-shaukat`, for the cosmetic path segment. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
  return slug || 'me'
}

export function encodePayPage(origin: string, payload: PayPagePayload): string {
  const compact = encodePage({
    name: payload.n,
    address: payload.a,
    ...(payload.e ? { emoji: payload.e } : {}),
    ...(payload.p?.length ? { presets: payload.p } : {}),
    ...(payload.r ? { request: { token: payload.r.t, amount: BigInt(payload.r.a) } } : {}),
    ...(payload.m ? { note: payload.m } : {}),
  })
  return `${origin}/pay/${slugify(payload.n)}#${compact}`
}

export function decodePayPage(fragment: string): PayPagePayload | null {
  // Compact form first; anything minted before the codec still decodes below.
  const compact = decodePage(fragment)
  if (compact) {
    return {
      v: 1,
      n: compact.name,
      a: compact.address,
      ...(compact.emoji ? { e: compact.emoji } : {}),
      ...(compact.presets?.length ? { p: compact.presets } : {}),
      ...(compact.request
        ? { r: { t: compact.request.token, a: compact.request.amount.toString() } }
        : {}),
      ...(compact.note ? { m: compact.note } : {}),
    }
  }
  try {
    const raw: unknown = JSON.parse(fromBase64url(fragment.replace(/^#/, '')))
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Record<string, unknown>
    if (r.v !== 1) return null
    if (typeof r.n !== 'string' || !r.n.trim()) return null
    if (typeof r.a !== 'string') return null
    const address = BigInt(r.a)
    if (address <= 0n) return null

    let request: PayPagePayload['r']
    if (typeof r.r === 'object' && r.r !== null) {
      const req = r.r as Record<string, unknown>
      if (
        typeof req.t === 'string' &&
        req.t in TOKENS &&
        typeof req.a === 'string' &&
        BigInt(req.a) > 0n
      ) {
        request = { t: req.t as TokenSymbol, a: req.a }
      } else {
        return null
      }
    }

    const presets = Array.isArray(r.p)
      ? r.p
          .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
          .slice(0, 3)
      : []

    return {
      v: 1,
      n: r.n.slice(0, 40),
      a: r.a,
      ...(typeof r.e === 'string' && r.e ? { e: r.e.slice(0, 4) } : {}),
      ...(presets.length > 0 ? { p: presets } : {}),
      ...(request ? { r: request } : {}),
      ...(typeof r.m === 'string' && r.m ? { m: r.m.slice(0, 80) } : {}),
    }
  } catch {
    return null
  }
}
