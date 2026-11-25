/**
 * @fileoverview The table from a RevenueCat event type to the kind the adapter reports. Every kind
 * of the specification's Appendix A.2 has a row; a type that is not in the table is the unknown
 * kind, which still triggers a refresh because a new type must never break the receiver (FR20).
 * @layer revenuecat
 */

/** The kind reported for an event type this version does not know. It triggers a refresh. */
export const UNKNOWN_KIND = 'unknown'

/**
 * The kind reported for an event that cannot change a subscription: a test, an experiment
 * enrollment, a virtual currency transaction. It names no account, so nothing is read.
 */
export const CHANGES_NOTHING_KIND = 'changes_nothing'

/** The event types that cannot change the state of a subscription. */
const CHANGES_NOTHING = new Set(['TEST', 'EXPERIMENT_ENROLLMENT', 'VIRTUAL_CURRENCY_TRANSACTION'])

/** The event types of Appendix A.2 that can change a subscription, and the kind each reports. */
export const EVENT_KINDS: ReadonlyMap<string, string> = new Map([
  ['INITIAL_PURCHASE', 'initial_purchase'],
  ['RENEWAL', 'renewal'],
  ['CANCELLATION', 'cancellation'],
  ['UNCANCELLATION', 'uncancellation'],
  ['NON_RENEWING_PURCHASE', 'non_renewing_purchase'],
  ['SUBSCRIPTION_PAUSED', 'subscription_paused'],
  ['EXPIRATION', 'expiration'],
  ['BILLING_ISSUE', 'billing_issue'],
  ['PRODUCT_CHANGE', 'product_change'],
  ['SUBSCRIPTION_EXTENDED', 'subscription_extended'],
  ['REFUND_REVERSED', 'refund_reversed'],
  ['INVOICE_ISSUANCE', 'invoice_issuance'],
  ['TRANSFER', 'transfer'],
  ['TEMPORARY_ENTITLEMENT_GRANT', 'temporary_entitlement_grant'],
  ['PURCHASE_REDEEMED', 'purchase_redeemed'],
  ['PRICE_INCREASE_CONSENT_REQUIRED', 'price_increase_consent_required'],
  ['PRICE_INCREASE_CONSENT_APPROVED', 'price_increase_consent_approved'],
  ['SUBSCRIBER_ALIAS', 'subscriber_alias']
])

/** What the adapter does with one event type. */
export interface EventKind {
  /** The kind the notification carries. */
  readonly kind: string
  /** Whether the event names accounts to read; `false` for an event that changes nothing. */
  readonly refreshes: boolean
}

/**
 * The kind of an event type. A type that is not a string, or that this version does not know, is
 * the unknown kind and refreshes.
 */
export function kindOf(type: unknown): EventKind {
  if (typeof type !== 'string') return { kind: UNKNOWN_KIND, refreshes: true }
  if (CHANGES_NOTHING.has(type)) return { kind: CHANGES_NOTHING_KIND, refreshes: false }
  return { kind: EVENT_KINDS.get(type) ?? UNKNOWN_KIND, refreshes: true }
}
