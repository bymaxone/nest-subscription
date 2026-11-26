/**
 * @fileoverview Maps the status of a RevenueCat subscription into the model's closed set. The
 * table is the one of the specification's Appendix A.3, and a value it does not list is
 * `unknown`: the access decision never comes from here, only from the source's own flag.
 * @layer revenuecat
 */
import type { SubscriptionStatus } from '@bymax-one/nest-subscription/shared'

/** The statuses of the version 2 API and the model status each one maps to. */
export const STATUS_TABLE: ReadonlyMap<string, SubscriptionStatus> = new Map([
  ['trialing', 'trialing'],
  ['active', 'active'],
  ['in_grace_period', 'in_grace'],
  ['in_billing_retry', 'on_hold'],
  ['paused', 'paused'],
  ['expired', 'expired'],
  ['incomplete', 'unknown'],
  ['unknown', 'unknown']
])

/** The two statuses of a billing issue, whose model status follows the source's access flag. */
const BILLING_ISSUE = new Set(['in_grace_period', 'in_billing_retry'])

/**
 * Maps a RevenueCat status. A value the table does not list, or one that is not a string, is
 * `unknown`. A billing issue is `in_grace` when the source says the subscription gives access and
 * `on_hold` when it says it does not (FR14); the table decides only when the flag is absent.
 *
 * @param status The `status` field of the subscription, as received.
 * @param givesAccess The `gives_access` field of the subscription, as received.
 */
export function mapStatus(status: unknown, givesAccess: unknown): SubscriptionStatus {
  if (typeof status !== 'string') return 'unknown'
  if (BILLING_ISSUE.has(status) && typeof givesAccess === 'boolean') {
    return givesAccess ? 'in_grace' : 'on_hold'
  }
  return STATUS_TABLE.get(status) ?? 'unknown'
}
