/**
 * @fileoverview The closed value sets of the normalized subscription model.
 * @layer shared
 */

/**
 * The states a subscription can be in. Each member has a fixed meaning that every adapter maps
 * into. A status never decides access: the record's `givesAccess` flag, as the source reports it,
 * is the only access signal.
 */
export const SUBSCRIPTION_STATUSES = Object.freeze([
  'trialing',
  'active',
  'in_grace',
  'on_hold',
  'paused',
  'expired',
  'unknown'
] as const)

/** One of the values of {@link SUBSCRIPTION_STATUSES}. */
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** Whether, and how, a subscription will renew at the end of its current period. */
export const WILL_RENEW_VALUES = Object.freeze([
  'yes',
  'no',
  'changes_product',
  'pauses',
  'unknown'
] as const)

/** One of the values of {@link WILL_RENEW_VALUES}. */
export type WillRenew = (typeof WILL_RENEW_VALUES)[number]

/** Where a subscription was purchased. */
export const SUBSCRIPTION_ORIGINS = Object.freeze([
  'app_store',
  'play_store',
  'web',
  'promotional',
  'other'
] as const)

/** One of the values of {@link SUBSCRIPTION_ORIGINS}. */
export type SubscriptionOrigin = (typeof SUBSCRIPTION_ORIGINS)[number]

/**
 * The two environments a subscription can come from. A source reports one per subscription, so a
 * sandbox purchase is never mistaken for a production one.
 */
export const SUBSCRIPTION_ENVIRONMENTS = Object.freeze(['production', 'sandbox'] as const)

/** One of the values of {@link SUBSCRIPTION_ENVIRONMENTS}. */
export type SubscriptionEnvironment = (typeof SUBSCRIPTION_ENVIRONMENTS)[number]

/** The kinds of change the library reports after a snapshot changes and is stored. */
export const CHANGE_KINDS = Object.freeze([
  'started',
  'renewed',
  'trial_converted',
  'will_not_renew',
  'will_renew_again',
  'entered_grace',
  'put_on_hold',
  'recovered',
  'paused',
  'resumed',
  'product_changed',
  'expired',
  'refunded',
  'transferred',
  'overlap_detected'
] as const)

/** One of the values of {@link CHANGE_KINDS}. */
export type ChangeKind = (typeof CHANGE_KINDS)[number]
