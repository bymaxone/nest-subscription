/**
 * @fileoverview The one rule that says whether an entitlement gives access at an instant, shared
 * by the service's read and the guard's decision so the two never disagree. It reads the active
 * flag and the access-until instant and nothing else; no status name decides access.
 * @layer core
 */
import { parseInstant, type EntitlementState } from '@bymax-one/nest-subscription/shared'

/**
 * Whether an entitlement gives access at `nowMs` (milliseconds since the epoch): its active flag
 * is true and its `until` is `null` (no end) or later than `nowMs`. An `until` that cannot be read
 * gives no access.
 */
export function entitlementHeld(entitlement: EntitlementState, nowMs: number): boolean {
  if (!entitlement.active) return false
  if (entitlement.until === null) return true
  try {
    return parseInstant(entitlement.until) > nowMs
  } catch {
    return false
  }
}
