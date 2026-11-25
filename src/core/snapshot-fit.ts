/**
 * @fileoverview The check every snapshot that enters from outside the library passes before it is
 * kept or trusted: it names the account that was asked for and every field of the model has its
 * type. A snapshot that fails is never stored and never served, so what the library answers under
 * a key names that key's account and what decides access is what the model says it is.
 *
 * The fields are listed as records keyed by the model's own field names, so adding a field to the
 * model without listing it here does not compile.
 * @layer core
 */
import type { AccountReference } from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ENVIRONMENTS,
  SUBSCRIPTION_ORIGINS,
  SUBSCRIPTION_STATUSES,
  WILL_RENEW_VALUES,
  parseInstant,
  type EntitlementState,
  type SourceCustomerReference,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

/** Decides whether one value is acceptable for one field. */
type Check = (value: unknown) => boolean

const isString: Check = (value) => typeof value === 'string'
const isBoolean: Check = (value) => typeof value === 'boolean'
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value)
const memberOf =
  (set: readonly string[]): Check =>
  (value) =>
    typeof value === 'string' && set.includes(value)

/** Whether a value is a string that `parseInstant` reads. */
const isInstant: Check = (value) => {
  try {
    return typeof value === 'string' && Number.isFinite(parseInstant(value))
  } catch {
    return false
  }
}

/** Whether a value is an object whose every field passes the check listed for it. */
function hasFields(value: unknown, fields: Readonly<Record<string, Check>>): boolean {
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(fields).every(([name, check]) => check(Reflect.get(value, name)))
}

/** A list whose every item has the fields. */
const listOf =
  (fields: Readonly<Record<string, Check>>): Check =>
  (value) =>
    Array.isArray(value) && value.every((item) => hasFields(item, fields))

const SOURCE_CUSTOMER_FIELDS: Record<keyof SourceCustomerReference, Check> = { id: isString }

const ENTITLEMENT_FIELDS: Record<keyof EntitlementState, Check> = {
  name: isString,
  active: isBoolean,
  until: orNull(isInstant),
  grantingSubscriptionReference: orNull(isString)
}

const SUBSCRIPTION_FIELDS: Record<keyof SubscriptionRecord, Check> = {
  subscriptionReference: isString,
  status: memberOf(SUBSCRIPTION_STATUSES),
  givesAccess: isBoolean,
  willRenew: memberOf(WILL_RENEW_VALUES),
  origin: memberOf(SUBSCRIPTION_ORIGINS),
  environment: memberOf(SUBSCRIPTION_ENVIRONMENTS),
  productReference: isString,
  billingInterval: isString,
  currentPeriodStart: isInstant,
  currentPeriodEnd: isInstant,
  accessUntil: orNull(isInstant),
  billingIssueSince: orNull(isInstant),
  cancelledAt: orNull(isInstant),
  refundedAt: orNull(isInstant),
  managementReference: orNull(isString)
}

/** The fields of a snapshot other than the optional `tenantId`, which the identity check covers. */
const SNAPSHOT_FIELDS: Record<Exclude<keyof SubscriptionSnapshot, 'tenantId'>, Check> = {
  accountId: isString,
  entitlements: listOf(ENTITLEMENT_FIELDS),
  subscriptions: listOf(SUBSCRIPTION_FIELDS),
  source: isString,
  sourceCustomer: orNull((value) => hasFields(value, SOURCE_CUSTOMER_FIELDS)),
  fetchedAt: isInstant,
  sourceUpdatedAt: orNull(isInstant)
}

/**
 * Whether a value is a snapshot of exactly the account asked for, tenant included (a missing
 * tenant on one side only is a difference), in which every field has the type the model gives it:
 * booleans are booleans, closed sets hold members, nullable fields are the type or `null`, the
 * optional tenant is absent or the one asked for, lists hold valid items, and every instant is one
 * `parseInstant` reads. This is the one rule for a snapshot that comes from outside the library's
 * own write path: a source's, a cache's or a store's.
 */
export function isSnapshotFor(
  value: unknown,
  account: AccountReference
): value is SubscriptionSnapshot {
  return (
    hasFields(value, SNAPSHOT_FIELDS) &&
    Reflect.get(value as object, 'accountId') === account.accountId &&
    Reflect.get(value as object, 'tenantId') === account.tenantId
  )
}
