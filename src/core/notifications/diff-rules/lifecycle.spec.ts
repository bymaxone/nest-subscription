/**
 * @fileoverview Pins the lifecycle rules: when a subscription started, renewed, converted from a
 * trial or expired, and what tells one such change from the next.
 * @layer core
 */
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { lifecycleChanges, startedChanges } from './lifecycle'

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

/** A snapshot holding the given subscriptions. */
function snapshotOf(subscriptions: readonly SubscriptionRecord[]): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: '2026-01-01T00:00:00.000Z' }),
    subscriptions
  }
}

describe('startedChanges', () => {
  it('reports one start per subscription of a first contact, told apart by period start', () => {
    // Scenario: no previous snapshot and two subscriptions now.
    const current = snapshotOf([
      record({ subscriptionReference: 'a', currentPeriodStart: '2026-01-01T00:00:00.000Z' }),
      record({ subscriptionReference: 'b', currentPeriodStart: '2026-01-05T00:00:00.000Z' })
    ])
    expect(startedChanges(null, current)).toStrictEqual([
      { kind: 'started', subscriptionReference: 'a', facts: ['2026-01-01T00:00:00.000Z'] },
      { kind: 'started', subscriptionReference: 'b', facts: ['2026-01-05T00:00:00.000Z'] }
    ])
  })

  it('reports a start when the previous snapshot held no subscription', () => {
    // Scenario: a known account with an empty subscription list buys.
    expect(startedChanges(snapshotOf([]), snapshotOf([record()]))).toHaveLength(1)
  })

  it('reports nothing when the previous snapshot already held a subscription', () => {
    // Scenario: a second subscription beside an existing one is not a start.
    const previous = snapshotOf([record({ subscriptionReference: 'a' })])
    const current = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b' })
    ])
    expect(startedChanges(previous, current)).toStrictEqual([])
  })

  it('reports nothing when the current snapshot holds no subscription', () => {
    // Scenario: a first contact with an account the source has no purchase for.
    expect(startedChanges(null, snapshotOf([]))).toStrictEqual([])
  })
})

describe('lifecycleChanges', () => {
  const RENEWED = record({ currentPeriodEnd: '2026-03-01T00:00:00.000Z' })

  it('reports a renewal told apart by the new period end', () => {
    // Scenario: an active subscription stays active and its period moves forward.
    expect(lifecycleChanges({ previous: record(), current: RENEWED })).toStrictEqual([
      { kind: 'renewed', subscriptionReference: 'sub-1', facts: ['2026-03-01T00:00:00.000Z'] }
    ])
  })

  it.each([
    ['the period end is the same', record()],
    ['the period end is earlier', record({ currentPeriodEnd: '2026-01-15T00:00:00.000Z' })],
    ['the period end is not a readable instant', record({ currentPeriodEnd: 'soon' })],
    ['the subscription is now in grace', record({ ...RENEWED, status: 'in_grace' })]
  ])('reports no renewal when %s', (_name, current) => {
    // Scenario: each way a pair can fail the renewal rule.
    expect(lifecycleChanges({ previous: record(), current })).toStrictEqual([])
  })

  it('reports no renewal when the previous status was not active', () => {
    // Scenario: a trial that moves its period is a conversion at most, not a renewal.
    const previous = record({ status: 'trialing' })
    expect(
      lifecycleChanges({ previous, current: RENEWED }).map((change) => change.kind)
    ).toStrictEqual(['trial_converted'])
  })

  it('reports a trial conversion told apart by the period start', () => {
    // Scenario: trialing becomes active in the same period.
    const previous = record({ status: 'trialing' })
    expect(lifecycleChanges({ previous, current: record() })).toStrictEqual([
      { kind: 'trial_converted', subscriptionReference: 'sub-1', facts: [BASE.currentPeriodStart] }
    ])
  })

  it('reports an expiry told apart by the access end and the period end', () => {
    // Scenario: an active subscription expires.
    const current = record({ status: 'expired', givesAccess: false })
    expect(lifecycleChanges({ previous: record(), current })).toStrictEqual([
      {
        kind: 'expired',
        subscriptionReference: 'sub-1',
        facts: [BASE.accessUntil, BASE.currentPeriodEnd]
      }
    ])
  })

  it('uses the empty string for an expiry with no access end', () => {
    // Scenario: a lifetime grant (no access end) that expires.
    const previous = record({ accessUntil: null })
    const current = record({ accessUntil: null, status: 'expired', givesAccess: false })
    expect(lifecycleChanges({ previous, current })[0]?.facts).toStrictEqual([
      '',
      BASE.currentPeriodEnd
    ])
  })

  it('reports no expiry for a subscription that was already expired', () => {
    // Scenario: expired before and expired now.
    const expired = record({ status: 'expired', givesAccess: false })
    expect(lifecycleChanges({ previous: expired, current: expired })).toStrictEqual([])
  })

  it('reports nothing for two equal records', () => {
    // Scenario: nothing about the subscription changed.
    expect(lifecycleChanges({ previous: record(), current: record() })).toStrictEqual([])
  })
})
