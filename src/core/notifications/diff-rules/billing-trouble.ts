/**
 * @fileoverview The billing-trouble rules: a subscription that entered its grace period, was put
 * on hold, or recovered from either.
 * @layer core
 */
import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/**
 * `entered_grace` and `put_on_hold` when the status becomes that one, told apart by when the
 * billing issue opened and by the period; `recovered` when a subscription in grace or on hold
 * becomes active or trialing again, told apart by the issue it recovered from.
 */
export function billingTroubleChanges({ previous, current }: SubscriptionPair): RawChange[] {
  const reference = current.subscriptionReference
  const issue = current.billingIssueSince ?? ''
  if (previous.status !== 'in_grace' && current.status === 'in_grace') {
    return [rawChange('entered_grace', reference, issue, current.currentPeriodEnd)]
  }
  if (previous.status !== 'on_hold' && current.status === 'on_hold') {
    return [rawChange('put_on_hold', reference, issue, current.currentPeriodEnd)]
  }
  const wasInTrouble = previous.status === 'in_grace' || previous.status === 'on_hold'
  const isWell = current.status === 'active' || current.status === 'trialing'
  if (wasInTrouble && isWell) {
    return [
      rawChange('recovered', reference, previous.billingIssueSince ?? '', current.currentPeriodEnd)
    ]
  }
  return []
}
