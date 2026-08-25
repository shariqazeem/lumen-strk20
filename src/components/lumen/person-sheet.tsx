'use client'

/**
 * Add a person. Name + address, one screen. The privacy boundary framing is
 * stated once, plainly: relationships are kept apart automatically.
 */

import { useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import { looksLikeStarknetAddress, pickEmoji } from '@/lib/lumen/people'
import { Sheet } from './sheet'
import { Avatar } from './bits'

export function PersonSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addPerson } = useLumen()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  const valid = name.trim().length > 0 && looksLikeStarknetAddress(address)

  const save = () => {
    if (!valid) return
    addPerson({ name, address })
    setName('')
    setAddress('')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a person">
      <div className="flex justify-center py-3">
        <Avatar emoji={name.trim() ? pickEmoji(name.trim()) : '🙂'} size={64} />
      </div>

      <div className="space-y-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 40))}
          placeholder="Name"
          autoFocus
          className="h-12 w-full rounded-2xl border border-rule bg-card px-4 text-[15px] outline-none focus:border-rule-strong"
        />
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Their address 0x…"
          spellCheck={false}
          className="h-12 w-full rounded-2xl border border-rule bg-card px-4 font-mono text-[13px] outline-none focus:border-rule-strong"
        />
      </div>

      <p className="mt-4 px-1 text-[12.5px] leading-relaxed text-ink-faint">
        Saved on this device only. Lumen keeps each relationship inside its own privacy boundary —
        nothing you do with one person can be tied to another.
      </p>

      <button onClick={save} disabled={!valid} className="btn btn-ink mt-5 w-full">
        Save
      </button>
    </Sheet>
  )
}
