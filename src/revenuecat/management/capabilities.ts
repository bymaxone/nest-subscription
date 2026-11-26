/**
 * @fileoverview What a server can do with one RevenueCat record, per origin and store, as the
 * specification's Appendix A.4 records it from RevenueCat's documentation. The answer is a pure
 * function of the record's origin and the store the source reports; a store the pages do not
 * cover is answered as not possible.
 * @layer revenuecat
 */
import type {
  ManagedRecord,
  ManagementOperation,
  SourceCapabilities
} from '@bymax-one/nest-subscription/internal'

import { referenceOf, type RevenueCatManagementContext } from './management-context'
import { NO_DETAIL, readStoreDetail, type StoreDetail } from './store-detail'

/** The store value of RevenueCat's own web billing. */
const WEB_BILLING = 'rc_billing'

/** The operations a subscription of an origin allows from a server (Appendix A.4). */
function subscriptionOperations(
  origin: string,
  store: string | null,
  versionOne: boolean
): ManagementOperation[] {
  if (origin === 'play_store') {
    return versionOne ? ['stop_renewal', 'extend', 'refund'] : ['extend', 'refund']
  }
  if (origin === 'app_store') return ['extend']
  return origin === 'web' && store === WEB_BILLING ? ['stop_renewal', 'extend', 'refund'] : []
}

/** The operations a non-renewing purchase of an origin allows from a server: only a refund. */
function purchaseOperations(
  origin: string,
  store: string | null,
  versionOne: boolean
): ManagementOperation[] {
  const played = origin === 'play_store' && versionOne
  return played || (origin === 'web' && store === WEB_BILLING) ? ['refund'] : []
}

/**
 * The operations a server can do with a record.
 *
 * @param target The subscription or purchase.
 * @param store The RevenueCat `store` of the record, or `null` when it is not known.
 * @param versionOne Whether a version 1 key was given: Google Play stop renewal and Google Play
 *   purchase refund exist only in version 1 and need it.
 */
export function operationsOf(
  target: ManagedRecord,
  store: string | null,
  versionOne: boolean
): ManagementOperation[] {
  return target.kind === 'subscription'
    ? subscriptionOperations(target.record.origin, store, versionOne)
    : purchaseOperations(target.record.origin, store, versionOne)
}

/**
 * Answers the capability query for a record. The source is read only for a record of a web origin,
 * where the store decides.
 *
 * @throws SubscriptionError with the source-unavailable code when that read fails.
 */
export async function capabilitiesOf(
  context: RevenueCatManagementContext,
  target: ManagedRecord
): Promise<SourceCapabilities> {
  const detail = target.record.origin === 'web' ? await readStoreDetail(context, target) : null
  return {
    operations: operationsOf(target, detail?.store ?? null, context.httpV1 !== null),
    managementReference: referenceOf(target)
  }
}

/**
 * Decides whether an operation may run for a record and reads what it needs. An origin the store
 * does not change is decided before any request, so a record the person must act on costs none.
 *
 * @param reads Whether the operation needs the store detail of the record.
 * @returns The detail the operation uses, or `null` when a server cannot do it.
 * @throws SubscriptionError with the source-unavailable code when the read fails.
 */
export async function permitted(
  context: RevenueCatManagementContext,
  target: ManagedRecord,
  operation: ManagementOperation,
  reads: boolean
): Promise<StoreDetail | null> {
  const versionOne = context.httpV1 !== null
  const web = target.record.origin === 'web'
  if (!web && !operationsOf(target, null, versionOne).includes(operation)) return null
  const detail = reads ? await readStoreDetail(context, target) : NO_DETAIL
  return web && !operationsOf(target, detail.store, versionOne).includes(operation) ? null : detail
}
