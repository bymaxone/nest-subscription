/**
 * @fileoverview The check every snapshot a source returns passes before the library keeps it: it
 * names the account that was asked for, and every instant in it can be read. A snapshot that fails
 * is never stored, so what is stored under a key always names that key's account.
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
 * Whether the snapshot names exactly the account asked for, tenant included (a missing tenant on
 * one side only is a difference), and every instant it holds is one `parseInstant` reads. A value
 * of the wrong shape counts as not fitting.
 */
export function isSnapshotFor(snapshot: SubscriptionSnapshot, account: AccountReference): boolean {
  try {
    if (snapshot.accountId !== account.accountId || snapshot.tenantId !== account.tenantId) {
      return false
    }
    return instantsOf(snapshot).every((instant) => Number.isFinite(parseInstant(instant)))
  } catch {
    return false
  }
}
