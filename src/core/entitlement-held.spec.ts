/**
 * @fileoverview Pins the one rule that says whether an entitlement gives access at an instant: its
 * active flag is true and its `until` is `null` or later than the instant; an `until` that cannot
 * be read gives no access.
 * @layer core
 */
import type { EntitlementState } from '@bymax-one/nest-subscription/shared'

import { entitlementHeld } from './entitlement-held'

const NOW = Date.parse('2026-01-01T00:00:00.000Z')

/** An entitlement state with the two fields the rule reads. */
function state(active: boolean, until: string | null): EntitlementState {
  return { name: 'pro', active, until, grantingSubscriptionReference: null }
}

describe('entitlementHeld', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'gives no access when the instant is %d',
    (instant) => {
      // Scenario: an entitlement with no end and a clock that cannot say what time it is; with no
      // readable now nothing is held.
      expect(entitlementHeld(state(true, null), instant)).toBe(false)
    }
  )

  it.each([
    ['active with no end', state(true, null), true],
    ['active until a later instant', state(true, '2026-01-01T00:00:00.001Z'), true],
    ['active until exactly now', state(true, '2026-01-01T00:00:00.000Z'), false],
    ['active until an earlier instant', state(true, '2025-12-31T23:59:59.999Z'), false],
    ['inactive with no end', state(false, null), false],
    ['inactive until a later instant', state(false, '2027-01-01T00:00:00.000Z'), false],
    ['active with an unreadable end', state(true, 'not-a-date'), false],
    ['active with an empty end', state(true, ''), false]
  ])('decides %s', (_title, entitlement, expected) => {
    // Scenario: each row crosses the active flag with the end instant, including the instant
    // equal to now (no longer held) and an end that does not parse (never held).
    expect(entitlementHeld(entitlement, NOW)).toBe(expected)
  })
})
