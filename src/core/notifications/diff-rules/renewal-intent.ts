/**
 * @fileoverview The renewal-intent rules: a subscription that will no longer renew, and one that
 * will renew again. The intent flips to and from `no`; any other move between values is not one.
 * @layer core
 */
import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/**
 * `will_not_renew` when the intent becomes `no`, told apart by the period and the cancellation
 * instant; `will_renew_again` when it stops being `no`, told apart by the cancellation it undoes.
 */
export function renewalIntentChanges({ previous, current }: SubscriptionPair): RawChange[] {
  const reference = current.subscriptionReference
  if (previous.willRenew !== 'no' && current.willRenew === 'no') {
    return [
      rawChange('will_not_renew', reference, current.currentPeriodEnd, current.cancelledAt ?? '')
    ]
  }
  if (previous.willRenew === 'no' && current.willRenew !== 'no') {
    return [
      rawChange('will_renew_again', reference, current.currentPeriodEnd, previous.cancelledAt ?? '')
    ]
  }
  return []
}
