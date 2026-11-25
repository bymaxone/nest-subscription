/**
 * @fileoverview The public `diffSnapshots` as a host sees it: each change kind from a pair of
 * snapshots, the empty list for snapshots that differ in the fetch instant alone, several kinds
 * from one comparison in a fixed order, and the keys: equal for the same change whenever it is
 * computed, different for another. It reads two snapshots and nothing else.
 * @layer e2e
 */
import { diffSnapshots } from '@bymax-one/nest-subscription'
import {
  createEmptySnapshot,
  resolveEntitlements,
  type ChangeKind,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

const T0 = '2026-01-01T00:00:00.000Z'
const LATER = '2026-03-01T00:00:00.000Z'
const ISSUE = '2026-01-20T00:00:00.000Z'
const CANCELLED = '2026-01-10T00:00:00.000Z'

const BASE: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: T0,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A snapshot of one account holding the given subscriptions. */
function snapshotOf(
  subscriptions: readonly Partial<SubscriptionRecord>[],
  customer: string | null = 'cust-1',
  fetchedAt = T0
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt }),
    subscriptions: subscriptions.map((overrides) => ({ ...BASE, ...overrides })),
    sourceCustomer: customer === null ? null : { id: customer }
  }
}

/** Two subscriptions that both give access and both grant `pro`. */
function both(): SubscriptionSnapshot {
  const base = snapshotOf([{}, { subscriptionReference: 'sub-2' }])
  const grants = new Map([
    ['sub-1', ['pro']],
    ['sub-2', ['pro']]
  ])
  return { ...base, entitlements: resolveEntitlements(base.subscriptions, grants).entitlements }
}

/** One subscription with the given fields changed. */
function one(overrides: Partial<SubscriptionRecord> = {}): SubscriptionSnapshot {
  return snapshotOf([overrides])
}

/** The kinds `diffSnapshots` yields for a pair, in order. */
function kinds(previous: SubscriptionSnapshot | null, current: SubscriptionSnapshot): ChangeKind[] {
  return diffSnapshots(previous, current).map((change) => change.kind)
}

/** One comparison and the kinds it must yield. */
const CASES: ReadonlyArray<
  readonly [string, SubscriptionSnapshot | null, SubscriptionSnapshot, ChangeKind[]]
