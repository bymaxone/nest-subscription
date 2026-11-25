/**
 * @fileoverview The pure rule that resolves the entitlements of an account across all of its
 * subscriptions. It reads each subscription's `givesAccess` flag and `accessUntil` instant and
 * nothing else, so no status name ever decides access.
 * @layer shared
 */
import { parseInstant } from './instant'
import type { EntitlementState, SubscriptionRecord } from './snapshot.types'

/** The result of resolving the entitlements of one account. */
export interface EntitlementResolution {
  /** One state per entitlement name, in the order the names first appear. */
  readonly entitlements: readonly EntitlementState[]
  /** The names that more than one subscription gives access to, in the same order. */
  readonly overlapping: readonly string[]
}

/** When access ends in milliseconds; a lifetime grant has no end, so it is infinitely late. */
function endOf(subscription: SubscriptionRecord): number {
  return subscription.accessUntil === null
    ? Number.POSITIVE_INFINITY
    : parseInstant(subscription.accessUntil)
}

/** The subscription whose access ends last; the first of equals wins. The list is not empty. */
function latest(subscriptions: readonly SubscriptionRecord[]): SubscriptionRecord {
  return subscriptions.reduce((best, next) => (endOf(next) > endOf(best) ? next : best))
}

/** The state of one entitlement from the subscriptions that grant it. */
function stateOf(name: string, granting: readonly SubscriptionRecord[]): EntitlementState {
  const giving = granting.filter((subscription) => subscription.givesAccess)
  if (giving.length === 0) {
    const dated = granting.filter((subscription) => subscription.accessUntil !== null)
    return {
      name,
      active: false,
      until: dated.length === 0 ? null : latest(dated).accessUntil,
      grantingSubscriptionReference: null,
      grantingSubscriptionReferences: []
    }
  }
  const decisive = latest(giving)
  return {
    name,
    active: true,
    until: decisive.accessUntil,
    grantingSubscriptionReference: decisive.subscriptionReference,
    grantingSubscriptionReferences: [
      ...new Set(giving.map((subscription) => subscription.subscriptionReference))
    ].sort()
  }
}

/** The subscriptions that grant each entitlement name, in order of first appearance. */
function groupByName(
  subscriptions: readonly SubscriptionRecord[],
  grants: ReadonlyMap<string, readonly string[]>
): Map<string, SubscriptionRecord[]> {
  const byName = new Map<string, SubscriptionRecord[]>()
  for (const subscription of subscriptions) {
    for (const name of new Set(grants.get(subscription.subscriptionReference) ?? [])) {
      const list = byName.get(name)
      if (list === undefined) {
        byName.set(name, [subscription])
      } else {
        list.push(subscription)
      }
    }
  }
  return byName
}

/**
 * Resolves the entitlements of one account (FR05). An entitlement is active when any subscription
 * that grants it gives access. Its `until` is the latest `accessUntil` among the subscriptions
 * that give access, and a lifetime grant (`null`) outranks any date. An entitlement no
 * subscription gives access to is inactive and reports the latest end among its grantors, or
 * `null` when none has one. The names that more than one subscription gives access to are
 * returned as overlapping, so the host can be told. Each entitlement also lists every subscription
 * that grants it and gives access, sorted and without duplicates.
 *
 * `grants` maps a `subscriptionReference` to the entitlement names that subscription grants; a
 * subscription with no entry grants nothing. The function is pure: it reads no clock and changes
 * none of its arguments.
 *
 * @throws {SubscriptionError} when any subscription's `accessUntil` is not an ISO 8601 date.
 */
export function resolveEntitlements(
  subscriptions: readonly SubscriptionRecord[],
  grants: ReadonlyMap<string, readonly string[]>
): EntitlementResolution {
  // Every instant is checked up front, so a malformed one is refused whichever way the
  // subscription would have been ranked.
  for (const subscription of subscriptions) {
    if (subscription.accessUntil !== null) parseInstant(subscription.accessUntil)
  }
  const entitlements: EntitlementState[] = []
  const overlapping: string[] = []
  for (const [name, granting] of groupByName(subscriptions, grants)) {
    entitlements.push(stateOf(name, granting))
    if (granting.filter((subscription) => subscription.givesAccess).length > 1) {
      overlapping.push(name)
    }
  }
  return { entitlements, overlapping }
}
