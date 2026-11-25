/**
 * @fileoverview Pins the overlap rule: an entitlement that two or more subscriptions grant and give
 * access to is reported when it had at most one such grantor before, per entitlement, from the
 * grantors the snapshots record and from nothing else.
 * @layer core
 */
import {
  createEmptySnapshot,
  type EntitlementState,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { overlapChanges } from './overlap'

/** An entitlement granted by the given subscriptions, which are sorted already. */
function entitlement(name: string, grantors: readonly string[]): EntitlementState {
  return {
    name,
    active: grantors.length > 0,
    until: null,
    grantingSubscriptionReference: grantors[0] ?? null,
    grantingSubscriptionReferences: grantors
  }
}

/** A snapshot holding the given entitlements and no subscription: the rule reads none. */
function snapshotOf(...entitlements: EntitlementState[]): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
    entitlements
  }
}

describe('overlapChanges', () => {
  it('reports overlap_detected told apart by the entitlement and its grantors', () => {
    // Scenario: a second subscription starts granting pro beside the first.
    const previous = snapshotOf(entitlement('pro', ['a']))
    const current = snapshotOf(entitlement('pro', ['a', 'b']))
    expect(overlapChanges(previous, current)).toStrictEqual([
      { kind: 'overlap_detected', subscriptionReference: null, facts: ['pro', 'a', 'b'] }
    ])
  })

  it('reports overlap on first contact', () => {
    // Scenario: the account is seen for the first time with two grantors of one entitlement.
    expect(overlapChanges(null, snapshotOf(entitlement('pro', ['a', 'b'])))).toHaveLength(1)
  })

  it('reports overlap for an entitlement the previous snapshot did not hold', () => {
    // Scenario: the entitlement is new, so it had no grantor before.
    const previous = snapshotOf(entitlement('other', ['x', 'y']))
    expect(overlapChanges(previous, snapshotOf(entitlement('pro', ['a', 'b'])))).toHaveLength(1)
  })

  it('reports each overlapping entitlement on its own, in the order of the snapshot', () => {
    // Scenario: two entitlements start overlapping in one comparison, and a third does not.
    const current = snapshotOf(
      entitlement('zeta', ['a', 'b']),
      entitlement('solo', ['a']),
      entitlement('alpha', ['b', 'c'])
    )
    expect(overlapChanges(null, current).map((change) => change.facts[0])).toStrictEqual([
      'zeta',
      'alpha'
    ])
  })

  it.each([
    ['two grantors before and after', ['a', 'b'], ['a', 'b']],
    ['a third grantor added to two', ['a', 'b'], ['a', 'b', 'c']],
    ['two grantors replaced by another two', ['a', 'b'], ['c', 'd']]
  ])('reports nothing for %s', (_name, before, after) => {
    // Scenario: the entitlement already overlapped, so a change in who grants it is not new.
    const previous = snapshotOf(entitlement('pro', before))
    expect(overlapChanges(previous, snapshotOf(entitlement('pro', after)))).toStrictEqual([])
  })

  it('looks up the previous grantors of the entitlement by its name', () => {
    // Scenario: pro already overlapped, listed after another entitlement that had one grantor.
    const previous = snapshotOf(entitlement('other', ['x']), entitlement('pro', ['a', 'b']))
    const current = snapshotOf(entitlement('other', ['x']), entitlement('pro', ['a', 'b', 'c']))
    expect(overlapChanges(previous, current)).toStrictEqual([])
  })

  it('reports nothing for one grantor of each of two entitlements', () => {
    // Scenario: an App Store subscription grants pro and a web one grants addon.
    const current = snapshotOf(entitlement('pro', ['app']), entitlement('addon', ['web']))
    expect(overlapChanges(snapshotOf(entitlement('pro', ['app'])), current)).toStrictEqual([])
  })

  it('reports nothing for an entitlement nobody grants', () => {
    // Scenario: an entitlement with an empty list of grantors.
    expect(overlapChanges(null, snapshotOf(entitlement('pro', [])))).toStrictEqual([])
  })
})
