/**
 * @fileoverview Reads the one-time purchases of a customer that grant an entitlement (D31). The
 * purchases list names what each grants; the active-entitlements list says which of those
 * entitlements are active now and until when, and is read only when some purchase grants
 * something. A consumable, and any purchase whose entitlement list is empty, is not held.
 * @layer revenuecat
 */
import type { NonRenewingPurchaseRecord } from '@bymax-one/nest-subscription/shared'

import { encodeSegment } from '../revenuecat-http'
import { listAll } from './list-all'
import { mapPurchase } from './map-purchase'
import { parseEntitlements, type ParsedEntitlement } from './parse-customer'
import {
  parseActiveEntitlements,
  parsePurchase,
  type ActiveEntitlements,
  type ParsedPurchase
} from './parse-purchases'
import { unreadable, type RevenueCatReadContext } from './read-context'

/** A purchase and the entitlements it grants, complete. */
interface GrantingPurchase {
  readonly parsed: ParsedPurchase
  readonly entitlements: readonly ParsedEntitlement[]
}

/** The path of a customer's list, with the identifiers encoded. */
function customerPath(context: RevenueCatReadContext, accountId: string, list: string): string {
  return `/projects/${encodeSegment(context.projectId)}/customers/${encodeSegment(accountId)}/${list}`
}

/**
 * The entitlements a purchase grants. The nested list that came with it is used when it is
 * complete; otherwise the per-purchase endpoint is read to its end.
 */
async function entitlementsOf(
  context: RevenueCatReadContext,
  parsed: ParsedPurchase
): Promise<readonly ParsedEntitlement[]> {
  if (!parsed.entitlementsIncomplete) return parsed.entitlements
  const path = `/projects/${encodeSegment(context.projectId)}/purchases/${encodeSegment(parsed.id)}/entitlements`
  return parseEntitlements(await listAll(context.http, path, 'id'))
}

/** Every purchase of the customer with the entitlements it grants; an unnamable item fails the read. */
async function readGranting(
  context: RevenueCatReadContext,
  accountId: string
): Promise<readonly GrantingPurchase[]> {
  const items = await listAll(context.http, customerPath(context, accountId, 'purchases'), 'id')
  const granting: GrantingPurchase[] = []
  for (const item of items) {
    const parsed = parsePurchase(item)
    if (parsed === null) throw unreadable()
    granting.push({ parsed, entitlements: await entitlementsOf(context, parsed) })
  }
  return granting
}

/** The customer's active entitlements, or none when no purchase grants anything to look up. */
async function readActive(
  context: RevenueCatReadContext,
  accountId: string,
  granting: readonly GrantingPurchase[]
): Promise<ActiveEntitlements> {
  if (granting.every((purchase) => purchase.entitlements.length === 0)) return new Map()
  const path = customerPath(context, accountId, 'active_entitlements')
  return parseActiveEntitlements(await listAll(context.http, path, 'entitlement_id'))
}

/**
 * The non-renewing purchases of a customer that grant an entitlement, sandbox included: the
 * filter that removes sandbox access is applied by the caller.
 *
 * @param context The client and the settings of the adapter.
 * @param accountId The customer's App User ID.
 * @param fetchedAt The instant of the read.
 * @throws SubscriptionError with the source-unavailable code when a list cannot be read to its end
 *   or an item cannot be named; and whatever the client throws.
 */
export async function readPurchases(
  context: RevenueCatReadContext,
  accountId: string,
  fetchedAt: string
): Promise<readonly NonRenewingPurchaseRecord[]> {
  const granting = await readGranting(context, accountId)
  const active = await readActive(context, accountId, granting)
  return granting.flatMap(({ parsed, entitlements }) => {
    const record = mapPurchase(parsed, entitlements, active, fetchedAt)
    return record === null ? [] : [record]
  })
}
