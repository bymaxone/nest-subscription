/**
 * @fileoverview Entry point of the `internal` directory: the classes and injection tokens that more than one entry point needs, built as one bundle that the other entry points import by package specifier.
 * @layer internal
 */
export { SubscriptionError } from '@bymax-one/nest-subscription/shared'
export { hashAccountKey } from './account-hash'
export { decodeAccountKey, encodeAccountKey } from './account-key'
export { SECRET_PLACEHOLDER, Secret } from './secret'
export type { SecretInput } from './secret'
export {
  SUBSCRIPTION_CACHE,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OBSERVER,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE
} from './tokens'
export type { Clock } from './clock'
export type {
  AccountReference,
  ExtendReason,
  ExtendRequest,
  ManagedRecord,
  ManagementOperation,
  OperationResult,
  SourceCapabilities,
  SourceNotification,
  SubscriptionSource,
  WebhookRequest,
  WebhookVerification
} from './source.port'
export type { KeyPage, StoredSnapshot, SubscriptionStore } from './store.port'
