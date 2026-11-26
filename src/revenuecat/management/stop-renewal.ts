/**
 * @fileoverview Stop renewal at RevenueCat: a Google Play subscription through version 1 of the
 * API, which is where the operation exists, and RevenueCat's own web billing through version 2.
 * Any other origin or store is answered as not possible from a server, with no write. The answer
 * says the request was accepted; what became of the subscription is the read-back's to say.
 * @layer revenuecat
 */
import type {
  AccountReference,
  ManagedRecord,
  OperationResult
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { operationsOf } from './capabilities'
import {
  ACCEPTED,
  attempt,
  personMustAct,
  type RevenueCatManagementContext
} from './management-context'
import { readStoreDetail } from './store-detail'
import { unreadable } from '../read/read-context'
import { encodeSegment } from '../revenuecat-http'

/**
 * Asks RevenueCat to stop the renewal of a subscription. The store is read first where the origin
 * needs it, and the write is one request.
 *
 * @param context The clients and the project.
 * @param account The account; its identifier is the App User ID the version 1 path names.
 * @param subscription A subscription taken from the account's own snapshot.
 * @throws SubscriptionError with the source-unavailable code when a request fails.
 */
export async function stopRenewalAt(
  context: RevenueCatManagementContext,
  account: AccountReference,
  subscription: SubscriptionRecord
): Promise<OperationResult> {
  const target: ManagedRecord = { kind: 'subscription', record: subscription }
  const detail = await readStoreDetail(context, target)
  if (!operationsOf(target, detail.store).includes('stop_renewal')) return personMustAct(target)
  if (subscription.origin === 'play_store') {
    if (detail.identifier === null) throw unreadable()
    const path = `/subscribers/${encodeSegment(account.accountId)}/subscriptions/${encodeSegment(detail.identifier)}/cancel`
    await attempt(context.httpV1.post(path))
  } else {
    const project = encodeSegment(context.projectId)
    const path = `/projects/${project}/subscriptions/${encodeSegment(subscription.subscriptionReference)}/actions/cancel`
    await attempt(context.http.post(path))
  }
  return ACCEPTED
}
