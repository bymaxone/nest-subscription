/**
 * @fileoverview The fail policy, as a pure function: what the guard does with a snapshot that
 * cannot be shown current (the store could not be read, or the stored snapshot is older than the
 * maximum age and its refresh has not been waited for). Nothing else grants access under failure.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import type { SubscriptionFailPolicy } from '../options/subscription-options.types'
import { ageOf } from '../refresh/staleness'

/** What the policy decided: trust the snapshot it was given, or refuse. */
export type FailPolicyOutcome =
  { readonly allow: true; readonly snapshot: SubscriptionSnapshot } | { readonly allow: false }

/** The inputs of {@link applyFailPolicy}. */
export interface FailPolicyInput {
  /** The configured policy. */
  readonly policy: SubscriptionFailPolicy
  /** The tolerance of `last_known_state`, in milliseconds. */
  readonly toleranceMs: number
  /** The stored snapshot that cannot be shown current; `null` when none could be read. */
  readonly snapshot: SubscriptionSnapshot | null
  /** The instant to judge the age at, from the injected clock. */
  readonly now: Date
}

/**
 * Applies the fail policy. `refuse` trusts nothing. `last_known_state` trusts a snapshot strictly
 * younger than the tolerance: one aged exactly the tolerance is refused. No snapshot, an unknown
 * policy value and a tolerance that is not a positive number all refuse.
 */
export function applyFailPolicy(input: FailPolicyInput): FailPolicyOutcome {
  const { policy, toleranceMs, snapshot, now } = input
  if (policy !== 'last_known_state' || snapshot === null) return { allow: false }
  return ageOf(snapshot, now) < toleranceMs ? { allow: true, snapshot } : { allow: false }
}
