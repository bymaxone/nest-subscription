/**
 * @fileoverview The overlap rule: an entitlement that more than one subscription grants and gives
 * access to, where before at most one did. It reads the grantors each snapshot records for each
 * entitlement and nothing else.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { rawChange, type RawChange } from './raw-change'

/** How many subscriptions granted the named entitlement and gave access in a snapshot. */
export function grantorCount(snapshot: SubscriptionSnapshot | null, name: string): number {
  const held = snapshot?.entitlements.find((entitlement) => entitlement.name === name)
  return held?.grantingSubscriptionReferences.length ?? 0
}

/**
 * One `overlap_detected` for each entitlement that has two or more grantors now and had at most
 * one before, in the order of the entitlements of `current`. It is told apart by the entitlement's
 * name and its grantors, which the snapshot keeps sorted. Two subscriptions that grant different
 * entitlements never overlap.
 */
export function overlapChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  return current.entitlements
    .filter(
      (entitlement) =>
        entitlement.grantingSubscriptionReferences.length >= 2 &&
        grantorCount(previous, entitlement.name) <= 1
    )
    .map((entitlement) =>
      rawChange(
        'overlap_detected',
        null,
        entitlement.name,
        ...entitlement.grantingSubscriptionReferences
      )
    )
}
