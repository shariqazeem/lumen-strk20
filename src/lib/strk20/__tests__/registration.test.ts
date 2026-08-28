// @vitest-environment node

/**
 * Whether a recipient can receive a private transfer decides which rail the
 * composer offers, so a wrong answer here either blocks a valid payment or
 * walks someone into a revert at the wallet prompt. `unknown` exists so that
 * neither happens when the chain cannot be reached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRegistration } from '../registration'

const ok = (result: unknown) =>
  Promise.resolve({ json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) } as Response)

const ADDRESS = '0x048f5f116ba486a0799e3d7f0b6a2f1e5c8d3a9b7f4e2c1d0a9b8c7d6e5f4a3b'

describe('readRegistration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a non-zero viewing key as registered', async () => {
    vi.mocked(fetch).mockReturnValue(ok(['0x59ef1cea6730363b82a1']))
    expect(await readRegistration(ADDRESS)).toBe('registered')
  })

  it('reads zero as never registered', async () => {
    vi.mocked(fetch).mockReturnValue(ok(['0x0']))
    expect(await readRegistration(ADDRESS)).toBe('unregistered')
  })

  it('says unknown rather than guessing when the RPC fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    expect(await readRegistration(ADDRESS)).toBe('unknown')
  })

  it('says unknown on an RPC error, never "unregistered"', async () => {
    // Treating an error as "not registered" would push every payment onto a
    // claim link the moment an RPC hiccuped.
    vi.mocked(fetch).mockReturnValue(
      Promise.resolve({
        json: () => Promise.resolve({ error: { message: 'boom' } }),
      } as Response),
    )
    expect(await readRegistration(ADDRESS)).toBe('unknown')
  })

  it('does not call the chain for an address that cannot be one', async () => {
    expect(await readRegistration('not-an-address')).toBe('unknown')
    expect(await readRegistration('0x0')).toBe('unknown')
    expect(fetch).not.toHaveBeenCalled()
  })
})
