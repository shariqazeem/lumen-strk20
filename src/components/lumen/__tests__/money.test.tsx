/**
 * Money formatting, pinned because it took the whole page down once.
 *
 * `usdText` computed `minimumFractionDigits` and `maximumFractionDigits`
 * independently, and any non-integer value over $1,000 produced a minimum above
 * the maximum. `Intl` answers that with a RangeError, which in a render path is
 * a blank screen and "a client-side exception has occurred" — not a
 * mis-rounded number.
 *
 * It sat latent while every token was priced in cents. Adding a token priced in
 * tens of thousands made typing "1" enough to trigger it.
 */

import { describe, expect, it } from 'vitest'
import { usdText } from '../bits'

describe('usdText', () => {
  it('never throws, across the range a token price can reach', () => {
    const values = [
      0, 0.004, 0.01, 1, 7.4, 99.99, 999, 999.5, 999.999, 1000, 1000.01, 1555.5,
      77_749.79, 120_000.5, 1_000_000.75,
    ]
    for (const value of values) {
      expect(() => usdText(value), `usdText(${value})`).not.toThrow()
      expect(() => usdText(-value), `usdText(${-value})`).not.toThrow()
    }
  })

  it('shows cents below a thousand and drops them above', () => {
    expect(usdText(7.4)).toBe('$7.40')
    expect(usdText(999.5)).toBe('$999.50')
    expect(usdText(1555.5)).toBe('$1,556')
    expect(usdText(77_749.79)).toBe('$77,750')
  })

  it('leaves a whole amount whole', () => {
    expect(usdText(18)).toBe('$18')
    expect(usdText(1000)).toBe('$1,000')
  })
})
