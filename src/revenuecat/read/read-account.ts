/**
 * @fileoverview Reads one customer from version 2 of the RevenueCat REST API and builds the
 * snapshot. A customer RevenueCat does not know is the empty snapshot, not an error. The
 * entitlements come from the grantors the source names (each subscription's and each purchase's
 * own entitlement list), the sandbox filter runs before they are resolved, and access is the
 * source's flag.
 * @layer revenuecat
 */
import { SubscriptionError, type AccountReference } from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  resolveEntitlements,
  SUBSCRIPTION_ERROR_CODES,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { encodeSegment } from '../revenuecat-http'
import { listAll } from './list-all'
import { mapSubscription } from './map-subscription'
import { parseEntitlementNames, parseSubscription, type ParsedSubscription } from './parse-customer'
import { unavailableIfUnknown, unreadable, type RevenueCatReadContext } from './read-context'
import { readPurchases } from './read-purchases'
import { applySandboxFilter, filterSandboxPurchases, type GrantedRecords } from './sandbox-filter'

/**
 * The entitlement names a subscription grants. The nested list that came with it is used when it
 * is complete; otherwise the per-subscription endpoint is read to its end.
 */
async function namesOf(
  context: RevenueCatReadContext,
  parsed: ParsedSubscription
): Promise<readonly string[]> {
  if (!parsed.entitlementsIncomplete) return parsed.entitlementNames
  const path = `/projects/${encodeSegment(context.projectId)}/subscriptions/${encodeSegment(parsed.id)}/entitlements`
  return parseEntitlementNames(await listAll(context.http, path, 'id'))
}

/** Every subscription of the customer, narrowed; an item that cannot be named fails the read. */
async function readSubscriptions(
  context: RevenueCatReadContext,
  accountId: string
): Promise<readonly ParsedSubscription[]> {
  const path = `/projects/${encodeSegment(context.projectId)}/customers/${encodeSegment(accountId)}/subscriptions`
  return (await listAll(context.http, path, 'id')).map((item) => {
    const parsed = parseSubscription(item)
    if (parsed === null) throw unreadable()
    return parsed
  })
}

/** The records of the customer and the names each grants, before the sandbox filter. */
async function readGranted(
  context: RevenueCatReadContext,
  parsed: readonly ParsedSubscription[],
  fetchedAt: string
): Promise<GrantedRecords> {
  const records: SubscriptionRecord[] = []
  const grants = new Map<string, readonly string[]>()
  for (const subscription of parsed) {
    records.push(mapSubscription(subscription, fetchedAt))
    grants.set(subscription.id, await namesOf(context, subscription))
  }
  return { records, grants }
}

/**
 * The snapshot of a customer RevenueCat knows, from the subscriptions already read. Every request
 * here comes after the first one, so a resource the source no longer has makes the read fail
 * instead of reading as an unknown customer.
 */
async function buildSnapshot(
  context: RevenueCatReadContext,
  account: AccountReference,
  parsed: readonly ParsedSubscription[],
  fetchedAt: string
): Promise<SubscriptionSnapshot> {
  try {
    const granted = applySandboxFilter(
      await readGranted(context, parsed, fetchedAt),
      context.allowSandbox
    )
    const purchases = filterSandboxPurchases(
      await readPurchases(context, account.accountId, fetchedAt),
      context.allowSandbox
    )
    return {
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      entitlements: resolveEntitlements(granted.records, granted.grants, purchases).entitlements,
      subscriptions: granted.records,
      nonRenewingPurchases: purchases,
      source: context.sourceName,
      sourceCustomer: { id: account.accountId },
      fetchedAt,
      sourceUpdatedAt: null
    }
  } catch (error) {
    throw unavailableIfUnknown(error)
  }
}

/**
 * Reads the current state of one account. Only the first request, the first page of the customer's
 * subscriptions, decides that the customer is unknown; a request after it that is not found fails
 * the read, so the snapshot already stored is kept.
 *
 * @param context The client and the settings of the adapter.
 * @param account The account to read; its identifier is RevenueCat's App User ID.
 * @returns The snapshot, or the empty snapshot when RevenueCat has no record of the customer.
 * @throws SubscriptionError with the source-unavailable code when the source cannot be read to the
 *   end, a resource it listed is no longer there, or it answers with something that is not what the
 *   API documents.
 */
export async function readRevenueCatAccount(
  context: RevenueCatReadContext,
  account: AccountReference
): Promise<SubscriptionSnapshot> {
  const fetchedAt = context.clock.now().toISOString()
  let subscriptions: readonly ParsedSubscription[]
  try {
    subscriptions = await readSubscriptions(context, account.accountId)
  } catch (error) {
    if (
      error instanceof SubscriptionError &&
      error.code === SUBSCRIPTION_ERROR_CODES.ACCOUNT_UNKNOWN
    ) {
      return createEmptySnapshot({
        accountId: account.accountId,
        ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
        source: context.sourceName,
        fetchedAt
      })
    }
    throw error
  }
  return buildSnapshot(context, account, subscriptions, fetchedAt)
}
