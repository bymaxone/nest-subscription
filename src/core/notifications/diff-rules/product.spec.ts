/**
 * @fileoverview Pins the product rule: a different product reference is a change, with both products and the new period start as its facts.
 * @layer core
 */
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { productChanges } from './product'

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

describe('productChanges', () => {
  it('reports product_changed with both products and the period start', () => {
    // Scenario: the subscription moves from monthly to yearly.
    const current = record({ productReference: 'pro_yearly' })
    expect(productChanges({ previous: record(), current })).toStrictEqual([
      {
        kind: 'product_changed',
        subscriptionReference: 'sub-1',
        facts: ['pro_monthly', 'pro_yearly', BASE.currentPeriodStart]
      }
    ])
  })

  it('reports nothing when the product is the same', () => {
    // Scenario: only another field changed.
    const current = record({ billingInterval: 'P1Y' })
    expect(productChanges({ previous: record(), current })).toStrictEqual([])
  })
})
