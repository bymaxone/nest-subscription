/**
 * @fileoverview Maps the store of a RevenueCat subscription or purchase into the model's origin
 * set, from the table of the specification's Appendix A.3. A store the table does not list is
 * `other`.
 * @layer revenuecat
 */
import type { SubscriptionOrigin } from '@bymax-one/nest-subscription/shared'

/** The stores of the version 2 API and the origin each one maps to. */
export const ORIGIN_TABLE: ReadonlyMap<string, SubscriptionOrigin> = new Map([
  ['app_store', 'app_store'],
  ['mac_app_store', 'app_store'],
  ['play_store', 'play_store'],
  ['stripe', 'web'],
  ['rc_billing', 'web'],
  ['paddle', 'web'],
  ['paypal', 'web'],
  ['promotional', 'promotional']
])

/**
 * Maps a RevenueCat `store`. A store the table does not list, or a value that is not a string, is
 * `other`.
 */
export function mapOrigin(store: unknown): SubscriptionOrigin {
  return typeof store === 'string' ? (ORIGIN_TABLE.get(store) ?? 'other') : 'other'
}
