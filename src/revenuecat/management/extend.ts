/**
 * @fileoverview Extend at RevenueCat: the current period of a Google Play subscription, an App
 * Store subscription or a RevenueCat web billing subscription is extended by whole days through
 * version 2 of the API. The App Store needs a reason and at most 90 days, and both are checked
 * before any request. Any other origin or store is answered as not possible, with no write.
 * @layer revenuecat
 */
import {
  SubscriptionError,
  type ExtendRequest,
  type ManagedRecord,
  type OperationResult
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'

import { operationsOf } from './capabilities'
import {
  ACCEPTED,
  attempt,
  personMustAct,
  type RevenueCatManagementContext
} from './management-context'
import { NO_DETAIL, readStoreDetail } from './store-detail'
import { encodeSegment } from '../revenuecat-http'

/** The most days Apple lets one extension add. */
export const APPLE_MAX_EXTEND_DAYS = 90

/** Refuses, before any request, an extension the App Store would not accept. */
function assertAcceptable(subscription: SubscriptionRecord, extension: ExtendRequest): void {
  if (
    subscription.origin === 'app_store' &&
    (extension.reason === undefined || extension.days > APPLE_MAX_EXTEND_DAYS)
  ) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
}

/**
 * Asks RevenueCat to extend the current period of a subscription. The store is read only for a web
 * origin, where it decides, and the write is one request.
 *
 * @param context The clients and the project.
 * @param subscription A subscription taken from the account's own snapshot.
 * @param extension The whole days and, for the App Store, the reason.
 * @throws SubscriptionError with the invalid-input code for an extension the App Store refuses, and
 *   with the source-unavailable code when a request fails.
 */
export async function extendAt(
  context: RevenueCatManagementContext,
  subscription: SubscriptionRecord,
  extension: ExtendRequest
): Promise<OperationResult> {
  assertAcceptable(subscription, extension)
  const target: ManagedRecord = { kind: 'subscription', record: subscription }
  const detail = subscription.origin === 'web' ? await readStoreDetail(context, target) : NO_DETAIL
  if (!operationsOf(target, detail.store).includes('extend')) return personMustAct(target)
  const project = encodeSegment(context.projectId)
  const path = `/projects/${project}/subscriptions/${encodeSegment(subscription.subscriptionReference)}/actions/extend`
  await attempt(
    context.http.post(path, {
      extend_by_days: extension.days,
      ...(extension.reason === undefined ? {} : { extend_reason_code: extension.reason })
    })
  )
  return ACCEPTED
}
