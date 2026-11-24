/**
 * @fileoverview The normalized subscription snapshot: one per account, the same shape for every
 * source. Instants are ISO 8601 strings and "not applicable" is `null`.
 * @layer shared
 */
import type {
  SubscriptionEnvironment,
  SubscriptionOrigin,
  SubscriptionStatus,
  WillRenew
} from './values'

/** How the source names the account. The library never interprets the value. */
export interface SourceCustomerReference {
  /** The identifier the source uses for this customer. */
  readonly id: string
}

/** One subscription of an account, as the source reports it. */
export interface SubscriptionRecord {
  /** Stable reference of this subscription, as named by the source. */
  readonly subscriptionReference: string
  /** The state the subscription is in. It never decides access; see `givesAccess`. */
  readonly status: SubscriptionStatus
  /** Whether the source says this subscription gives access. The guard reads this flag only. */
  readonly givesAccess: boolean
  /** Whether, and how, it renews at the end of the period. */
  readonly willRenew: WillRenew
  /** Where it was purchased. */
  readonly origin: SubscriptionOrigin
  /** Whether it is a production or a sandbox purchase. */
  readonly environment: SubscriptionEnvironment
  /** The product, as named by the source. */
  readonly productReference: string
  /** The billing interval, as named by the source. */
  readonly billingInterval: string
  /** Start of the current period. */
  readonly currentPeriodStart: string
  /** End of the current period. */
  readonly currentPeriodEnd: string
  /** The instant access ends if nothing else happens; `null` for a lifetime grant. */
  readonly accessUntil: string | null
  /** Since when a billing issue is open; `null` when none is. */
  readonly billingIssueSince: string | null
  /** When it was cancelled; `null` when it was not. */
  readonly cancelledAt: string | null
  /** When it was refunded; `null` when it was not. */
  readonly refundedAt: string | null
  /** Where the person manages it, when the source provides one; `null` otherwise. */
  readonly managementReference: string | null
}

/** One named right of an account and whether it is active now. */
export interface EntitlementState {
  /** The entitlement's name. */
  readonly name: string
  /** Whether it is active now. */
  readonly active: boolean
  /** Until when it is active; `null` when it has no end. */
  readonly until: string | null
  /** The `subscriptionReference` of the subscription that grants it; `null` when none does. */
  readonly grantingSubscriptionReference: string | null
}

/** The whole normalized state of one account. */
export interface SubscriptionSnapshot {
  /** The account this state belongs to. */
  readonly accountId: string
  /** The tenant of the account, when the host is multi-tenant. */
  readonly tenantId?: string
  /** The entitlements of the account. */
  readonly entitlements: readonly EntitlementState[]
  /** The subscriptions of the account, usually one. */
  readonly subscriptions: readonly SubscriptionRecord[]
  /** The name of the source that produced this snapshot. */
  readonly source: string
  /** How the source names the account. */
  readonly sourceCustomer: SourceCustomerReference
  /** When the library read the source. */
  readonly fetchedAt: string
  /** How fresh the source says its data is; `null` when it does not say. */
  readonly sourceUpdatedAt: string | null
}
