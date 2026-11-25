/**
 * @fileoverview The product rule: a subscription that moved to another product.
 * @layer core
 */
import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/**
 * `product_changed` when the product reference differs, told apart by both products and by the
 * period the new one starts in, so a move back and forth is not one change repeated.
 */
export function productChanges({ previous, current }: SubscriptionPair): RawChange[] {
  if (previous.productReference === current.productReference) return []
  return [
    rawChange(
      'product_changed',
      current.subscriptionReference,
      previous.productReference,
      current.productReference,
      current.currentPeriodStart
    )
  ]
}
