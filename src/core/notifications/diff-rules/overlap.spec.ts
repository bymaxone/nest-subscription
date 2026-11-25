/**
 * @fileoverview Pins the overlap rule: two subscriptions giving access at once is reported when it was not so before, from the access flag alone.
 * @layer core
 */
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { overlapChanges } from './overlap'

const BASE: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A record with the given fields changed. */
function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return { ...BASE, ...overrides }
}

/** A snapshot holding the given subscriptions, with the given source customer. */
function snapshotOf(
  subscriptions: readonly SubscriptionRecord[],
  customer: string | null = 'cust-1'
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
    subscriptions,
    sourceCustomer: customer === null ? null : { id: customer }
  }
}

describe('overlapChanges', () => {
  const TWO = snapshotOf([
    record({ subscriptionReference: 'b' }),
    record({ subscriptionReference: 'a' })
  ])

  it('reports overlap_detected with the overlapping references sorted', () => {
    // Scenario: a second subscription starts giving access beside the first.
    const previous = snapshotOf([record({ subscriptionReference: 'a' })])
    expect(overlapChanges(previous, TWO)).toStrictEqual([
      { kind: 'overlap_detected', subscriptionReference: null, facts: ['a', 'b'] }
    ])
  })

  it('reports overlap on first contact', () => {
    // Scenario: the account is seen for the first time with two subscriptions giving access.
    expect(overlapChanges(null, TWO).map((change) => change.kind)).toStrictEqual([
      'overlap_detected'
    ])
  })

  it('reports nothing when it already overlapped', () => {
    // Scenario: two subscriptions gave access before and still do.
    expect(overlapChanges(TWO, TWO)).toStrictEqual([])
  })

  it('reports nothing for one subscription giving access', () => {
    // Scenario: the other subscription does not give access, whatever its status name says.
    const current = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b', status: 'active', givesAccess: false })
    ])
    expect(overlapChanges(null, current)).toStrictEqual([])
  })

  it('counts a subscription that gives access whatever its status', () => {
    // Scenario: the access flag decides, so an expired status that still gives access overlaps.
    const current = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b', status: 'expired', givesAccess: true })
    ])
    expect(overlapChanges(null, current)).toHaveLength(1)
  })
})
