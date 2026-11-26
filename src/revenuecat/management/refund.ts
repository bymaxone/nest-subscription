/**
 * @fileoverview Refund at RevenueCat, for a subscription or a non-renewing purchase. A Google Play
 * subscription is refunded through its latest transaction (version 2), RevenueCat web billing
 * through the subscription or the purchase itself (version 2), and a Google Play one-time purchase
 * through version 1, where that operation exists. Any other origin or store is answered as not
 * possible, with no write. The answer says the request was accepted; the read-back says the rest.
 * @layer revenuecat
 */
import type {
  AccountReference,
  ManagedRecord,
  OperationResult
} from '@bymax-one/nest-subscription/internal'

import { operationsOf } from './capabilities'
import {
  ACCEPTED,
  attempt,
  personMustAct,
  type RevenueCatManagementContext
} from './management-context'
import { NO_DETAIL, readStoreDetail, type StoreDetail } from './store-detail'
import { isRecord, parseList, readString } from '../read/parse-customer'
import { unreadable } from '../read/read-context'
import { encodeSegment } from '../revenuecat-http'

/** The identifier of the latest transaction of a subscription, from the list newest first. */
async function latestTransaction(
  context: RevenueCatManagementContext,
  subscriptionPath: string
): Promise<string> {
  const body = await attempt(
    context.http.get(`${subscriptionPath}/transactions`, {
      sort: 'purchased_at',
      direction: 'desc',
      limit: '1'
    })
  )
  const first = parseList(body)?.items[0]
  const id = isRecord(first) ? readString(first, 'id') : null
  if (id === null) throw unreadable()
  return id
}

/** Writes the refund of a record whose store is known to allow it. */
async function refundRecord(
  context: RevenueCatManagementContext,
  account: AccountReference,
  target: ManagedRecord,
  detail: StoreDetail
): Promise<void> {
  const project = `/projects/${encodeSegment(context.projectId)}`
  if (target.kind === 'purchase') {
    if (target.record.origin === 'web') {
      const path = `${project}/purchases/${encodeSegment(target.record.purchaseReference)}/actions/refund`
      await attempt(context.http.post(path))
      return
    }
    if (detail.identifier === null) throw unreadable()
    const path = `/subscribers/${encodeSegment(account.accountId)}/transactions/${encodeSegment(detail.identifier)}/refund`
    await attempt(context.httpV1.post(path))
    return
  }
  const subscription = `${project}/subscriptions/${encodeSegment(target.record.subscriptionReference)}`
  if (target.record.origin === 'web') {
    await attempt(context.http.post(`${subscription}/actions/refund`))
    return
  }
  const transaction = await latestTransaction(context, subscription)
  await attempt(
    context.http.post(`${subscription}/transactions/${encodeSegment(transaction)}/actions/refund`)
  )
}

/**
 * Asks RevenueCat to refund a record of the account. The store is read where it decides or where
 * its identifier is needed, and the write is one request.
 *
 * @param context The clients and the project.
 * @param account The account; its identifier is the App User ID the version 1 path names.
 * @param target A subscription or purchase taken from the account's own snapshot.
 * @throws SubscriptionError with the source-unavailable code when a request fails or a response
 *   lacks what the next request needs.
 */
export async function refundAt(
  context: RevenueCatManagementContext,
  account: AccountReference,
  target: ManagedRecord
): Promise<OperationResult> {
  const byTransaction = target.kind === 'subscription' && target.record.origin === 'play_store'
  const detail = byTransaction ? NO_DETAIL : await readStoreDetail(context, target)
  if (!operationsOf(target, detail.store).includes('refund')) return personMustAct(target)
  await refundRecord(context, account, target, detail)
  return ACCEPTED
}
