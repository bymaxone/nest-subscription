/**
 * @fileoverview Entry point of the `revenuecat` directory: the RevenueCat adapter factory and the
 * types of its options.
 * @layer adapter
 */
export { revenueCatSource } from './revenuecat.source'
export { signRevenueCatWebhook } from './webhook/sign'
export type {
  RevenueCatFetch,
  RevenueCatLogger,
  RevenueCatSourceOptions,
  UnidentifiedEvent
} from './revenuecat.options'
