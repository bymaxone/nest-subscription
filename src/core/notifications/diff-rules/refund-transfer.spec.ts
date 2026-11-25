/**
 * @fileoverview Pins the refund and transfer rules: a refund instant appearing, and an account whose purchases move to another customer or away.
 * @layer core
 */
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { refundChanges, transferChanges } from './refund-transfer'

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

const REFUNDED = '2026-01-12T00:00:00.000Z'

describe('refundChanges', () => {
  it('reports refunded told apart by the refund instant', () => {
    // Scenario: the refund instant appears.
    const current = record({ refundedAt: REFUNDED })
    expect(refundChanges({ previous: record(), current })).toStrictEqual([
      { kind: 'refunded', subscriptionReference: 'sub-1', facts: [REFUNDED] }
    ])
  })

  it('reports nothing when the refund was already recorded', () => {
    // Scenario: a refunded subscription stays refunded.
    const refunded = record({ refundedAt: REFUNDED })
    expect(refundChanges({ previous: refunded, current: refunded })).toStrictEqual([])
  })

  it('reports nothing when there is no refund', () => {
    // Scenario: neither record has a refund instant.
    expect(refundChanges({ previous: record(), current: record() })).toStrictEqual([])
  })
})

describe('transferChanges', () => {
  it('reports nothing on first contact', () => {
    // Scenario: there is no previous snapshot to move away from.
    expect(transferChanges(null, snapshotOf([record()]))).toStrictEqual([])
  })

  it('reports nothing for equal snapshots', () => {
    // Scenario: same customer and the same subscriptions.
    expect(transferChanges(snapshotOf([record()]), snapshotOf([record()]))).toStrictEqual([])
  })

  it('reports nothing when the customer is first linked', () => {
    // Scenario: the previous snapshot had no customer and the current one has.
    expect(transferChanges(snapshotOf([record()], null), snapshotOf([record()]))).toStrictEqual([])
  })

  it('reports a transfer when the source customer changes, told apart by the new customer', () => {
    // Scenario: the subscriptions now belong to another customer of the source.
    const changes = transferChanges(snapshotOf([record()]), snapshotOf([record()], 'cust-2'))
    expect(changes).toStrictEqual([
      { kind: 'transferred', subscriptionReference: null, facts: ['cust-2'] }
    ])
  })

  it('reports a transfer when the source customer disappears', () => {
    // Scenario: the source no longer has a record of the customer.
    const changes = transferChanges(snapshotOf([record()]), snapshotOf([record()], null))
    expect(changes).toStrictEqual([
      { kind: 'transferred', subscriptionReference: null, facts: [''] }
    ])
  })

  it('reports a transfer when subscriptions move away, with their references sorted', () => {
    // Scenario: two subscriptions leave in a different order than they are sorted.
    const previous = snapshotOf([
      record({ subscriptionReference: 'z' }),
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'keep' })
    ])
    const current = snapshotOf([record({ subscriptionReference: 'keep' })])
    expect(transferChanges(previous, current)).toStrictEqual([
      { kind: 'transferred', subscriptionReference: null, facts: ['cust-1', 'a', 'z'] }
    ])
  })

  it('gives the same change when both lists are reversed', () => {
    // Scenario: the same move with the order of both lists reversed.
    const a = record({ subscriptionReference: 'a' })
    const b = record({ subscriptionReference: 'b' })
    const keep = record({ subscriptionReference: 'keep' })
    const forward = transferChanges(snapshotOf([a, b, keep]), snapshotOf([keep]))
    const reversed = transferChanges(snapshotOf([keep, b, a]), snapshotOf([keep]))
    expect(reversed).toStrictEqual(forward)
  })

  it('reports no transfer when a subscription is added', () => {
    // Scenario: the current snapshot holds more than the previous one.
    const current = snapshotOf([record(), record({ subscriptionReference: 'sub-2' })])
    expect(transferChanges(snapshotOf([record()]), current)).toStrictEqual([])
  })
})
