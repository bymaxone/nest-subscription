/**
 * @fileoverview The pure rule that resolves the entitlements of an account across all of its
 * subscriptions. It reads each subscription's `givesAccess` flag and `accessUntil` instant and
 * nothing else, so no status name ever decides access.
 * @layer shared
 */
import { parseInstant } from './instant'
import type {
  EntitlementState,
  NonRenewingPurchaseRecord,
  SubscriptionRecord
} from './snapshot.types'

/** What the resolution reads of a subscription or a non-renewing purchase that grants something. */
type Grantor = Pick<SubscriptionRecord, 'subscriptionReference' | 'givesAccess' | 'accessUntil'>

/** The grantor a non-renewing purchase is: its reference, its access flag and its end. */
function grantorOf(purchase: NonRenewingPurchaseRecord): Grantor {
  return {
    subscriptionReference: purchase.purchaseReference,
    givesAccess: purchase.givesAccess,
    accessUntil: purchase.accessUntil
  }
}

/** The result of resolving the entitlements of one account. */
export interface EntitlementResolution {
  /** One state per entitlement name, in the order the names first appear. */
  readonly entitlements: readonly EntitlementState[]
  /** The names that more than one subscription gives access to, in the same order. */
  readonly overlapping: readonly string[]
}

/** When access ends in milliseconds; a lifetime grant has no end, so it is infinitely late. */
function endOf(subscription: Grantor): number {
  return subscription.accessUntil === null
    ? Number.POSITIVE_INFINITY
    : parseInstant(subscription.accessUntil)
}

/** The subscription whose access ends last; the first of equals wins. The list is not empty. */
function latest(subscriptions: readonly Grantor[]): Grantor {
  return subscriptions.reduce((best, next) => (endOf(next) > endOf(best) ? next : best))
}

/** The state of one entitlement from the subscriptions that grant it. */
function stateOf(name: string, granting: readonly Grantor[]): EntitlementState {
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
  subscriptions: readonly Grantor[],
  grants: ReadonlyMap<string, readonly string[]>
): Map<string, Grantor[]> {
  const byName = new Map<string, Grantor[]>()
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
 * or non-renewing purchase that grants it gives access. Its `until` is the latest `accessUntil`
 * among those that give access, and a lifetime grant (`null`) outranks any date. An entitlement
 * none gives access to is inactive and reports the latest end among its grantors, or `null` when
 * none has one. The names that more than one grantor gives access to are returned as overlapping,
 * so the host can be told. Each entitlement also lists every grantor that gives access, by its
 * reference, sorted and without duplicates.
 *
 * `grants` maps a `subscriptionReference` to the entitlement names that subscription grants; a
 * subscription with no entry grants nothing. A non-renewing purchase carries the names it grants,
 * and its `purchaseReference` is listed beside the subscription references, so the references of
 * the two must come from one namespace of the source. The function is pure: it reads no clock and
 * changes none of its arguments.
 *
 * @param subscriptions The subscriptions of the account.
 * @param grants What each subscription grants, by its reference.
 * @param purchases The non-renewing purchases of the account; none when omitted.
 * @throws {SubscriptionError} when any `accessUntil` is not an ISO 8601 date.
 */
export function resolveEntitlements(
  subscriptions: readonly SubscriptionRecord[],
  grants: ReadonlyMap<string, readonly string[]>,
  purchases: readonly NonRenewingPurchaseRecord[] = []
): EntitlementResolution {
  const grantors: readonly Grantor[] = [...subscriptions, ...purchases.map(grantorOf)]
  const granted = new Map([
    ...grants,
    ...purchases.map((purchase): [string, readonly string[]] => [
      purchase.purchaseReference,
      purchase.entitlementNames
    ])
  ])
  // Every instant is checked up front, so a malformed one is refused whichever way the
  // grantor would have been ranked.
  for (const grantor of grantors) {
    if (grantor.accessUntil !== null) parseInstant(grantor.accessUntil)
  }
  const entitlements: EntitlementState[] = []
  const overlapping: string[] = []
  for (const [name, granting] of groupByName(grantors, granted)) {
    entitlements.push(stateOf(name, granting))
    if (granting.filter((grantor) => grantor.givesAccess).length > 1) {
      overlapping.push(name)
    }
  }
  return { entitlements, overlapping }
}
