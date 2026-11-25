/**
 * @fileoverview Pins the renewal-intent rules: the intent flips to and from `no` and only there, and each flip carries the facts that tell it from the next.
 * @layer core
 */
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { renewalIntentChanges } from './renewal-intent'

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

describe('renewalIntentChanges', () => {
  it('reports will_not_renew told apart by the period end and the cancellation instant', () => {
    // Scenario: the intent goes from yes to no with a cancellation instant.
    const current = record({ willRenew: 'no', cancelledAt: '2026-01-10T00:00:00.000Z' })
    expect(renewalIntentChanges({ previous: record(), current })).toStrictEqual([
      {
        kind: 'will_not_renew',
        subscriptionReference: 'sub-1',
        facts: [BASE.currentPeriodEnd, '2026-01-10T00:00:00.000Z']
      }
    ])
  })

  it('uses the empty string for a will_not_renew with no cancellation instant', () => {
    // Scenario: the source says no renewal but gives no cancellation instant.
    const current = record({ willRenew: 'no' })
    expect(renewalIntentChanges({ previous: record(), current })[0]?.facts).toStrictEqual([
      BASE.currentPeriodEnd,
      ''
    ])
  })

  it('reports will_renew_again told apart by the cancellation it undoes', () => {
    // Scenario: the intent goes from no back to yes.
    const previous = record({ willRenew: 'no', cancelledAt: '2026-01-10T00:00:00.000Z' })
    expect(renewalIntentChanges({ previous, current: record() })).toStrictEqual([
      {
        kind: 'will_renew_again',
        subscriptionReference: 'sub-1',
        facts: [BASE.currentPeriodEnd, '2026-01-10T00:00:00.000Z']
      }
    ])
  })

  it('uses the empty string for a will_renew_again that undoes no recorded cancellation', () => {
    // Scenario: the previous record had no cancellation instant.
    const previous = record({ willRenew: 'no' })
    expect(renewalIntentChanges({ previous, current: record() })[0]?.facts).toStrictEqual([
      BASE.currentPeriodEnd,
      ''
    ])
  })

  it('treats a move from no to an unknown intent as renewing again', () => {
    // Scenario: the flip is from `no` to anything else, not only to `yes`.
    const previous = record({ willRenew: 'no' })
    const current = record({ willRenew: 'unknown' })
    expect(renewalIntentChanges({ previous, current }).map((c) => c.kind)).toStrictEqual([
      'will_renew_again'
    ])
  })

  it.each([
    ['yes to changes_product', 'yes', 'changes_product'],
    ['yes to unknown', 'yes', 'unknown'],
    ['no to no', 'no', 'no'],
    ['yes to yes', 'yes', 'yes']
  ] as const)('reports nothing for a move from %s', (_name, before, after) => {
    // Scenario: a move that neither enters nor leaves `no`.
    const previous = record({ willRenew: before })
    expect(renewalIntentChanges({ previous, current: record({ willRenew: after }) })).toStrictEqual(
      []
    )
  })
})
