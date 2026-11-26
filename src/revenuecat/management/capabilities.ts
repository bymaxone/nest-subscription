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
import { readStoreDetail } from './store-detail'

/** The store value of RevenueCat's own web billing. */
const WEB_BILLING = 'rc_billing'

/** The operations a subscription of an origin allows from a server (Appendix A.4). */
function subscriptionOperations(origin: string, store: string | null): ManagementOperation[] {
  if (origin === 'play_store') return ['stop_renewal', 'extend', 'refund']
  if (origin === 'app_store') return ['extend']
  return origin === 'web' && store === WEB_BILLING ? ['stop_renewal', 'extend', 'refund'] : []
}

/** The operations a non-renewing purchase of an origin allows from a server: only a refund. */
function purchaseOperations(origin: string, store: string | null): ManagementOperation[] {
  return origin === 'play_store' || (origin === 'web' && store === WEB_BILLING) ? ['refund'] : []
}

/**
 * The operations a server can do with a record.
 *
 * @param target The subscription or purchase.
 * @param store The RevenueCat `store` of the record, or `null` when it is not known.
 */
export function operationsOf(target: ManagedRecord, store: string | null): ManagementOperation[] {
  return target.kind === 'subscription'
    ? subscriptionOperations(target.record.origin, store)
    : purchaseOperations(target.record.origin, store)
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
    operations: operationsOf(target, detail?.store ?? null),
    managementReference: referenceOf(target)
  }
}
