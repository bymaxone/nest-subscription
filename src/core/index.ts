/**
 * @fileoverview Entry point of the `core` directory: the NestJS module, the service, the guard and the webhook processor.
 * @layer core
 */
export { SubscriptionError, encodeAccountKey } from '@bymax-one/nest-subscription/internal'
export type { AccountKeyParts } from '@bymax-one/nest-subscription/internal'
export { SUBSCRIPTION_ERROR_CODES } from '../shared/error-codes'
export type { SubscriptionErrorCode } from '../shared/error-codes'
