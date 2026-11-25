/**
 * @fileoverview Pins the comparison of two snapshots: one table row per change kind of the
 * model, an empty list for equal snapshots and for a change of the fetch instant alone, the fixed
 * order of kinds when one comparison yields several, that the arguments are left as they were, and
 * the key of each change: stable for the same change and different for any other.
 * @layer core
 */
import {
  CHANGE_KINDS,
  createEmptySnapshot,
  resolveEntitlements,
  type ChangeKind,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { diffCandidates, diffSnapshots } from './diff-snapshots'

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
    current: grantingSnapshot([{}, { subscriptionReference: 'sub-2' }], {
      'sub-1': ['pro'],
      'sub-2': ['pro']
    })
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

  it('puts a kind that comes earlier in the model first even when its rule runs later', () => {
    // Scenario: one subscription expires and stops renewing; the model lists will_not_renew before
    // expired, though the lifecycle rule runs before the renewal rule.
    const current = snapshotOf([record({ status: 'expired', givesAccess: false, willRenew: 'no' })])
    expect(kindsOf(snapshotOf([record()]), current)).toStrictEqual(['will_not_renew', 'expired'])
  })

  it('puts the kinds of two subscriptions in the order of the model, not of the subscriptions', () => {
    // Scenario: the first subscription expires and the second stops renewing.
    const previous = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b' })
    ])
    const current = snapshotOf([
      record({ subscriptionReference: 'a', status: 'expired', givesAccess: false }),
      record({ subscriptionReference: 'b', willRenew: 'no' })
    ])
    expect(kindsOf(previous, current)).toStrictEqual(['will_not_renew', 'expired'])
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

/** One snapshot with a single subscription changed from the base record. */
function one(
  overrides: Partial<SubscriptionRecord> = {},
  customer = 'cust-1'
): SubscriptionSnapshot {
  return snapshotOf([record(overrides)], '2026-01-01T00:00:00.000Z', customer)
}

/**
 * For each kind, a second pair that yields the same kind with another discriminating fact, which
 * must therefore get another key. The key of a change depends on exactly these facts:
 * the period start of a start, a conversion, a resumption and a product change (a period is one
 * occurrence); the period end of a renewal and a pause; the cancellation instant of a cancellation
 * and of its undoing; the billing-issue instant of grace, hold and recovery; the access end of an
 * expiry; the refund instant; the new customer of a transfer; the overlapping references.
 */
const VARIANTS: Record<ChangeKind, readonly [SubscriptionSnapshot | null, SubscriptionSnapshot]> = {
  started: [null, one({ currentPeriodStart: '2026-01-09T00:00:00.000Z' })],
  renewed: [one(), one({ currentPeriodEnd: '2026-04-01T00:00:00.000Z' })],
  trial_converted: [
    one({ status: 'trialing' }),
    one({ currentPeriodStart: '2026-01-09T00:00:00.000Z' })
  ],
  will_not_renew: [one(), one({ willRenew: 'no', cancelledAt: '2026-01-10T00:00:00.000Z' })],
  will_renew_again: [one({ willRenew: 'no', cancelledAt: '2026-01-10T00:00:00.000Z' }), one()],
  entered_grace: [
    one(),
    one({ status: 'in_grace', billingIssueSince: '2026-01-20T00:00:00.000Z' })
  ],
  put_on_hold: [
    one({ status: 'in_grace' }),
    one({ status: 'on_hold', billingIssueSince: '2026-01-20T00:00:00.000Z' })
  ],
  recovered: [one({ status: 'on_hold', billingIssueSince: '2026-01-20T00:00:00.000Z' }), one()],
  paused: [one(), one({ status: 'paused', currentPeriodEnd: '2026-04-01T00:00:00.000Z' })],
  resumed: [one({ status: 'paused' }), one({ currentPeriodStart: '2026-01-09T00:00:00.000Z' })],
  product_changed: [one(), one({ productReference: 'pro_lifetime' })],
  expired: [
    one(),
    one({ status: 'expired', givesAccess: false, accessUntil: '2026-01-15T00:00:00.000Z' })
  ],
  refunded: [one(), one({ refundedAt: '2026-01-13T00:00:00.000Z' })],
  transferred: [one(), one({}, 'cust-3')],
  overlap_detected: [
    one(),
    grantingSnapshot([{}, { subscriptionReference: 'sub-3' }], {
      'sub-1': ['pro'],
      'sub-3': ['pro']
    })
  ]
}

/** Every pair of the kind table, as a row of the order test. */
const PAIRS = ROWS.map((row) => [`a ${row.kind} pair`, row.previous, row.current] as const)

/** Pairs in which several subscriptions change at once, so that their order could matter. */
const MANY = [
  [
    'two subscriptions that both renew',
    snapshotOf([record({ subscriptionReference: 'a' }), record({ subscriptionReference: 'b' })]),
    snapshotOf([
      record({ subscriptionReference: 'a', currentPeriodEnd: '2026-03-01T00:00:00.000Z' }),
      record({ subscriptionReference: 'b', currentPeriodEnd: '2026-03-01T00:00:00.000Z' })
    ])
  ],
  [
    'two subscriptions that both change product',
    snapshotOf([record({ subscriptionReference: 'a' }), record({ subscriptionReference: 'b' })]),
    snapshotOf([
      record({ subscriptionReference: 'a', productReference: 'p1' }),
      record({ subscriptionReference: 'b', productReference: 'p2' })
    ])
  ],
  [
    'two subscriptions that both start',
    null,
    snapshotOf([record({ subscriptionReference: 'a' }), record({ subscriptionReference: 'b' })])
  ],
  [
    'two subscriptions that both move away',
    snapshotOf([record({ subscriptionReference: 'b' }), record({ subscriptionReference: 'a' })]),
    snapshotOf([])
  ],
  [
    'two subscriptions that grant one entitlement',
    snapshotOf([record({ subscriptionReference: 'a' })]),
    grantingSnapshot([{ subscriptionReference: 'b' }, { subscriptionReference: 'a' }], {
      a: ['pro'],
      b: ['pro']
    })
  ]
] as const

/** The pairs, from the kind table and below, in which a snapshot holds more than one subscription. */
const SEVERAL: ReadonlyArray<readonly [string, SubscriptionSnapshot | null, SubscriptionSnapshot]> =
  [...PAIRS, ...MANY].filter(
    ([, previous, current]) =>
      (previous?.subscriptions.length ?? 0) > 1 || current.subscriptions.length > 1
  )

describe('diffSnapshots', () => {
  it('gives a change a key of 64 lowercase hexadecimal characters', () => {
    // Scenario: an account and a tenant with recognizable names still give a fixed-width hex key.
    const current = {
      ...snapshotOf([record()]),
      accountId: 'sentinel-account',
      tenantId: 'sentinel-tenant'
    }
    const keys = diffSnapshots(null, current).map((change) => change.key)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns the kind of a change beside its key', () => {
    // Scenario: the typed list carries both fields of a change.
    const changes = diffSnapshots(null, snapshotOf([record()]))
    expect(changes).toStrictEqual([
      { kind: 'started', key: expect.stringMatching(/^[0-9a-f]{64}$/) }
    ])
  })

  it.each(ROWS)('gives the same $kind change the same key when read at another instant', (row) => {
    // Scenario: the same change computed from snapshots fetched at different instants.
    const later = { ...row.current, fetchedAt: '2026-06-01T00:00:00.000Z' }
    const earlierPrevious =
      row.previous === null ? null : { ...row.previous, fetchedAt: '2025-12-01T00:00:00.000Z' }
    expect(diffSnapshots(earlierPrevious, later)).toStrictEqual(
      diffSnapshots(row.previous, row.current)
    )
  })

  it.each(ROWS)('gives a $kind change with another discriminating fact another key', (row) => {
    // Scenario: the variant pair yields the same kind, so only the discriminating fact differs.
    const [previous, current] = VARIANTS[row.kind]
    const base = diffSnapshots(row.previous, row.current)
    const variant = diffSnapshots(previous, current)
    expect(variant.map((change) => change.kind)).toStrictEqual([row.kind])
    expect(variant[0]?.key).not.toBe(base[0]?.key)
  })

  it('gives two consecutive renewals of one subscription different keys', () => {
    // Scenario: the period moves forward twice; each renewal is its own change.
    const first = diffSnapshots(one(), one({ currentPeriodEnd: '2026-03-01T00:00:00.000Z' }))
    const second = diffSnapshots(
      one({ currentPeriodEnd: '2026-03-01T00:00:00.000Z' }),
      one({ currentPeriodEnd: '2026-04-01T00:00:00.000Z' })
    )
    expect(first[0]?.key).not.toBe(second[0]?.key)
  })

  it('gives the same kind of change on two subscriptions different keys', () => {
    // Scenario: two subscriptions of one account renew in the same comparison.
    const renewed = (reference: string): SubscriptionRecord =>
      record({ subscriptionReference: reference, currentPeriodEnd: '2026-03-01T00:00:00.000Z' })
    const previous = snapshotOf([
      record({ subscriptionReference: 'a' }),
      record({ subscriptionReference: 'b' })
    ])
    const keys = diffSnapshots(previous, snapshotOf([renewed('a'), renewed('b')])).map(
      (change) => change.key
    )
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('gives the same change on two accounts, and on two tenants, different keys', () => {
    // Scenario: the same state change in four places: two accounts, and one account in two tenants.
    const place = (accountId: string, tenantId?: string): string[] => {
      const base = (snapshot: SubscriptionSnapshot): SubscriptionSnapshot => ({
        ...snapshot,
        accountId,
        ...(tenantId === undefined ? {} : { tenantId })
      })
      return diffSnapshots(base(one()), base(one({ productReference: 'pro_yearly' }))).map(
        (change) => change.key
      )
    }
    const keys = [place('a1'), place('a2'), place('a1', 't1'), place('a1', 't2')].flat()
    expect(new Set(keys).size).toBe(4)
  })

  it('does not let the account and the tenant trade content to make one key', () => {
    // Scenario: ('a:b', 'c') and ('a', 'b:c') are different accounts and must not collide.
    const keyOf = (accountId: string, tenantId: string): string | undefined => {
      const snapshot = { ...snapshotOf([record()]), accountId, tenantId }
      return diffSnapshots(null, snapshot)[0]?.key
    }
    expect(keyOf('a:b', 'c')).not.toBe(keyOf('a', 'b:c'))
  })

  it('gives two entitlements with the same grantors different overlap keys', () => {
    // Scenario: sub-1 and sub-2 grant both pro and addon; each entitlement overlaps on its own.
    const grants = { 'sub-1': ['pro', 'addon'], 'sub-2': ['pro', 'addon'] }
    const current = grantingSnapshot([{}, { subscriptionReference: 'sub-2' }], grants)
    const keys = diffSnapshots(null, current)
      .filter((change) => change.kind === 'overlap_detected')
      .map((change) => change.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it.each(SEVERAL)(
    'gives the same keys for %s when the previous, the current or both snapshots list their subscriptions in another order',
    (_name, previous, current) => {
      // Scenario: the source lists the same subscriptions in another order in one snapshot or in
      // both; the comparison must find the same changes under the same keys, and must find some.
      const reversed = (snapshot: SubscriptionSnapshot): SubscriptionSnapshot => ({
        ...snapshot,
        subscriptions: [...snapshot.subscriptions].reverse()
      })
      const keysOf = (before: SubscriptionSnapshot | null, after: SubscriptionSnapshot): string[] =>
        diffSnapshots(before, after)
          .map((change) => change.key)
          .sort()
      const forward = keysOf(previous, current)
      const before = previous === null ? null : reversed(previous)
      expect(forward.length).toBeGreaterThan(0)
      expect(keysOf(before, current)).toStrictEqual(forward)
      expect(keysOf(previous, reversed(current))).toStrictEqual(forward)
      expect(keysOf(before, reversed(current))).toStrictEqual(forward)
    }
  )

  it('gives a tenant-less account and an account of an empty tenant different keys', () => {
    // Scenario: encodeAccountKey tells them apart, and the change key keeps that difference.
    const without = diffSnapshots(null, snapshotOf([record()]))
    const empty = diffSnapshots(null, { ...snapshotOf([record()]), tenantId: '' })
    expect(without[0]?.key).not.toBe(empty[0]?.key)
  })

  it('refuses a snapshot with a blank account identifier', () => {
    // Scenario: the key cannot be built for an account with no identifier.
    const blank = { ...snapshotOf([record()]), accountId: ' ' }
    expect(() => diffSnapshots(null, blank)).toThrow(
      expect.objectContaining({ code: 'SUBSCRIPTION_INVALID_INPUT' })
    )
  })
})

/** A snapshot whose entitlements are resolved from the subscriptions and the grants given. */
function grantingSnapshot(
  subscriptions: readonly Partial<SubscriptionRecord>[],
  grants: Readonly<Record<string, readonly string[]>>
): SubscriptionSnapshot {
  const records = subscriptions.map((overrides) => record(overrides))
  const { entitlements } = resolveEntitlements(records, new Map(Object.entries(grants)))
  return { ...snapshotOf(records), entitlements }
}

const APP = { subscriptionReference: 'app' }
const WEB = { subscriptionReference: 'web' }
const THIRD = { subscriptionReference: 'third' }

describe('diffSnapshots overlap per entitlement', () => {
  it.each([
    [
      'an App Store subscription for pro beside a web one for addon, with one before',
      [APP],
      { app: ['pro'] },
      [APP, WEB],
      { app: ['pro'], web: ['addon'] },
      []
    ],
    [
      'two subscriptions that both grant pro, with one before',
      [APP],
      { app: ['pro'] },
      [APP, WEB],
      { app: ['pro'], web: ['pro'] },
      ['overlap_detected']
    ],
    [
      'two grantors of pro before and after',
      [APP, WEB],
      { app: ['pro'], web: ['pro'] },
      [APP, WEB],
      { app: ['pro'], web: ['pro'] },
      []
    ],
    [
      'a third grantor added to pro that already had two',
      [APP, WEB],
      { app: ['pro'], web: ['pro'] },
      [APP, WEB, THIRD],
      { app: ['pro'], web: ['pro'], third: ['pro'] },
      []
    ]
  ] as const)('reports %s', (_name, before, beforeGrants, after, afterGrants, expected) => {
    // Scenario: overlap is decided per entitlement from who grants it, not from how many
    // subscriptions give access.
    const previous = grantingSnapshot(before, beforeGrants)
    const current = grantingSnapshot(after, afterGrants)
    expect(kindsOf(previous, current).filter((kind) => kind === 'overlap_detected')).toStrictEqual(
      expected
    )
  })
})
