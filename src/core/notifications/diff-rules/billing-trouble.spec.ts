/**
 * @fileoverview Pins the billing-trouble rules: entering grace, being put on hold and recovering from either, each with the facts that tell it from the next.
 * @layer core
 */
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { billingTroubleChanges } from './billing-trouble'

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

const ISSUE = '2026-01-20T00:00:00.000Z'

describe('billingTroubleChanges', () => {
  it('reports entered_grace told apart by the issue instant and the period end', () => {
    // Scenario: an active subscription moves into its grace period.
    const current = record({ status: 'in_grace', billingIssueSince: ISSUE })
    expect(billingTroubleChanges({ previous: record(), current })).toStrictEqual([
      {
        kind: 'entered_grace',
        subscriptionReference: 'sub-1',
        facts: [ISSUE, BASE.currentPeriodEnd]
      }
    ])
  })

  it('reports put_on_hold told apart by the issue instant and the period end', () => {
    // Scenario: a subscription in grace moves on hold.
    const previous = record({ status: 'in_grace', billingIssueSince: ISSUE })
    const current = record({ status: 'on_hold', billingIssueSince: ISSUE })
    expect(billingTroubleChanges({ previous, current })).toStrictEqual([
      {
        kind: 'put_on_hold',
        subscriptionReference: 'sub-1',
        facts: [ISSUE, BASE.currentPeriodEnd]
      }
    ])
  })

  it('uses the empty string when the billing issue has no instant', () => {
    // Scenario: the source puts the subscription in grace or on hold without saying since when.
    const grace = billingTroubleChanges({
      previous: record(),
      current: record({ status: 'in_grace' })
    })
    const hold = billingTroubleChanges({
      previous: record(),
      current: record({ status: 'on_hold' })
    })
    expect([grace[0]?.facts[0], hold[0]?.facts[0]]).toStrictEqual(['', ''])
  })

  it.each([
    ['in_grace', 'active'],
    ['in_grace', 'trialing'],
    ['on_hold', 'active'],
    ['on_hold', 'trialing']
  ] as const)('reports recovered for a move from %s to %s', (before, after) => {
    // Scenario: the billing issue is resolved; the change is told apart by the issue it closed.
    const previous = record({ status: before, billingIssueSince: ISSUE })
    expect(billingTroubleChanges({ previous, current: record({ status: after }) })).toStrictEqual([
      {
        kind: 'recovered',
        subscriptionReference: 'sub-1',
        facts: [ISSUE, BASE.currentPeriodEnd]
      }
    ])
  })

  it('uses the empty string for a recovery from an issue with no instant', () => {
    // Scenario: the previous record carried no issue instant.
    const previous = record({ status: 'in_grace' })
    expect(billingTroubleChanges({ previous, current: record() })[0]?.facts[0]).toBe('')
  })

  it.each([
    ['in_grace to expired', 'in_grace', 'expired'],
    ['in_grace to in_grace', 'in_grace', 'in_grace'],
    ['on_hold to on_hold', 'on_hold', 'on_hold'],
    ['active to active', 'active', 'active'],
    ['active to expired', 'active', 'expired']
  ] as const)('reports nothing for a move from %s', (_name, before, after) => {
    // Scenario: a move that neither enters trouble nor recovers.
    const previous = record({ status: before })
    expect(billingTroubleChanges({ previous, current: record({ status: after }) })).toStrictEqual(
      []
    )
  })
})
