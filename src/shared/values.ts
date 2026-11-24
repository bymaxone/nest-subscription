/**
 * @fileoverview The closed value sets of the normalized subscription model.
 * @layer shared
 */

/**
 * The two environments a subscription can come from. A source reports one per subscription, so a
 * sandbox purchase is never mistaken for a production one.
 */
export const SUBSCRIPTION_ENVIRONMENTS = Object.freeze(['production', 'sandbox'] as const)

/** One of the values of {@link SUBSCRIPTION_ENVIRONMENTS}. */
export type SubscriptionEnvironment = (typeof SUBSCRIPTION_ENVIRONMENTS)[number]
