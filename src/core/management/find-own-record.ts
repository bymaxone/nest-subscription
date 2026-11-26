/**
 * @fileoverview The one ownership check every management operation uses (SEC10). It reads the
 * stored snapshot of the authenticated account and tenant and finds, among its subscriptions and
 * its non-renewing purchases and nowhere else, the record with the given reference. A reference
 * that is not there, because it belongs to another account or tenant or to nobody, is refused
 * before any source is asked.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type ManagedRecord,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { isSnapshotFor } from '../snapshot-fit'

/** The record of a snapshot with the given reference, subscriptions first, or `undefined`. */
export function locateRecord(
  snapshot: SubscriptionSnapshot,
  recordRef: string
): ManagedRecord | undefined {
  const subscription = snapshot.subscriptions.find(
    (candidate) => candidate.subscriptionReference === recordRef
  )
  if (subscription !== undefined) return { kind: 'subscription', record: subscription }
  const purchase = snapshot.nonRenewingPurchases?.find(
    (candidate) => candidate.purchaseReference === recordRef
  )
  return purchase === undefined ? undefined : { kind: 'purchase', record: purchase }
}

/**
 * Finds a record inside the account's own stored snapshot.
 *
 * @param store The store the snapshot is read from, never a cache.
 * @param account The authenticated account and tenant: the snapshot read is this one and no other.
 * @param recordRef The reference of a subscription or a non-renewing purchase.
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a reference that is not a
 *   non-blank string, and with `SUBSCRIPTION_ACCOUNT_UNKNOWN` when the account has no such record.
 */
export async function findOwnRecord(
  store: SubscriptionStore,
  account: AccountReference,
  recordRef: string
): Promise<ManagedRecord> {
  if (typeof recordRef !== 'string' || recordRef.trim().length === 0) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
  const stored = (await store.getSnapshot(encodeAccountKey(account)))?.snapshot
  const found = isSnapshotFor(stored, account) ? locateRecord(stored, recordRef) : undefined
  if (found === undefined) throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN)
  return found
}
