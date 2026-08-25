import type { Person } from '@/lib/lumen/people'
import type { Receipt } from '@/lib/lumen/receipts'

/** Every sheet the app can present. The home surface routes; sheets render. */
export type SheetRoute =
  | { kind: 'pay'; person?: Person }
  | { kind: 'receive' }
  | { kind: 'add' }
  | { kind: 'out' }
  | { kind: 'menu' }
  | { kind: 'new-person' }
  | { kind: 'new-space' }
  | { kind: 'space'; id: string }
  | { kind: 'receipt'; receipt: Receipt }
