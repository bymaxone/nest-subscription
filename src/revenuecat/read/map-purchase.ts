/**
 * @fileoverview Maps one RevenueCat one-time purchase into a `NonRenewingPurchaseRecord` (D31).
 * A purchase has no access flag and no expiry of its own, so the source's own statement stands in:
 * it gives access while its status is `owned` and an entitlement it grants is in the customer's
 * active-entitlements list that no sandbox subscription or purchase of the customer also grants,
 * and it ends when that entitlement ends, with no end when the list gives none. A purchase that
 * grants no entitlement, as a consumable does not, is not held.
 * @layer revenuecat
 */
import type { NonRenewingPurchaseRecord } from '@bymax-one/nest-subscription/shared'

import { isContested, type Contested } from './contested'
import { environmentOf, toInstant } from './map-subscription'
import type { ParsedEntitlement } from './parse-customer'
import type { ActiveEntitlements, ParsedPurchase } from './parse-purchases'
import { mapOrigin } from '../mapping/origin'

/** The names of the entitlements, sorted ascending without duplicates. */
function sortedNames(entitlements: readonly ParsedEntitlement[]): readonly string[] {
  return [...new Set(entitlements.map((entitlement) => entitlement.name))].sort()
}

/** The latest of the ends, in milliseconds; `null` when any of them has no end. */
function latestEnd(ends: readonly (number | null)[]): number | null {
  let latest = Number.NEGATIVE_INFINITY
  for (const end of ends) {
    if (end === null) return null
    latest = Math.max(latest, end)
  }
  return latest
}

/** An entitlement of the purchase that the source lists as active, with its end. */
interface LiveEntitlement {
  readonly entitlement: ParsedEntitlement
  readonly end: number | null
}

/**
 * The entitlements of the purchase that the source lists as active now, with each one's end. One
 * that a sandbox grantor also grants is left out: the list cannot say which grantor keeps it active.
 */
function liveOf(
  entitlements: readonly ParsedEntitlement[],
  active: ActiveEntitlements,
  contested: Contested
): LiveEntitlement[] {
  return entitlements.flatMap((entitlement) =>
    entitlement.id !== null && active.has(entitlement.id) && !isContested(contested, entitlement)
      ? [{ entitlement, end: active.get(entitlement.id) ?? null }]
      : []
  )
}

/**
 * Builds the record of one purchase, or `null` when it grants no entitlement.
 *
 * @param parsed The purchase as narrowed from the response.
 * @param entitlements The entitlements it grants, complete.
 * @param active The customer's active entitlements, by the entitlement's `id`.
 * @param contested The entitlements that sandbox activity also grants, empty when sandbox access
 *   is allowed.
 * @param fetchedAt The instant of the read, which stands in for a purchase instant the source did
 *   not send.
 */
export function mapPurchase(
  parsed: ParsedPurchase,
  entitlements: readonly ParsedEntitlement[],
  active: ActiveEntitlements,
  contested: Contested,
  fetchedAt: string
): NonRenewingPurchaseRecord | null {
  if (entitlements.length === 0) return null
  const live = liveOf(entitlements, active, contested)
  const givesAccess = parsed.status === 'owned' && live.length > 0
  const purchasedAt = toInstant(parsed.purchasedAt) ?? fetchedAt
  return {
    purchaseReference: parsed.id,
    entitlementNames: sortedNames(
      givesAccess ? live.map((item) => item.entitlement) : entitlements
    ),
    givesAccess,
    origin: mapOrigin(parsed.store),
    environment: environmentOf(parsed.environment),
    productReference: parsed.productId ?? '',
    purchasedAt,
    accessUntil: givesAccess ? toInstant(latestEnd(live.map((item) => item.end))) : null,
    // The API states no refund instant; the purchase instant stands in so the value does not
    // change between reads and the refund is reported once.
    refundedAt: parsed.status === 'refunded' ? purchasedAt : null
  }
}
