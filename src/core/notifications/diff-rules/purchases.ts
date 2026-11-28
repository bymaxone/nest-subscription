/**
 * @fileoverview The rules for non-renewing purchases (D31): one that appears is a start, one that
 * stops giving access has expired, and one that gains a refund instant is refunded. Each reads the
 * purchase records of the two snapshots and nothing else, so the existing change kinds report a
 * purchase as they report a subscription and no payload decides what changed.
 * @layer core
 */
import type {
  NonRenewingPurchaseRecord,
  SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { rawChange, type RawChange } from './raw-change'

/** The purchases a snapshot holds; a snapshot that has no list holds none. */
export function purchasesOf(
  snapshot: SubscriptionSnapshot | null
): readonly NonRenewingPurchaseRecord[] {
  return snapshot?.nonRenewingPurchases ?? []
}

/**
 * One `started` for each purchase of an account that had neither a subscription nor a purchase
 * before, told apart by when it was purchased. For any other account, `accessStartedChanges`
 * decides.
 */
export function purchaseStartedChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  if (purchasesOf(previous).length > 0 || (previous?.subscriptions.length ?? 0) > 0) return []
  return purchasesOf(current).map((purchase) =>
    rawChange('started', purchase.purchaseReference, purchase.purchasedAt)
  )
}

/**
 * For each purchase both snapshots hold: `refunded` when a refund instant appears, told apart by
 * that instant, and `expired` when it stops giving access, told apart by the end it reports.
 */
export function purchaseChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  const before = new Map(purchasesOf(previous).map((p) => [p.purchaseReference, p]))
  return purchasesOf(current).flatMap((purchase) => {
    const held = before.get(purchase.purchaseReference)
    if (held === undefined) return []
    const changes: RawChange[] = []
    if (held.refundedAt === null && purchase.refundedAt !== null) {
      changes.push(rawChange('refunded', purchase.purchaseReference, purchase.refundedAt))
    }
    if (held.givesAccess && !purchase.givesAccess) {
      changes.push(
        rawChange(
          'expired',
          purchase.purchaseReference,
          purchase.accessUntil ?? '',
          purchase.purchasedAt
        )
      )
    }
    return changes
  })
}
