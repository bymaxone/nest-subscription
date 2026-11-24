/**
 * @fileoverview Entry point of the `shared` subpath: the model's types, closed value sets and
 * error codes, with no runtime dependency.
 * @layer shared
 */
export {
  CHANGE_KINDS,
  SUBSCRIPTION_ENVIRONMENTS,
  SUBSCRIPTION_ORIGINS,
  SUBSCRIPTION_STATUSES,
  WILL_RENEW_VALUES
} from './values'
export type {
  ChangeKind,
  SubscriptionEnvironment,
  SubscriptionOrigin,
  SubscriptionStatus,
  WillRenew
} from './values'
export type {
  EntitlementState,
  SourceCustomerReference,
  SubscriptionRecord,
  SubscriptionSnapshot
} from './snapshot.types'
export type { SubscriptionChange } from './change.types'
export { SUBSCRIPTION_ERROR_CODES } from './error-codes'
export type { SubscriptionErrorCode } from './error-codes'
