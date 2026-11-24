/**
 * @fileoverview Entry point of the `core` directory: the NestJS module, the service, the guard and the webhook processor.
 * @layer core
 */
export {
  SUBSCRIPTION_CACHE,
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OBSERVER,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SECRET_PLACEHOLDER,
  SUBSCRIPTION_STORE,
  Secret,
  SubscriptionError,
  encodeAccountKey
} from '@bymax-one/nest-subscription/internal'
export type {
  AccountReference,
  Clock,
  KeyPage,
  ManagementOperation,
  SecretInput,
  SourceCapabilities,
  SourceNotification,
  StopRenewalResult,
  StoredSnapshot,
  SubscriptionSource,
  SubscriptionStore,
  WebhookRequest,
  WebhookVerification
} from '@bymax-one/nest-subscription/internal'
export { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
export type {
  ChangeKind,
  EmptySnapshotInput,
  EntitlementResolution,
  EntitlementState,
  SourceCustomerReference,
  SubscriptionChange,
  SubscriptionEnvironment,
  SubscriptionErrorCode,
  SubscriptionOrigin,
  SubscriptionRecord,
  SubscriptionSnapshot,
  SubscriptionStatus,
  WillRenew
} from '@bymax-one/nest-subscription/shared'
export { resolveOptions } from './options/resolve-options'
export { validateOptions } from './options/validate-options'
export type {
  AccountResolverOption,
  ResolvedAccountOption,
  ResolvedSubscriptionOptions,
  SubscriptionCache,
  SubscriptionChangeHook,
  SubscriptionChangeNotification,
  SubscriptionFailPolicy,
  SubscriptionModuleAsyncOptions,
  SubscriptionModuleOptions,
  SubscriptionObserverOption,
  SubscriptionOptionsInput
} from './options/subscription-options.types'
