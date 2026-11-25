/**
 * @fileoverview The lifecycle rules: a subscription started, renewed, converted from a trial or
 * expired. Each reads the status values as states the source reports, and never as access.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { rawChange, type RawChange, type SubscriptionPair } from './raw-change'

/** Whether the first instant is strictly later than the second; an unreadable one is never later. */
function laterThan(first: string, second: string): boolean {
  return Date.parse(first) > Date.parse(second)
}

/**
 * The subscriptions of an account that had none before: one `started` for each, told apart by the
 * start of its period. A new subscription beside an existing one is not a start.
 */
export function startedChanges(
  previous: SubscriptionSnapshot | null,
  current: SubscriptionSnapshot
): RawChange[] {
  if (previous !== null && previous.subscriptions.length > 0) return []
  return current.subscriptions.map((subscription) =>
    rawChange('started', subscription.subscriptionReference, subscription.currentPeriodStart)
  )
}

/**
 * `renewed` when an active subscription stays active in a later period, `trial_converted` when a
 * trial becomes active, `expired` when it becomes expired.
 */
export function lifecycleChanges({ previous, current }: SubscriptionPair): RawChange[] {
  const reference = current.subscriptionReference
  const changes: RawChange[] = []
  if (
    previous.status === 'active' &&
    current.status === 'active' &&
    laterThan(current.currentPeriodEnd, previous.currentPeriodEnd)
  ) {
    changes.push(rawChange('renewed', reference, current.currentPeriodEnd))
  }
  if (previous.status === 'trialing' && current.status === 'active') {
    changes.push(rawChange('trial_converted', reference, current.currentPeriodStart))
  }
  if (previous.status !== 'expired' && current.status === 'expired') {
    changes.push(
      rawChange('expired', reference, current.accessUntil ?? '', current.currentPeriodEnd)
    )
  }
  return changes
}