> = [
  ['a first contact with a subscription', null, one(), ['started']],
  ['a first contact with no subscription', null, snapshotOf([]), []],
  [
    'a first contact with two subscriptions giving access',
    null,
    both(),
    ['started', 'started', 'overlap_detected']
  ],
  ['a known account that buys', snapshotOf([]), one(), ['started']],
  ['a period moving forward', one(), one({ currentPeriodEnd: LATER }), ['renewed']],
  ['a period that is the same', one(), one(), []],
  ['a period moving back', one(), one({ currentPeriodEnd: '2025-12-01T00:00:00.000Z' }), []],
  ['a trial that converts', one({ status: 'trialing' }), one(), ['trial_converted']],
  [
    'an expiry with an access end',
    one(),
    one({ status: 'expired', givesAccess: false }),
    ['expired']
  ],
  [
    'an expiry of a lifetime grant',
    one({ accessUntil: null }),
    one({ accessUntil: null, status: 'expired', givesAccess: false }),
    ['expired']
  ],
  ['a subscription already expired', one({ status: 'expired' }), one({ status: 'expired' }), []],
  [
    'a cancellation with its instant',
    one(),
    one({ willRenew: 'no', cancelledAt: CANCELLED }),
    ['will_not_renew']
  ],
  ['a cancellation without an instant', one(), one({ willRenew: 'no' }), ['will_not_renew']],
  [
    'a cancellation undone',
    one({ willRenew: 'no', cancelledAt: CANCELLED }),
    one(),
    ['will_renew_again']
  ],
  ['an undone cancellation with no instant', one({ willRenew: 'no' }), one(), ['will_renew_again']],
  ['an intent that stays no', one({ willRenew: 'no' }), one({ willRenew: 'no' }), []],
  [
    'a move into grace with its issue',
    one(),
    one({ status: 'in_grace', billingIssueSince: ISSUE }),
    ['entered_grace']
  ],
  ['a move into grace without one', one(), one({ status: 'in_grace' }), ['entered_grace']],
  [
    'a move on hold with its issue',
    one({ status: 'in_grace' }),
    one({ status: 'on_hold', billingIssueSince: ISSUE }),
    ['put_on_hold']
  ],
  ['a move on hold without one', one(), one({ status: 'on_hold' }), ['put_on_hold']],
  [
    'a recovery with its issue',
    one({ status: 'on_hold', billingIssueSince: ISSUE }),
    one(),
    ['recovered']
  ],
  ['a recovery without one', one({ status: 'in_grace' }), one(), ['recovered']],
  ['a pause', one(), one({ status: 'paused' }), ['paused']],
  ['a resume to active', one({ status: 'paused' }), one(), ['resumed']],
  ['a resume to a trial', one({ status: 'paused' }), one({ status: 'trialing' }), ['resumed']],
  [
    'a paused subscription that expires',
    one({ status: 'paused' }),
    one({ status: 'expired' }),
    ['expired']
  ],
  ['a product change', one(), one({ productReference: 'pro_yearly' }), ['product_changed']],
  ['a refund', one(), one({ refundedAt: CANCELLED }), ['refunded']],
  ['a refund already recorded', one({ refundedAt: CANCELLED }), one({ refundedAt: CANCELLED }), []],
  ['a transfer to another customer', one(), snapshotOf([{}], 'cust-2'), ['transferred']],
  ['a customer that disappears', one(), snapshotOf([{}], null), ['transferred']],
  ['a customer first linked', snapshotOf([{}], null), one(), []],
  ['a subscription that moves away', one(), snapshotOf([]), ['transferred']],
  ['a second subscription granting the same entitlement', one(), both(), ['overlap_detected']],
  ['two subscriptions that already overlapped', both(), both(), []],
  [
    'a renewal with a product change',
    one(),
    one({ currentPeriodEnd: LATER, productReference: 'pro_yearly' }),
    ['renewed', 'product_changed']
  ],
  [
    'a refund that also expires',
    one(),
    one({ status: 'expired', givesAccess: false, refundedAt: CANCELLED }),
    ['expired', 'refunded']
  ]
]

describe('diffSnapshots end to end', () => {
  it.each(CASES)('yields the kinds of %s', (_name, previous, current, expected) => {
    // Scenario: the pair of the row.
    expect(kinds(previous, current)).toStrictEqual(expected)
  })

  it('yields nothing when only the fetch instant differs', () => {
    // Scenario: the same state read again later.
    expect(
      diffSnapshots(one(), snapshotOf([{}], 'cust-1', '2026-06-01T00:00:00.000Z'))
    ).toStrictEqual([])
  })

  it('gives the same change the same key when computed again', () => {
    // Scenario: one comparison computed twice.
    const current = one({ currentPeriodEnd: LATER })
    expect(diffSnapshots(one(), current)).toStrictEqual(diffSnapshots(one(), current))
  })

  it('gives two consecutive renewals different keys', () => {
    // Scenario: the period moves forward twice.
    const first = diffSnapshots(one(), one({ currentPeriodEnd: LATER }))
    const second = diffSnapshots(
      one({ currentPeriodEnd: LATER }),
      one({ currentPeriodEnd: '2026-04-01T00:00:00.000Z' })
    )
    expect(first[0]?.key).not.toBe(second[0]?.key)
  })

  it('gives the same change on two tenants different keys', () => {
    // Scenario: one account identifier in two tenants.
    const place = (tenantId: string): string | undefined =>
      diffSnapshots(null, { ...one(), tenantId })[0]?.key
    expect(place('t1')).not.toBe(place('t2'))
  })
})
