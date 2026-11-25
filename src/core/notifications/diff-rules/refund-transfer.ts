/**
 * @fileoverview The refund and transfer rules: a subscription refunded, and an account whose
 * purchases moved to another customer of the source.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { purchasesOf } from './purchases'
import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/** `refunded` when a refund instant appears, told apart by that instant. */
export function refundChanges({ previous, current }: SubscriptionPair): RawChange[] {
  if (previous.refundedAt === null && current.refundedAt !== null) {
    return [rawChange('refunded', current.subscriptionReference, current.refundedAt)]
  }
  return []
}

/** The references of every subscription and every non-renewing purchase a snapshot holds. */
function referencesOf(snapshot: SubscriptionSnapshot): string[] {
  return [
    ...snapshot.subscriptions.map((subscription) => subscription.subscriptionReference),
    ...purchasesOf(snapshot).map((purchase) => purchase.purchaseReference)
  ]
}

/**
 * At most one `transferred` for the account: the source's customer reference changed, or
 * subscriptions or purchases the previous snapshot held are gone. It is told apart by the customer reference
 * now held and by the references that left, in sorted order, so the order of the lists is not
 * part of it. A first contact has nothing to move away from.
 */
export function transferChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  if (previous === null) return []
  const held = new Set(referencesOf(current))
  const gone = referencesOf(previous)
    .filter((reference) => !held.has(reference))
    .sort()
  const customer = current.sourceCustomer?.id
  const customerChanged =
    previous.sourceCustomer !== null && previous.sourceCustomer.id !== customer
  if (!customerChanged && gone.length === 0) return []
  return [rawChange('transferred', null, customer ?? '', ...gone)]
}
