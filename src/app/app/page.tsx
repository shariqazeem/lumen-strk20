'use client'

/**
 * The Lumen app: one home surface, one sheet at a time.
 *
 * Routing is a single `SheetRoute | null`. Sheets stay mounted through their
 * exit animation (the Sheet primitive handles deferral), so the page just
 * flips the route and lets everything glide.
 */

import { useState } from 'react'
import { useLumen } from '@/lib/lumen/store'
import type { Person } from '@/lib/lumen/people'
import type { Receipt } from '@/lib/lumen/receipts'
import type { SheetRoute } from '@/components/lumen/routes'
import { ConnectScreen } from '@/components/lumen/connect'
import { Home } from '@/components/lumen/home'
import { PaySheet } from '@/components/lumen/pay-sheet'
import { ReceiveSheet } from '@/components/lumen/receive-sheet'
import { AddMoneySheet } from '@/components/lumen/add-money-sheet'
import { CashOutSheet } from '@/components/lumen/cash-out-sheet'
import { ReceiptSheet } from '@/components/lumen/receipt-sheet'
import { PersonSheet } from '@/components/lumen/person-sheet'
import { MenuSheet } from '@/components/lumen/menu-sheet'
import { NewSpaceSheet, SpaceSheet } from '@/components/lumen/space-sheets'
import { LinksSheet } from '@/components/lumen/links-sheet'
import { MyPageSheet } from '@/components/lumen/my-page-sheet'
import { ConvertSheet } from '@/components/lumen/convert-sheet'
import { JournalSheet } from '@/components/lumen/journal-sheet'

export default function AppPage() {
  const status = useLumen((state) => state.status)
  const [route, setRoute] = useState<SheetRoute | null>(null)


  // Sheets keep their last payload while animating out.
  const [payPerson, setPayPerson] = useState<Person | undefined>(undefined)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [payNonce, setPayNonce] = useState(0)

  const open = (next: SheetRoute) => {
    if (next.kind === 'pay') {
      setPayPerson(next.person)
      setPayNonce((n) => n + 1)
    }
    if (next.kind === 'receipt') setReceipt(next.receipt)
    if (next.kind === 'space') setSpaceId(next.id)
    setRoute(next)
  }

  const close = () => setRoute(null)

  if (status !== 'connected') {
    return <ConnectScreen />
  }

  return (
    <>
      <Home open={open} />

      <PaySheet
        key={payNonce}
        open={route?.kind === 'pay'}
        onClose={close}
        {...(payPerson ? { person: payPerson } : {})}
        onReceipt={(created) => open({ kind: 'receipt', receipt: created })}
        onNewPerson={() => open({ kind: 'new-person' })}
      />
      <ReceiveSheet
        open={route?.kind === 'receive'}
        onClose={close}
        onMyPage={() => open({ kind: 'my-page' })}
      />
      <MyPageSheet open={route?.kind === 'my-page'} onClose={close} />
      <ConvertSheet open={route?.kind === 'convert'} onClose={close} />
      <JournalSheet open={route?.kind === 'journal'} onClose={close} />
      <AddMoneySheet open={route?.kind === 'add'} onClose={close} />
      <CashOutSheet open={route?.kind === 'out'} onClose={close} />
      <ReceiptSheet open={route?.kind === 'receipt'} onClose={close} receipt={receipt} />
      <PersonSheet open={route?.kind === 'new-person'} onClose={close} />
      <NewSpaceSheet open={route?.kind === 'new-space'} onClose={close} />
      <SpaceSheet open={route?.kind === 'space'} onClose={close} spaceId={spaceId} />
      <LinksSheet open={route?.kind === 'links'} onClose={close} />
      <MenuSheet
        open={route?.kind === 'menu'}
        onClose={close}
        onCashOut={() => open({ kind: 'out' })}
        onLinks={() => open({ kind: 'links' })}
        onMyPage={() => open({ kind: 'my-page' })}
        onConvert={() => open({ kind: 'convert' })}
      />
    </>
  )
}
