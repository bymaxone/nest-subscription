/**
 * @fileoverview The closed catalogue of error codes and the fixed message of each. A code is a
 * stable string a host can branch on; a message never carries an account or tenant identifier, a
 * secret or a provider payload.
 * @layer shared
 */

/**
 * Every error code the library raises, keyed by name. The set is closed: every value starts with
 * `SUBSCRIPTION_`, and adding or renaming one is a public change.
 */
export const SUBSCRIPTION_ERROR_CODES = Object.freeze({
  /** A webhook request was refused; one code covers every kind of verification failure. */
  WEBHOOK_REFUSED: 'SUBSCRIPTION_WEBHOOK_REFUSED',
  /** The account is not known, or the subscription does not belong to the account. */
  ACCOUNT_UNKNOWN: 'SUBSCRIPTION_ACCOUNT_UNKNOWN',
  /** A route needs an entitlement the account does not hold. */
  ENTITLEMENT_REQUIRED: 'SUBSCRIPTION_ENTITLEMENT_REQUIRED',
  /** The subscription does not give access. */
  NO_ACCESS: 'SUBSCRIPTION_NO_ACCESS',
  /** The billing source could not be read. */
  SOURCE_UNAVAILABLE: 'SUBSCRIPTION_SOURCE_UNAVAILABLE',
  /** The operation cannot be performed for the origin of this subscription. */
  OPERATION_NOT_POSSIBLE: 'SUBSCRIPTION_OPERATION_NOT_POSSIBLE',
  /** A required option is absent. */
  CONFIG_MISSING: 'SUBSCRIPTION_CONFIG_MISSING',
  /** An option, or a combination of options, is invalid. */
  CONFIG_INVALID: 'SUBSCRIPTION_CONFIG_INVALID',
  /** An argument a caller supplied is malformed. */
  INVALID_INPUT: 'SUBSCRIPTION_INVALID_INPUT'
} as const)

/** One of the values of {@link SUBSCRIPTION_ERROR_CODES}. */
export type SubscriptionErrorCode =
  (typeof SUBSCRIPTION_ERROR_CODES)[keyof typeof SUBSCRIPTION_ERROR_CODES]

/**
 * The fixed English message of each code. Messages are literals: none interpolates an identifier,
 * a secret or a payload, so none can leak one.
 */
export const SUBSCRIPTION_ERROR_MESSAGES: Readonly<Record<SubscriptionErrorCode, string>> =
  Object.freeze({
    SUBSCRIPTION_WEBHOOK_REFUSED: 'The webhook request was refused.',
    SUBSCRIPTION_ACCOUNT_UNKNOWN: 'The account or subscription is not known.',
    SUBSCRIPTION_ENTITLEMENT_REQUIRED: 'The required entitlement is not held.',
    SUBSCRIPTION_NO_ACCESS: 'The subscription does not give access.',
    SUBSCRIPTION_SOURCE_UNAVAILABLE: 'The billing source could not be read.',
    SUBSCRIPTION_OPERATION_NOT_POSSIBLE: 'The operation is not possible for this subscription.',
    SUBSCRIPTION_CONFIG_MISSING: 'A required option is missing.',
    SUBSCRIPTION_CONFIG_INVALID: 'An option is invalid.',
    SUBSCRIPTION_INVALID_INPUT: 'An argument is invalid.'
  })
