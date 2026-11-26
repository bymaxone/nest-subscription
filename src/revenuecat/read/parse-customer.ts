/**
 * @fileoverview Narrows what the RevenueCat API returned, which arrives as `unknown`, into the
 * fields the adapter reads. Nothing is cast: each field is checked where it is read, a field of
 * the wrong type is absent, and an item that cannot be named is refused by the caller.
 * @layer revenuecat
 */

/** A JSON object whose fields are not yet known. */
export type JsonRecord = Readonly<Record<string, unknown>>

/** Whether a value is a JSON object, not an array and not `null`. */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The field of an object when it is a non-empty string, and `null` otherwise. */
export function readString(record: JsonRecord, key: string): string | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The field of an object when it is a boolean, and `null` otherwise. */
export function readBoolean(record: JsonRecord, key: string): boolean | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'boolean' ? value : null
}

/** The field of an object when it is a finite number of milliseconds, and `null` otherwise. */
export function readMillis(record: JsonRecord, key: string): number | null {
  const value: unknown = Reflect.get(record, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One page of a list: its items, and whether RevenueCat says another page follows. */
export interface ParsedList {
  /** The items of the page, each still `unknown`. */
  readonly items: readonly unknown[]
  /** Whether `next_page` is present, which is how the API says there is more. */
  readonly hasMore: boolean
  /**
   * The `starting_after` value in the query string of `next_page`, or `null` when there is none.
   * Only the value is read: the address itself is never requested.
   */
  readonly nextCursor: string | null
}

/** The base a relative `next_page` is resolved against; it is read from and never requested. */
const PLACEHOLDER_BASE = 'https://placeholder.invalid'

/** The `starting_after` of a `next_page` value, absolute or relative, or `null` when it has none. */
function cursorOfNextPage(next: string): string | null {
  if (!URL.canParse(next, PLACEHOLDER_BASE)) return null
  const cursor = new URL(next, PLACEHOLDER_BASE).searchParams.get('starting_after')
  return cursor === null || cursor.length === 0 ? null : cursor
}

/** The list envelope of the API (`object`, `items`, `next_page`, `url`), or `null` when it is not. */
export function parseList(value: unknown): ParsedList | null {
  if (!isRecord(value)) return null
  const items: unknown = Reflect.get(value, 'items')
  if (!Array.isArray(items)) return null
  const next: unknown = Reflect.get(value, 'next_page')
  const hasMore = typeof next === 'string' && next.length > 0
  return { items, hasMore, nextCursor: hasMore ? cursorOfNextPage(next) : null }
}

/** One entitlement of a nested list: its internal identifier and the name a host gives it. */
export interface ParsedEntitlement {
  /** The entitlement's `id`, which the active-entitlements list uses; `null` when absent. */
  readonly id: string | null
  /** The entitlement's `lookup_key`: its name. */
  readonly name: string
}

/** The entitlements of a nested list; an item with no `lookup_key` is dropped. */
export function parseEntitlements(items: readonly unknown[]): readonly ParsedEntitlement[] {
  return items.flatMap((item) => {
    const name = isRecord(item) ? readString(item, 'lookup_key') : null
    return isRecord(item) && name !== null ? [{ id: readString(item, 'id'), name }] : []
  })
}

/** A subscription as the adapter reads it. Every field but `id` may be absent. */
export interface ParsedSubscription {
  /** The subscription's `id`. */
  readonly id: string
  /** The `status`, as received. */
  readonly status: string | null
  /** The `gives_access` flag, as received. */
  readonly givesAccess: boolean | null
  /** The `auto_renewal_status`, as received. */
  readonly autoRenewalStatus: string | null
  /** The `store`, as received. */
  readonly store: string | null
  /** The `environment`, as received. */
  readonly environment: string | null
  /** The `product_id`, when the subscription has one. */
  readonly productId: string | null
  /** The `starts_at` instant in milliseconds. */
  readonly startsAt: number | null
  /** The `current_period_starts_at` instant in milliseconds. */
  readonly currentPeriodStartsAt: number | null
  /** The `current_period_ends_at` instant in milliseconds. */
  readonly currentPeriodEndsAt: number | null
  /** The `ends_at` instant in milliseconds. */
  readonly endsAt: number | null
  /** The `management_url`, when there is one. */
  readonly managementUrl: string | null
  /** The entitlements of the nested list that came with the subscription. */
  readonly entitlements: readonly ParsedEntitlement[]
  /**
   * Whether the nested entitlement list is incomplete: it says more follow, or it did not come
   * with the subscription at all.
   */
  readonly entitlementsIncomplete: boolean
}

/**
 * Reads one item of a subscriptions list. It returns `null` for an item that is not an object or
 * has no `id`, because a subscription that cannot be named cannot be referred to by an
 * entitlement; the caller treats that as a source it cannot read.
 */
export function parseSubscription(value: unknown): ParsedSubscription | null {
  if (!isRecord(value)) return null
  const id = readString(value, 'id')
  if (id === null) return null
  const nested = parseList(Reflect.get(value, 'entitlements'))
  return {
    id,
    status: readString(value, 'status'),
    givesAccess: readBoolean(value, 'gives_access'),
    autoRenewalStatus: readString(value, 'auto_renewal_status'),
    store: readString(value, 'store'),
    environment: readString(value, 'environment'),
    productId: readString(value, 'product_id'),
    startsAt: readMillis(value, 'starts_at'),
    currentPeriodStartsAt: readMillis(value, 'current_period_starts_at'),
    currentPeriodEndsAt: readMillis(value, 'current_period_ends_at'),
    endsAt: readMillis(value, 'ends_at'),
    managementUrl: readString(value, 'management_url'),
    entitlements: nested === null ? [] : parseEntitlements(nested.items),
    entitlementsIncomplete: nested === null || nested.hasMore
  }
}
