/**
 * @fileoverview The pause rules: a subscription that was paused and one that resumed.
 * @layer core
 */
import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/**
 * `paused` when the status becomes paused, told apart by the period it paused in; `resumed` when
 * a paused subscription becomes active or trialing, told apart by the period it resumed into.
 */
export function pauseChanges({ previous, current }: SubscriptionPair): RawChange[] {
  const reference = current.subscriptionReference
  if (previous.status !== 'paused' && current.status === 'paused') {
    return [rawChange('paused', reference, current.currentPeriodEnd)]
  }
  const isWell = current.status === 'active' || current.status === 'trialing'
  if (previous.status === 'paused' && isWell) {
    return [rawChange('resumed', reference, current.currentPeriodStart)]
  }
  return []
}
