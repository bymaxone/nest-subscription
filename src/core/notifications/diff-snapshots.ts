/**
 * @fileoverview The pure comparison of two snapshots into the changes between them. It reads the
 * two snapshots and nothing else, so no webhook payload ever decides what changed.
 * @layer core
 */
import { CHANGE_KINDS, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { billingTroubleChanges } from './diff-rules/billing-trouble'
import { lifecycleChanges, startedChanges } from './diff-rules/lifecycle'
import { overlapChanges } from './diff-rules/overlap'
import { pauseChanges } from './diff-rules/pause'
import { productChanges } from './diff-rules/product'
import type { RawChange, SubscriptionPair } from './diff-rules/raw-change'
import { refundChanges, transferChanges } from './diff-rules/refund-transfer'
import { renewalIntentChanges } from './diff-rules/renewal-intent'

/** The rules that read one subscription as it was and as it is. */
const PAIR_RULES: ReadonlyArray<(pair: SubscriptionPair) => RawChange[]> = [
  lifecycleChanges,
  renewalIntentChanges,
  billingTroubleChanges,
  pauseChanges,
  productChanges,
  refundChanges
]

/** The subscriptions both snapshots hold, paired by their subscription reference. */
function pairsOf(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): SubscriptionPair[] {
  const before = new Map(
    (previous?.subscriptions ?? []).map((subscription) => [
      subscription.subscriptionReference,
      subscription
    ])
  )
  return current.subscriptions.flatMap((subscription) => {
    const held = before.get(subscription.subscriptionReference)
    return held === undefined ? [] : [{ previous: held, current: subscription }]
  })
}

/**
 * Finds what changed from `previous` to `current`, before any key is derived. `previous` is
 * `null` on first contact.
 *
 * The result is ordered by kind, in the order of `CHANGE_KINDS`, and within one kind by the order
 * of the subscriptions in `current`. One comparison can hold several kinds, such as a refund that
 * also expires the subscription. A change of `fetchedAt` alone, or two equal snapshots, give an
 * empty list. The function is pure: it reads no clock and changes neither argument.
 */
export function diffCandidates(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  const found = [
    ...startedChanges(previous, current),
    ...pairsOf(previous, current).flatMap((pair) => PAIR_RULES.flatMap((rule) => rule(pair))),
    ...transferChanges(previous, current),
    ...overlapChanges(previous, current)
  ]
  return found.sort((a, b) => CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind))
}
