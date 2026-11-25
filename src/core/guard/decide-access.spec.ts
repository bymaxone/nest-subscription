/**
 * @fileoverview Pins the pure access decision by table: the same snapshot, entitlement name and
 * instant always give the same answer, and the answer separates "no subscription" from
 * "a subscription exists and gives no access".
 * @layer core
 */
import {
  createEmptySnapshot,
  type EntitlementState,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { decideAccess } from './decide-access'

const NOW = new Date('2026-01-01T00:00:00.000Z')

/** A snapshot holding exactly the given entitlement states. */
function snapshotWith(...entitlements: EntitlementState[]): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt: NOW.toISOString() }),
    entitlements
  }
}

/** An entitlement state of the name `premium` unless another is given. */
function entitlement(active: boolean, until: string | null, name = 'premium'): EntitlementState {
  return { name, active, until, grantingSubscriptionReference: active ? 'sub-1' : null }
}

describe('decideAccess', () => {
  it.each([
    ['active with no end', snapshotWith(entitlement(true, null)), 'premium', 'allow'],
    [
      'active until a later instant',
      snapshotWith(entitlement(true, '2026-01-01T00:00:00.001Z')),
      'premium',
      'allow'
    ],
    [
      'active until exactly now',
      snapshotWith(entitlement(true, '2026-01-01T00:00:00.000Z')),
      'premium',
      'no_access'
    ],
    [
      'active until an earlier instant',
      snapshotWith(entitlement(true, '2025-12-31T23:59:59.999Z')),
      'premium',
      'no_access'
    ],
    [
      'active with an unreadable end',
      snapshotWith(entitlement(true, 'not-a-date')),
      'premium',
      'no_access'
    ],
    ['inactive with no end', snapshotWith(entitlement(false, null)), 'premium', 'no_access'],
    [
      'inactive even though its end is in the future',
      snapshotWith(entitlement(false, '2027-01-01T00:00:00.000Z')),
      'premium',
      'no_access'
    ],
    [
      'only another entitlement is held',
      snapshotWith(entitlement(true, null, 'basic')),
      'premium',
      'no_subscription'
    ],
    [
      'another entitlement is held and the asked one is not',
      snapshotWith(entitlement(true, null, 'basic'), entitlement(false, null, 'premium')),
      'premium',
      'no_access'
    ],
    [
      'two entries share the name and one is held',
      snapshotWith(entitlement(false, null), entitlement(true, null)),
      'premium',
      'allow'
    ],
    ['an empty snapshot', snapshotWith(), 'premium', 'no_subscription'],
    [
      'the name differs only by case',
      snapshotWith(entitlement(true, null, 'Premium')),
      'premium',
      'no_subscription'
    ]
  ] as const)('answers %s', (_title, snapshot, name, expected) => {
    // Scenario: each row is one snapshot, one entitlement name and the instant NOW; the row names
    // the answer, so a change to any branch of the rule changes one row.
    expect(decideAccess(snapshot, name, NOW)).toBe(expected)
  })

  it('does not change the snapshot it reads', () => {
    // Scenario: the decision is a pure function; the snapshot read is equal, at every depth, to
    // an independent copy taken before the call.
    const snapshot = snapshotWith(entitlement(true, null))
    const before = structuredClone(snapshot)
    expect(decideAccess(snapshot, 'premium', NOW)).toBe('allow')
    expect(snapshot).toStrictEqual(before)
  })
})
