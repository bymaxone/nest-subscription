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
  decodeAccountKey,
  encodeAccountKey,
  hashAccountKey
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
  ResolvedSubscriptionOptions,
  SubscriptionCache,
  SubscriptionChangeHook,
  SubscriptionChangeNotification,
  SubscriptionFailPolicy,
  SubscriptionModuleAsyncOptions,
  SubscriptionModuleOptions,
  SubscriptionOptionsInput
} from './options/subscription-options.types'
export type { SubscriptionLogger } from './logging/subscription-logger'
export type {
  BackgroundRefreshFailure,
  CacheEvent,
  CacheOutcome,
  ChangeDeliveryEvent,
  ChangeDeliveryOutcome,
  EventRecordFailure,
  GuardDecisionEvent,
  GuardOutcome,
  RefreshEvent,
  RefreshOutcome,
  SourceErrorEvent,
  SubscriptionObserver,
  WebhookEvent,
  WebhookOutcomeKind
} from './observer/observer.types'
export { EntitlementGuard } from './guard/entitlement.guard'
export { RequiresEntitlement } from './guard/requires-entitlement.decorator'
export type { AccountResolver, ResolvedAccount } from './guard/account-resolver.types'
export { diffSnapshots } from './notifications/diff-snapshots'
export { SubscriptionModule } from './subscription.module'
export { SubscriptionService } from './subscription.service'
export { toHttpAnswer } from './webhook/webhook-outcome'
export type { WebhookAnswer, WebhookOutcome } from './webhook/webhook-outcome'
export { SubscriptionWebhookController } from './webhook/webhook.controller'
export { WebhookProcessor } from './webhook/webhook.processor'
export type { WebhookContext } from './webhook/webhook.processor'
export type { AgedSnapshot } from './snapshot-view'
export type { ReconcileOptions, ReconcileResult } from './reconciliation/reconciler'
export type { Wait } from './reconciliation/rate-limiter'
