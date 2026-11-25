/**
 * @fileoverview Pins the comparison of two snapshots: one table row per change kind of the
 * model, an empty list for equal snapshots and for a change of the fetch instant alone, the fixed
 * order of kinds when one comparison yields several, and that the arguments are left as they were.
 * @layer core
 */
import {
  CHANGE_KINDS,
  createEmptySnapshot,
  type ChangeKind,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { diffCandidates } from './diff-snapshots'

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
function snapshotOf(
  subscriptions: readonly SubscriptionRecord[],
  fetchedAt = '2026-01-01T00:00:00.000Z',
  customer = 'cust-1'
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt }),
    subscriptions,
    sourceCustomer: { id: customer }
  }
}

/** One row of the table: a pair of snapshots and the kinds the comparison must yield. */
interface Row {
  readonly kind: ChangeKind
  readonly previous: SubscriptionSnapshot | null
  readonly current: SubscriptionSnapshot
}

const ROWS: readonly Row[] = [
  { kind: 'started', previous: null, current: snapshotOf([record()]) },
  {
    kind: 'renewed',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ currentPeriodEnd: '2026-03-01T00:00:00.000Z' })])
  },
  {
    kind: 'trial_converted',
    previous: snapshotOf([record({ status: 'trialing' })]),
    current: snapshotOf([record()])
  },
  {
    kind: 'will_not_renew',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ willRenew: 'no' })])
  },
  {
    kind: 'will_renew_again',
    previous: snapshotOf([record({ willRenew: 'no' })]),
    current: snapshotOf([record()])
  },
  {
    kind: 'entered_grace',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ status: 'in_grace' })])
  },
  {
    kind: 'put_on_hold',
    previous: snapshotOf([record({ status: 'in_grace' })]),
    current: snapshotOf([record({ status: 'on_hold' })])
  },
  {
    kind: 'recovered',
    previous: snapshotOf([record({ status: 'on_hold' })]),
    current: snapshotOf([record()])
  },
  {
    kind: 'paused',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ status: 'paused' })])
  },
  {
    kind: 'resumed',
    previous: snapshotOf([record({ status: 'paused' })]),
    current: snapshotOf([record()])
  },
  {
    kind: 'product_changed',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ productReference: 'pro_yearly' })])
  },
  {
    kind: 'expired',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ status: 'expired', givesAccess: false })])
  },
  {
    kind: 'refunded',
    previous: snapshotOf([record()]),
    current: snapshotOf([record({ refundedAt: '2026-01-12T00:00:00.000Z' })])
  },
  {
    kind: 'transferred',
    previous: snapshotOf([record()]),
    current: snapshotOf([record()], '2026-01-01T00:00:00.000Z', 'cust-2')
  },
  {
    kind: 'overlap_detected',
    previous: snapshotOf([record()]),
    current: snapshotOf([record(), record({ subscriptionReference: 'sub-2' })])
  }
]

/** The kinds a comparison yields, in order. */
function kindsOf(previous: SubscriptionSnapshot | null, current: SubscriptionSnapshot): string[] {
  return diffCandidates(previous, current).map((change) => change.kind)
}

describe('diffCandidates', () => {
  it('has a table row for every change kind of the model', () => {
    // Scenario: a kind added to the model without a row here fails this test, so it cannot go
    // untested.
    expect(ROWS.map((row) => row.kind).sort()).toStrictEqual([...CHANGE_KINDS].sort())
  })

  it.each(ROWS)('yields $kind from its pair of snapshots', ({ kind, previous, current }) => {
    // Scenario: the pair of the row, built to trigger that kind and no other.
    expect(kindsOf(previous, current)).toStrictEqual([kind])
  })

  it('yields nothing for two equal snapshots', () => {
    // Scenario: nothing changed between two reads.
    expect(kindsOf(snapshotOf([record()]), snapshotOf([record()]))).toStrictEqual([])
  })

  it('yields nothing when only the fetch instant differs', () => {
    // Scenario: the same state read again later.
    const later = snapshotOf([record()], '2026-01-02T00:00:00.000Z')
    expect(kindsOf(snapshotOf([record()]), later)).toStrictEqual([])
  })

  it('yields nothing for a first contact with an account that has no subscription', () => {
    // Scenario: no previous snapshot and an empty one now.
    expect(kindsOf(null, snapshotOf([]))).toStrictEqual([])
  })

  it('yields both a refund and an expiry, in the fixed order of the model', () => {
    // Scenario: one comparison in which a refund also ends the subscription.
    const current = snapshotOf([
      record({ status: 'expired', givesAccess: false, refundedAt: '2026-01-12T00:00:00.000Z' })
    ])
    expect(kindsOf(snapshotOf([record()]), current)).toStrictEqual(['expired', 'refunded'])
  })

  it('yields a renewal together with a product change, in the fixed order of the model', () => {
    // Scenario: the subscription renews into another product.
    const current = snapshotOf([
      record({ currentPeriodEnd: '2026-03-01T00:00:00.000Z', productReference: 'pro_yearly' })
    ])
    expect(kindsOf(snapshotOf([record()]), current)).toStrictEqual(['renewed', 'product_changed'])
  })

  it('orders several subscriptions of one kind by their order in the current snapshot', () => {
    // Scenario: two subscriptions refunded in one comparison.
    const refunded = (reference: string): SubscriptionRecord =>
      record({ subscriptionReference: reference, refundedAt: '2026-01-12T00:00:00.000Z' })
    const previous = snapshotOf([
      record({ subscriptionReference: 'b' }),
      record({ subscriptionReference: 'a' })
    ])
    const changes = diffCandidates(previous, snapshotOf([refunded('b'), refunded('a')]))
    expect(changes.map((change) => change.subscriptionReference)).toStrictEqual(['b', 'a'])
  })

  it('pairs subscriptions by reference, not by position', () => {
    // Scenario: the list is reordered and only one subscription changed.
    const previous = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b' })
    ])
    const current = snapshotOf([
      record({ subscriptionReference: 'b', productReference: 'pro_yearly' }),
      record({ subscriptionReference: 'a' })
    ])
    const changes = diffCandidates(previous, current)
    expect(changes.map((change) => [change.kind, change.subscriptionReference])).toStrictEqual([
      ['product_changed', 'b']
    ])
  })

  it('leaves both snapshots as they were', () => {
    // Scenario: the comparison reads its arguments and writes to neither.
    const previous = snapshotOf([record()])
    const current = snapshotOf([
      record({ currentPeriodEnd: '2026-03-01T00:00:00.000Z' }),
      record({ subscriptionReference: 'sub-2' })
    ])
    const before = [structuredClone(previous), structuredClone(current)]
    diffCandidates(previous, current)
    expect([previous, current]).toStrictEqual(before)
  })
})
