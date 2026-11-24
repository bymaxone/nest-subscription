/**
 * @fileoverview Exercises the pure functions of the model through the `shared` subpath alias, the
 * way a host or a client imports them.
 * @layer e2e
 */
import {
  SubscriptionInputError,
  createEmptySnapshot,
  resolveEntitlements,
  type SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'

const START = '2026-01-01T00:00:00.000Z'
const END = '2026-02-01T00:00:00.000Z'
const LATER = '2026-03-01T00:00:00.000Z'

function record(reference: string, overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    subscriptionReference: reference,
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'web',
    environment: 'production',
    productReference: 'pro',
    billingInterval: 'month',
    currentPeriodStart: START,
    currentPeriodEnd: END,
    accessUntil: END,
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null,
    ...overrides
  }
}

describe('model through the shared subpath', () => {
  it('builds the snapshot of an unknown account with and without a tenant', () => {
    // Scenario: the source has no record of the account.
    const plain = createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: START })
    const tenant = createEmptySnapshot({
      accountId: 'a',
      tenantId: 't',
      source: 's',
      fetchedAt: START
    })
    expect(plain.entitlements).toEqual([])
    expect('tenantId' in plain).toBe(false)
    expect(tenant.tenantId).toBe('t')
  })

  it('resolves two active subscriptions to the latest end and reports the overlap', () => {
    // Scenario: one from a store and one from the web grant the same entitlement.
    const result = resolveEntitlements(
      [record('s1', { accessUntil: END }), record('s2', { accessUntil: LATER })],
      new Map([
        ['s1', ['pro', 'pro']],
        ['s2', ['pro']]
      ])
    )
    expect(result.entitlements).toEqual([
      { name: 'pro', active: true, until: LATER, grantingSubscriptionReference: 's2' }
    ])
    expect(result.overlapping).toEqual(['pro'])
  })

  it('lets a lifetime grant outrank a dated one and keeps the first of equals', () => {
    // Scenario: a lifetime grant beside a dated one and a second lifetime grant.
    const result = resolveEntitlements(
      [
        record('s1', { accessUntil: END }),
        record('s2', { accessUntil: null }),
        record('s3', { accessUntil: null })
      ],
      new Map([
        ['s1', ['pro']],
        ['s2', ['pro']],
        ['s3', ['pro']]
      ])
    )
    expect(result.entitlements[0]?.grantingSubscriptionReference).toBe('s2')
    expect(result.entitlements[0]?.until).toBeNull()
  })

  it('keeps an entitlement inactive when no grantor gives access', () => {
    // Scenario: the grantors ended; the latest end is reported, or none when none is dated.
    const dated = resolveEntitlements(
      [
        record('s1', { givesAccess: false }),
        record('s2', { givesAccess: false, accessUntil: START })
      ],
      new Map([
        ['s1', ['pro']],
        ['s2', ['pro']]
      ])
    )
    const undated = resolveEntitlements(
      [record('s1', { givesAccess: false, accessUntil: null })],
      new Map([['s1', ['pro']]])
    )
    expect(dated.entitlements).toEqual([
      { name: 'pro', active: false, until: END, grantingSubscriptionReference: null }
    ])
    expect(undated.entitlements[0]?.until).toBeNull()
  })

  it('grants nothing for a subscription with no grant entry', () => {
    // Scenario: the grants map does not name the subscription.
    expect(resolveEntitlements([record('s1', {})], new Map()).entitlements).toEqual([])
  })

  it('refuses a malformed instant with a typed error', () => {
    // Scenario: a caller passes a subscription whose end is not a date.
    expect(() => resolveEntitlements([record('s1', { accessUntil: 'x' })], new Map())).toThrow(
      SubscriptionInputError
    )
  })
})
