/**
 * @fileoverview The pure comparison of two snapshots into the changes between them. It reads the
 * two snapshots and nothing else, so no webhook payload ever decides what changed.
 * @layer core
 */
import { encodeAccountKey } from '@bymax-one/nest-subscription/internal'
import {
  CHANGE_KINDS,
  type ChangeKind,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { changeKey } from './change-key'
import { billingTroubleChanges } from './diff-rules/billing-trouble'
import { lifecycleChanges, startedChanges } from './diff-rules/lifecycle'
import { overlapChanges } from './diff-rules/overlap'
import { pauseChanges } from './diff-rules/pause'
import { productChanges } from './diff-rules/product'
import { purchaseChanges, purchaseStartedChanges } from './diff-rules/purchases'
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
 * The kinds that can happen again with the same facts of the source, such as a cancellation undone
 * and made again inside one period. Their keys also name the state the change left, by the instant
 * that state was read. The other kinds name one period or one instant of the source, which is
 * already one occurrence.
 */
const RECURRING_KINDS: ReadonlySet<ChangeKind> = new Set([
  'started',
  'will_not_renew',
  'will_renew_again',
  'entered_grace',
  'put_on_hold',
  'recovered',
  'paused',
  'resumed',
  'product_changed',
  'expired',
  'transferred',
  'overlap_detected'
])

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
    ...purchaseStartedChanges(previous, current),
    ...purchaseChanges(previous, current),
    ...pairsOf(previous, current).flatMap((pair) => PAIR_RULES.flatMap((rule) => rule(pair))),
    ...transferChanges(previous, current),
    ...overlapChanges(previous, current)
  ]
  return found.sort((a, b) => CHANGE_KINDS.indexOf(a.kind) - CHANGE_KINDS.indexOf(b.kind))
}

/** The change with the facts that tell this occurrence of it from an earlier one. */
function occurrenceOf(change: RawChange, previous: SubscriptionSnapshot | null): RawChange {
  if (previous === null || !RECURRING_KINDS.has(change.kind)) return change
  return { ...change, facts: [...change.facts, previous.fetchedAt] }
}

/**
 * Compares two snapshots of one account into the typed list of what changed, each change with its
 * stable key. It is a pure function of the two snapshots: it never reads a webhook payload, a
 * clock or any other state, so the same two snapshots always give the same list and the same keys,
 * whenever and wherever they are compared. The instant `current` was read is part of no key; the
 * instant `previous` was read is part of the keys of {@link RECURRING_KINDS}. The order is that of
 * {@link diffCandidates}.
 *
 * @param previous The snapshot stored before, or `null` on first contact.
 * @param current The snapshot just read; it names the account and the tenant of the keys.
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` when `current` has a blank account
 * identifier.
 */
export function diffSnapshots(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): SubscriptionChange[] {
  // A snapshot names its account and tenant, which is all `encodeAccountKey` reads.
  const accountKey = encodeAccountKey(current)
  return diffCandidates(previous, current).map((change) => ({
    kind: change.kind,
    key: changeKey(accountKey, occurrenceOf(change, previous))
  }))
}
