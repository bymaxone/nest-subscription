/**
 * @fileoverview What a read of one RevenueCat customer needs from the adapter, shared by the reads
 * of subscriptions and of purchases.
 * @layer revenuecat
 */
import { SubscriptionError, type Clock } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import type { RevenueCatHttp } from '../revenuecat-http'

/** What a read needs from the adapter. */
export interface RevenueCatReadContext {
  /** The client of the REST API. */
  readonly http: RevenueCatHttp
  /** The RevenueCat project. */
  readonly projectId: string
  /** The name stored on every snapshot. */
  readonly sourceName: string
  /** Whether sandbox purchases grant access. */
  readonly allowSandbox: boolean
  /** The time source of the read. */
  readonly clock: Clock
}

/** The error of a response that cannot be used: the source could not be read. */
export function unreadable(): SubscriptionError {
  return new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
}

/**
 * What a failure of a request after the first one of a read means: a resource the source no longer
 * has is not an unknown customer, it is a read that cannot be completed. The account-unknown error
 * becomes the source-unavailable one; any other error is returned as it is.
 */
export function unavailableIfUnknown(error: unknown): unknown {
  return error instanceof SubscriptionError &&
    error.code === SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    ? unreadable()
    : error
}
