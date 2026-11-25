/**
 * @fileoverview The sandbox filter of the adapter (FR13, SEC07). RevenueCat grants entitlements
 * for sandbox purchases under its default setting, so the adapter removes that access itself and
 * does not rely on a dashboard setting: a sandbox subscription gives no access and grants no
 * entitlement unless the host enabled sandbox access.
 * @layer revenuecat
 */
import type {
  NonRenewingPurchaseRecord,
  SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'

/** The records and the entitlement names each record grants. */
export interface GrantedRecords {
  /** The records, in the order they were read. */
  readonly records: readonly SubscriptionRecord[]
  /** The entitlement names that each record, by its reference, grants. */
  readonly grants: ReadonlyMap<string, readonly string[]>
}

/**
 * Removes the access and the grants of every sandbox record unless sandbox access is enabled. A
 * sandbox record is kept so the host can still see it, with its access flag set to `false`. The
 * input is not changed.
 *
 * @param input The records and their grants as read.
 * @param allowSandbox Whether the host enabled sandbox access.
 */
export function applySandboxFilter(input: GrantedRecords, allowSandbox: boolean): GrantedRecords {
  if (allowSandbox) return input
  const grants = new Map(input.grants)
  const records = input.records.map((record) => {
    if (record.environment !== 'sandbox') return record
    grants.delete(record.subscriptionReference)
    return { ...record, givesAccess: false }
  })
  return { records, grants }
}

/**
 * Removes the access and the grants of every sandbox purchase unless sandbox access is enabled. A
 * sandbox purchase is kept so the host can still see it, with no access and no entitlement. The
 * input is not changed.
 *
 * @param purchases The purchases as read.
 * @param allowSandbox Whether the host enabled sandbox access.
 */
export function filterSandboxPurchases(
  purchases: readonly NonRenewingPurchaseRecord[],
  allowSandbox: boolean
): readonly NonRenewingPurchaseRecord[] {
  if (allowSandbox) return purchases
  return purchases.map((purchase) =>
    purchase.environment === 'sandbox'
      ? { ...purchase, givesAccess: false, entitlementNames: [] }
      : purchase
  )
}
