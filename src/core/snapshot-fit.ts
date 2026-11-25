/**
 * @fileoverview The check every snapshot that enters from outside the library passes before it is
 * kept or trusted: it names the account that was asked for, and every instant in it can be read.
 * A snapshot that fails is never stored and never served, so what the library answers under a key
 * always names that key's account.
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'
import { parseInstant, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/** The instants of a snapshot that are present: the source's, each entitlement's and each subscription's. */
function instantsOf(snapshot: SubscriptionSnapshot): readonly string[] {
  const instants = [
    snapshot.fetchedAt,
    snapshot.sourceUpdatedAt,
    ...snapshot.entitlements.map((entitlement) => entitlement.until),
    ...snapshot.subscriptions.flatMap((subscription) => [
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
      subscription.accessUntil,
      subscription.billingIssueSince,
      subscription.cancelledAt,
      subscription.refundedAt
    ])
  ]
  return instants.filter((instant): instant is string => instant !== null)
}

/**
 * Whether a value is a snapshot of exactly the account asked for, tenant included (a missing
 * tenant on one side only is a difference), with a source name and every instant it holds one
 * `parseInstant` reads. A value of the wrong shape does not fit. This is the one rule for a
 * snapshot that comes from outside the library's own write path: a source's, a cache's or a
 * store's.
 */
export function isSnapshotFor(
  value: unknown,
  account: AccountReference
): value is SubscriptionSnapshot {
  try {
    const snapshot = value as SubscriptionSnapshot
    if (snapshot.accountId !== account.accountId || snapshot.tenantId !== account.tenantId) {
      return false
    }
    if (typeof snapshot.source !== 'string') return false
    return instantsOf(snapshot).every((instant) => Number.isFinite(parseInstant(instant)))
  } catch {
    return false
  }
}
