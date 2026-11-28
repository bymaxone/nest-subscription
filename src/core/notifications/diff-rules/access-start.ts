/**
 * @fileoverview The rule for access that begins on an account that already holds records: an
 * entitlement that nothing gave access to before gets a grantor. It reads the two snapshots and
 * what the other rules found, and nothing else.
 * @layer core
 */
import type { ChangeKind, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { grantorCount } from './overlap'
import { purchasesOf } from './purchases'
import { rawChange, type RawChange } from './raw-change'

/** The kinds that stand in place of a `started` for their reference. */
const ANNOUNCING_KINDS: ReadonlySet<ChangeKind> = new Set([
  'started',
  'trial_converted',
  'recovered',
  'resumed'
])

/** A subscription or a purchase, as far as this rule reads it. */
interface Holding {
  readonly reference: string
  readonly givesAccess: boolean
  /** The start of the period, or the instant of the purchase. */
  readonly since: string
}

/** The subscriptions, then the purchases, a snapshot holds. */
function holdingsOf(snapshot: SubscriptionSnapshot): Holding[] {
  return [
    ...snapshot.subscriptions.map((s) => ({
      reference: s.subscriptionReference,
      givesAccess: s.givesAccess,
      since: s.currentPeriodStart
    })),
    ...purchasesOf(snapshot).map((p) => ({
      reference: p.purchaseReference,
      givesAccess: p.givesAccess,
      since: p.purchasedAt
    }))
  ]
}

/**
 * One `started` for each subscription or purchase that did not give access before and now grants
 * an entitlement that had no grantor, told apart by the start of its period or the instant of its
 * purchase. A reference that `found` already announces is left to that change. An account with no
 * record before is the business of the first-contact rules, not of this one.
 */
export function accessStartedChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot,
  found: readonly RawChange[]
): RawChange[] {
  if (previous === null) return []
  const before = holdingsOf(previous)
  if (before.length === 0) return []
  const skipped = new Set([
    ...before.filter((held) => held.givesAccess).map((held) => held.reference),
    ...found
      .filter((change) => ANNOUNCING_KINDS.has(change.kind))
      .map((change) => change.subscriptionReference)
  ])
  const begun = new Set(
    current.entitlements
      .filter((entitlement) => grantorCount(previous, entitlement.name) === 0)
      .flatMap((entitlement) => entitlement.grantingSubscriptionReferences)
  )
  return holdingsOf(current)
    .filter((holding) => begun.has(holding.reference) && !skipped.has(holding.reference))
    .map((holding) => rawChange('started', holding.reference, holding.since))
}
