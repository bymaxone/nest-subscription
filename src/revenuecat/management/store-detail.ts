/**
 * @fileoverview The store detail of one record, read from the source by the record's own
 * reference. The model's origin says only `web` for several stores, and the version 1 paths need
 * the store's own identifier, so the adapter asks the source instead of keeping either as a new
 * public field. A request is made only for an origin that needs the answer.
 * @layer revenuecat
 */
import type { ManagedRecord } from '@bymax-one/nest-subscription/internal'

import { attempt, type RevenueCatManagementContext } from './management-context'
import { isRecord, readString } from '../read/parse-customer'
import { unreadable } from '../read/read-context'
import { encodeSegment } from '../revenuecat-http'

/** The store of a record and the identifier that store gives it; `null` for what is not stated. */
export interface StoreDetail {
  /** The RevenueCat `store` value. */
  readonly store: string | null
  /** The `store_subscription_identifier` of a subscription or `store_purchase_identifier` of a purchase. */
  readonly identifier: string | null
}

/** The detail of a record whose origin needs none. */
export const NO_DETAIL: StoreDetail = { store: null, identifier: null }

/** Whether the origin of a record needs the detail: it is web, or an origin with a version 1 path. */
function needsDetail(target: ManagedRecord): boolean {
  return target.record.origin === 'web' || target.record.origin === 'play_store'
}

/**
 * Reads the detail of a subscription or purchase of the project by its reference, or answers
 * `NO_DETAIL` without a request for an origin that needs none.
 *
 * @throws SubscriptionError with the source-unavailable code when the request fails or the body is
 *   not an object.
 */
export async function readStoreDetail(
  context: RevenueCatManagementContext,
  target: ManagedRecord
): Promise<StoreDetail> {
  if (!needsDetail(target)) return NO_DETAIL
  const project = encodeSegment(context.projectId)
  const path =
    target.kind === 'subscription'
      ? `/projects/${project}/subscriptions/${encodeSegment(target.record.subscriptionReference)}`
      : `/projects/${project}/purchases/${encodeSegment(target.record.purchaseReference)}`
  const body = await attempt(context.http.get(path))
  if (!isRecord(body)) throw unreadable()
  return {
    store: readString(body, 'store'),
    identifier: readString(
      body,
      target.kind === 'subscription' ? 'store_subscription_identifier' : 'store_purchase_identifier'
    )
  }
}
