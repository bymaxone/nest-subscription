/**
 * @fileoverview The pure decision the guard takes once it holds a snapshot: allow, or one of the
 * two reasons to refuse. It reads the entitlements of the snapshot and the instant it is given,
 * nothing else, so a table of snapshots tests every branch.
 * @layer core
 */
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { entitlementHeld } from '../entitlement-held'

/**
 * What the guard does with a snapshot: `allow`; `no_subscription` when nothing in the snapshot
 * grants the entitlement; `no_access` when a subscription grants it and none gives access now.
 */
export type AccessDecision = 'allow' | 'no_subscription' | 'no_access'

/**
 * Decides whether an account may use an entitlement. An entitlement the account holds is one
 * whose active flag is true and whose `until` is `null` or later than `now`. An entitlement that
 * appears in the snapshot without being held is one a subscription grants and no subscription
 * gives access to (the model lists an entitlement only when a subscription grants it), which is
 * "a subscription exists and gives no access". One that does not appear is "no subscription".
 *
 * @param snapshot The account's snapshot.
 * @param entitlementName The entitlement the route needs.
 * @param now The instant to decide at, from the injected clock.
 */
export function decideAccess(
  snapshot: SubscriptionSnapshot,
  entitlementName: string,
  now: Date
): AccessDecision {
  const nowMs = now.getTime()
  const named = snapshot.entitlements.filter((candidate) => candidate.name === entitlementName)
  if (named.length === 0) return 'no_subscription'
  return named.some((candidate) => entitlementHeld(candidate, nowMs)) ? 'allow' : 'no_access'
}
