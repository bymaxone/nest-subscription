/**
 * @fileoverview The overlap rule: more than one subscription gives access at once, and did not
 * before.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { rawChange, type RawChange } from './raw-change'

/** The references of the subscriptions that give access, sorted. It reads the access flag only. */
function givingAccess(snapshot: SubscriptionSnapshot | null): string[] {
  return (snapshot?.subscriptions ?? [])
    .filter((subscription) => subscription.givesAccess)
    .map((subscription) => subscription.subscriptionReference)
    .sort()
}

/**
 * `overlap_detected` when two or more subscriptions give access now and at most one did before.
 * The snapshot does not say which entitlement each subscription grants, so any two subscriptions
 * that give access count as overlapping. It is told apart by the references that overlap.
 */
export function overlapChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  const now = givingAccess(current)
  if (now.length < 2 || givingAccess(previous).length >= 2) return []
  return [rawChange('overlap_detected', null, ...now)]
}
