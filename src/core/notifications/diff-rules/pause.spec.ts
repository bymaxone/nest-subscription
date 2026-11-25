/**
 * @fileoverview Pins the pause rules: a subscription that was paused and one that resumed, each with the period that tells it from the next.
 * @layer core
 */
import type { SubscriptionRecord } from '@bymax-one/nest-subscription/shared'

import { pauseChanges } from './pause'

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

describe('pauseChanges', () => {
  it('reports paused told apart by the period end', () => {
    // Scenario: an active subscription becomes paused.
    expect(
      pauseChanges({ previous: record(), current: record({ status: 'paused' }) })
    ).toStrictEqual([
      { kind: 'paused', subscriptionReference: 'sub-1', facts: [BASE.currentPeriodEnd] }
    ])
  })

  it.each(['active', 'trialing'] as const)(
    'reports resumed when a paused one becomes %s',
    (after) => {
      // Scenario: a paused subscription is live again; the change is told apart by the period start.
      const previous = record({ status: 'paused' })
      expect(pauseChanges({ previous, current: record({ status: after }) })).toStrictEqual([
        { kind: 'resumed', subscriptionReference: 'sub-1', facts: [BASE.currentPeriodStart] }
      ])
    }
  )

  it.each([
    ['paused to paused', 'paused', 'paused'],
    ['paused to expired', 'paused', 'expired'],
    ['active to active', 'active', 'active'],
    ['active to in_grace', 'active', 'in_grace']
  ] as const)('reports nothing for a move from %s', (_name, before, after) => {
    // Scenario: a move that neither pauses nor resumes.
    const previous = record({ status: before })
    expect(pauseChanges({ previous, current: record({ status: after }) })).toStrictEqual([])
  })
})
