// @vitest-environment node

/**
 * Monograms replaced emoji avatars, so this is now what stands in for a face
 * everywhere in the product — worth pinning, including the cases that used to
 * render as a stray "0".
 */

import { describe, expect, it } from 'vitest'
import { initials } from '../people'

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Shariq Shaukat')).toBe('SS')
    expect(initials('Amara Nkemelu Diallo')).toBe('AD')
  })

  it('takes one letter from a single word', () => {
    expect(initials('amara')).toBe('a')
  })

  it('splits on the separators a handle uses', () => {
    expect(initials('ines_roy')).toBe('ir')
    expect(initials('jean-luc')).toBe('jl')
  })

  it('reads a name written in another script', () => {
    expect(initials('شارق شوکت')).toBe('شش')
    expect(initials('田中 太郎')).toBe('田太')
  })

  it('marks an address rather than rendering "0"', () => {
    // A pasted address is not a name; "0x…" would monogram as "0".
    expect(initials('0x0421b1fca8f3a4b2e9a1c6d80e3f1972d54ab8c0de91f2a34b56c78d90e1f234')).toBe('•')
  })

  it('falls back when there is no letter to take', () => {
    expect(initials('   ')).toBe('•')
    expect(initials('!!!')).toBe('•')
  })
})
