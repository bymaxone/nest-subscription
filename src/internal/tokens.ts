/**
 * @fileoverview The injection tokens of the module. They live in the internal bundle so every
 * entry point resolves the same symbols.
 * @layer internal
 */

/** Token of the resolved module options. */
export const SUBSCRIPTION_OPTIONS = Symbol('SUBSCRIPTION_OPTIONS')

/** Token of the billing source (a `SubscriptionSource`). */
export const SUBSCRIPTION_SOURCE = Symbol('SUBSCRIPTION_SOURCE')

/** Token of the persistence port (a `SubscriptionStore`). */
export const SUBSCRIPTION_STORE = Symbol('SUBSCRIPTION_STORE')

/** Token of the time source (a `Clock`). */
export const SUBSCRIPTION_CLOCK = Symbol('SUBSCRIPTION_CLOCK')

/** Token of the host's optional cache. */
export const SUBSCRIPTION_CACHE = Symbol('SUBSCRIPTION_CACHE')

/** Token of the host's optional observer. */
export const SUBSCRIPTION_OBSERVER = Symbol('SUBSCRIPTION_OBSERVER')
