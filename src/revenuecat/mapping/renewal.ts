/**
 * @fileoverview Maps the renewal status of a RevenueCat subscription into the model's will-renew
 * set, from the table of the specification's Appendix A.3. A value the table does not list is
 * `unknown`.
 * @layer revenuecat
 */
import type { WillRenew } from '@bymax-one/nest-subscription/shared'

/** The renewal statuses of the version 2 API and the will-renew value each one maps to. */
export const RENEWAL_TABLE: ReadonlyMap<string, WillRenew> = new Map([
  ['will_renew', 'yes'],
  ['will_not_renew', 'no'],
  ['will_change_product', 'changes_product'],
  ['will_pause', 'pauses']
])

/**
 * Maps a RevenueCat `auto_renewal_status`. A value the table does not list, or one that is not a
 * string, is `unknown`.
 */
export function mapWillRenew(status: unknown): WillRenew {
  return typeof status === 'string' ? (RENEWAL_TABLE.get(status) ?? 'unknown') : 'unknown'
}
