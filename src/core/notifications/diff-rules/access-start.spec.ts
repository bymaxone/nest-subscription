/**
 * @fileoverview Pins `started` for access that begins on an account that already holds records:
 * an entitlement nothing gave access to before gets a grantor. Each case reads the comparison of
 * two snapshots, as the host's hook does.
 * @layer core
 */
import {
  createEmptySnapshot,
  resolveEntitlements,
  type NonRenewingPurchaseRecord,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { diffCandidates, diffSnapshots } from '../diff-snapshots'

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

const PURCHASE: NonRenewingPurchaseRecord = {
  purchaseReference: 'buy-1',
  entitlementNames: ['premium'],
  givesAccess: true,
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_lifetime',
  purchasedAt: '2026-03-01T00:00:00.000Z',
  accessUntil: null,
  refundedAt: null
}

/** A record with the given fields changed. */
function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return { ...BASE, ...overrides }
}

/** The first subscription after it expired. */
const EXPIRED = record({ status: 'expired', givesAccess: false })

/** A subscription bought after the first one. */
const SECOND = record({
  subscriptionReference: 'sub-2',
  currentPeriodStart: '2026-03-01T00:00:00.000Z',
  currentPeriodEnd: '2026-04-01T00:00:00.000Z',
  accessUntil: '2026-04-01T00:00:00.000Z'
})

/**
 * A snapshot of the given records, its entitlements resolved as an adapter resolves them. Every
 * record grants `premium` unless `grants` names other entitlements for its reference.
 */
function snapshotOf(
  subscriptions: readonly SubscriptionRecord[],
  purchases: readonly NonRenewingPurchaseRecord[] = [],
  grants: Readonly<Record<string, readonly string[]>> = {},
  fetchedAt = '2026-01-01T00:00:00.000Z'
): SubscriptionSnapshot {
  const granted = new Map(
    subscriptions.map((s): [string, readonly string[]] => [
      s.subscriptionReference,
      grants[s.subscriptionReference] ?? ['premium']
    ])
  )
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt }),
    subscriptions,
    nonRenewingPurchases: purchases,
    entitlements: resolveEntitlements(subscriptions, granted, purchases).entitlements,
    sourceCustomer: { id: 'cust-1' }
  }
}

/** The kind and subscription of each change between the two snapshots. */
function changesOf(previous: SubscriptionSnapshot, current: SubscriptionSnapshot): string[] {
  return diffCandidates(previous, current).map((c) => `${c.kind} ${c.subscriptionReference}`)
}

describe('access that begins on an account with records', () => {
  it('reports a start for a new subscription beside an expired one', () => {
    // Scenario: the account lost access and bought again; the old record is still listed.
    expect(changesOf(snapshotOf([EXPIRED]), snapshotOf([EXPIRED, SECOND]))).toStrictEqual([
      'started sub-2'
    ])
  })

  it('reports a start for the same subscription coming back after it expired', () => {
    // Scenario: the expired record itself gives access again and its renewal intent is as before.
    expect(changesOf(snapshotOf([EXPIRED]), snapshotOf([record()]))).toStrictEqual([
      'started sub-1'
    ])
  })

  it('reports a start for a new purchase beside an expired subscription', () => {
    // Scenario: access returns through a non-renewing purchase.
    expect(changesOf(snapshotOf([EXPIRED]), snapshotOf([EXPIRED], [PURCHASE]))).toStrictEqual([
      'started buy-1'
    ])
  })

  it('reports a start for a second subscription that grants an entitlement nothing granted', () => {
    // Scenario: the account keeps `premium` and gains `extra` through another subscription.
    const addOn = snapshotOf([record(), SECOND], [], { 'sub-2': ['extra'] })
    expect(changesOf(snapshotOf([record()]), addOn)).toStrictEqual(['started sub-2'])
  })

  it('reports one start for a record that grants two entitlements', () => {
    // Scenario: the new subscription grants both.
    const back = snapshotOf([EXPIRED, SECOND], [], { 'sub-2': ['premium', 'extra'] })
    expect(changesOf(snapshotOf([EXPIRED]), back)).toStrictEqual(['started sub-2'])
  })

  it('reports each start once when the account held purchases and no subscription', () => {
    // Scenario: two rules see the new subscription.
    const expired = { ...PURCHASE, givesAccess: false }
    expect(changesOf(snapshotOf([], [expired]), snapshotOf([SECOND], [expired]))).toStrictEqual([
      'started sub-2'
    ])
  })

  it.each([
    ['recovered', record({ status: 'on_hold', givesAccess: false })],
    ['resumed', record({ status: 'paused', givesAccess: false })],
    ['trial_converted', record({ status: 'trialing', givesAccess: false })]
  ])('leaves a return that %s announces to that change', (kind, before) => {
    // Scenario: the same record gets access back through a state that has its own change.
    expect(changesOf(snapshotOf([before]), snapshotOf([record()]))).toStrictEqual([`${kind} sub-1`])
  })

  it.each([
    ['a second subscription for the same entitlement', [record(), SECOND], {}],
    ['a held subscription that gains an entitlement', [record()], { 'sub-1': ['premium', 'x'] }]
  ])('reports no start for %s', (_name, subscriptions, grants) => {
    // Scenario: access did not begin, or the record that grants already gave access.
    const current = snapshotOf(subscriptions, [], grants)
    expect(changesOf(snapshotOf([record()]), current).join()).not.toContain('started')
  })

  it('reports no start when access moves between subscriptions within one read', () => {
    // Scenario: a known limit; the entitlement never had no grantor.
    const moved = snapshotOf([EXPIRED, SECOND])
    expect(changesOf(snapshotOf([record()]), moved)).toStrictEqual(['expired sub-1'])
  })

  it('reports nothing for a new record that gives no access', () => {
    // Scenario: a second record appears already expired.
    const other = record({ subscriptionReference: 'sub-2', status: 'expired', givesAccess: false })
    expect(changesOf(snapshotOf([EXPIRED]), snapshotOf([EXPIRED, other]))).toStrictEqual([])
  })

  it('gives each return its own key', () => {
    // Scenario: the same record returns twice, from states read at different instants.
    const keyAfter = (fetchedAt: string): string | undefined =>
      diffSnapshots(snapshotOf([EXPIRED], [], {}, fetchedAt), snapshotOf([record()]))[0]?.key
    expect(keyAfter('2026-01-02T00:00:00.000Z')).toMatch(/^[0-9a-f]{64}$/)
    expect(keyAfter('2026-01-02T00:00:00.000Z')).not.toBe(keyAfter('2026-01-03T00:00:00.000Z'))
  })
})
