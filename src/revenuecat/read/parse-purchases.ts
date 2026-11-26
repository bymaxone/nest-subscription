/**
 * @fileoverview Narrows what the RevenueCat API returned for a customer's one-time purchases and
 * active entitlements, which arrives as `unknown`. Nothing is cast: each field is checked where it
 * is read, and an item that cannot be named is refused by the caller.
 * @layer revenuecat
 */
import {
  isRecord,
  parseEntitlements,
  parseList,
  readMillis,
  readString,
  type ParsedEntitlement
} from './parse-customer'

/** A purchase as the adapter reads it. Every field but `id` may be absent. */
export interface ParsedPurchase {
  /** The purchase's `id`. */
  readonly id: string
  /** The `status` (`owned` or `refunded`), as received. */
  readonly status: string | null
  /** The `store`, as received. */
  readonly store: string | null
  /** The `environment`, as received. */
  readonly environment: string | null
  /** The `product_id`. */
  readonly productId: string | null
  /** The `purchased_at` instant in milliseconds. */
  readonly purchasedAt: number | null
  /** The entitlements of the nested list that came with the purchase. */
  readonly entitlements: readonly ParsedEntitlement[]
  /**
   * Whether the nested entitlement list is incomplete: it says more follow, or it did not come
   * with the purchase at all.
   */
  readonly entitlementsIncomplete: boolean
}

/**
 * Reads one item of a purchases list. It returns `null` for an item that is not an object or has
 * no `id`: a purchase that cannot be named cannot be referred to by an entitlement.
 */
export function parsePurchase(value: unknown): ParsedPurchase | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id')
  if (id === null) return null
  const nested = parseList(Reflect.get(value, 'entitlements'))
  return {
    id,
    status: readString(value, 'status'),
    store: readString(value, 'store'),
    environment: readString(value, 'environment'),
    productId: readString(value, 'product_id'),
    purchasedAt: readMillis(value, 'purchased_at'),
    entitlements: nested === null ? [] : parseEntitlements(nested.items),
    entitlementsIncomplete: nested === null || nested.hasMore
  }
}

/** What the source says about one entitlement being active now: until when, `null` for no end. */
export type ActiveEntitlements = ReadonlyMap<string, number | null>

/**
 * Reads the items of the active-entitlements list into a map from the entitlement's `id` to its
 * `expires_at` in milliseconds, `null` when it has none. An item with no `entitlement_id` is
 * dropped; an `expires_at` that is not a finite number reads as no end only when it is `null`, and
 * otherwise the item is dropped, so a malformed end never becomes a lifetime grant.
 */
export function parseActiveEntitlements(items: readonly unknown[]): ActiveEntitlements {
  const active = new Map<string, number | null>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const id = readString(item, 'entitlement_id')
    const expiresAt = readMillis(item, 'expires_at')
    if (id !== null && (expiresAt !== null || Reflect.get(item, 'expires_at') === null)) {
      active.set(id, expiresAt)
    }
  }
  return active
}
