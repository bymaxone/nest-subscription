/**
 * @fileoverview Pins the view a caller receives: an independent, deeply frozen copy of a stored
 * snapshot that carries its age, so no caller can change what the store or the cache holds.
 * @layer core
 */
import { createEmptySnapshot, resolveEntitlements } from '@bymax-one/nest-subscription/shared'
import type { SubscriptionRecord, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import { toSnapshotView } from './snapshot-view'

/** A subscription that gives access to nothing in particular until its grants say so. */
const SUBSCRIPTION: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'web',
  environment: 'production',
  productReference: 'pro',
  billingInterval: 'month',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A snapshot with one subscription and one entitlement. */
function populated(): SubscriptionSnapshot {
  const { entitlements } = resolveEntitlements([SUBSCRIPTION], new Map([['sub-1', ['pro']]]))
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
    entitlements,
    subscriptions: [SUBSCRIPTION],
    sourceCustomer: { id: 'c' }
  }
}

describe('toSnapshotView', () => {
  it('carries every field of the snapshot and its age', () => {
    // Scenario: the view equals the snapshot with one more field.
    const snapshot = populated()
    expect(toSnapshotView(snapshot, 1234)).toEqual({ ...snapshot, ageMs: 1234 })
  })

  it('freezes the view and every object and array inside it', () => {
    // Scenario: the top level, the lists, a list element and a nested object are all frozen.
    const view = toSnapshotView(populated(), 0)
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.entitlements)).toBe(true)
    expect(Object.isFrozen(view.entitlements[0])).toBe(true)
    expect(Object.isFrozen(view.subscriptions)).toBe(true)
    expect(Object.isFrozen(view.subscriptions[0])).toBe(true)
    expect(Object.isFrozen(view.sourceCustomer)).toBe(true)
  })

  it('does not freeze or change the snapshot it was made from', () => {
    // Scenario: the stored object stays mutable and untouched, because the view is a copy.
    const snapshot = populated()
    const view = toSnapshotView(snapshot, 0)
    expect(Object.isFrozen(snapshot)).toBe(false)
    expect(Object.isFrozen(snapshot.entitlements)).toBe(false)
    expect(view.entitlements).not.toBe(snapshot.entitlements)
    expect(snapshot).not.toHaveProperty('ageMs')
  })

  it('refuses a write to the view and to what is inside it', () => {
    // Scenario: a caller tries to change a nested field and a top-level field; both stay as they were.
    const view = toSnapshotView(populated(), 0)
    const entitlement = view.entitlements[0]
    expect(entitlement).toBeDefined()
    expect(Reflect.set(entitlement ?? {}, 'active', false)).toBe(false)
    expect(entitlement?.active).toBe(true)
    expect(Reflect.set(view, 'accountId', 'other')).toBe(false)
    expect(view.accountId).toBe('a')
  })
})
