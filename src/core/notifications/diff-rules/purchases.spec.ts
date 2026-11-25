/**
 * @fileoverview Pins the rules for non-renewing purchases: a first purchase is a start, a purchase
 * that stops giving access has expired, a refund instant appearing is a refund, a purchase that
 * leaves is a transfer, and `diffSnapshots` reports them through the existing change kinds with
 * stable keys.
 * @layer core
 */
import {
  createEmptySnapshot,
  type NonRenewingPurchaseRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { diffSnapshots } from '../diff-snapshots'
import { purchaseChanges, purchaseStartedChanges, purchasesOf } from './purchases'
import { transferChanges } from './refund-transfer'

const PURCHASED = '2026-01-01T00:00:00.000Z'
const REFUNDED = '2026-01-12T00:00:00.000Z'

function purchase(overrides: Partial<NonRenewingPurchaseRecord> = {}): NonRenewingPurchaseRecord {
  return {
    purchaseReference: 'p1',
    entitlementNames: ['pro'],
    givesAccess: true,
    origin: 'app_store',
    environment: 'production',
    productReference: 'lifetime',
    purchasedAt: PURCHASED,
    accessUntil: null,
    refundedAt: null,
    ...overrides
  }
}

function snapshotOf(
  purchases: readonly NonRenewingPurchaseRecord[] | undefined,
  extra: Partial<SubscriptionSnapshot> = {}
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: PURCHASED }),
    ...(purchases === undefined ? {} : { nonRenewingPurchases: purchases }),
    sourceCustomer: { id: 'cust-1' },
    ...extra
  }
}

describe('purchasesOf', () => {
  it('gives the purchases a snapshot holds, and none for a snapshot with no list or none at all', () => {
    // Scenario: absent and null both read as none.
    const held = [purchase()]
    expect(purchasesOf(snapshotOf(held))).toBe(held)
    expect(purchasesOf(snapshotOf(undefined))).toStrictEqual([])
    expect(purchasesOf(null)).toStrictEqual([])
  })
})

describe('purchaseStartedChanges', () => {
  it('reports one start for each purchase on first contact, told apart by when it was purchased', () => {
    // Scenario: an account met for the first time holds two purchases.
    expect(
      purchaseStartedChanges(
        null,
        snapshotOf([purchase(), purchase({ purchaseReference: 'p2', purchasedAt: REFUNDED })])
      )
    ).toStrictEqual([
      { kind: 'started', subscriptionReference: 'p1', facts: [PURCHASED] },
      { kind: 'started', subscriptionReference: 'p2', facts: [REFUNDED] }
    ])
  })

  it('reports a start for the first purchase of an account that held nothing', () => {
    // Scenario: the previous snapshot is empty, not absent.
    expect(purchaseStartedChanges(snapshotOf([]), snapshotOf([purchase()]))).toHaveLength(1)
    expect(purchaseStartedChanges(snapshotOf(undefined), snapshotOf([purchase()]))).toHaveLength(1)
  })

  it('reports no start for a purchase beside an earlier purchase or an earlier subscription', () => {
    // Scenario: a second purchase is not a start, and neither is one after a subscription.
    const two = snapshotOf([purchase(), purchase({ purchaseReference: 'p2' })])
    expect(purchaseStartedChanges(snapshotOf([purchase()]), two)).toStrictEqual([])
    const subscribed = snapshotOf([], {
      subscriptions: [
        {
          subscriptionReference: 's1',
          status: 'active',
          givesAccess: true,
          willRenew: 'yes',
          origin: 'web',
          environment: 'production',
          productReference: 'p',
          billingInterval: '',
          currentPeriodStart: PURCHASED,
          currentPeriodEnd: PURCHASED,
          accessUntil: null,
          billingIssueSince: null,
          cancelledAt: null,
          refundedAt: null,
          managementReference: null
        }
      ]
    })
    expect(purchaseStartedChanges(subscribed, snapshotOf([purchase()]))).toStrictEqual([])
  })

  it('reports nothing for an account with no purchase', () => {
    // Scenario: nothing to start.
    expect(purchaseStartedChanges(null, snapshotOf(undefined))).toStrictEqual([])
  })
})

describe('purchaseChanges', () => {
  it('reports a refund told apart by the refund instant, and the expiry that comes with it', () => {
    // Scenario: the purchase stops giving access and gains a refund instant on the same read.
    const before = snapshotOf([purchase()])
    const after = snapshotOf([purchase({ givesAccess: false, refundedAt: REFUNDED })])
    expect(purchaseChanges(before, after)).toStrictEqual([
      { kind: 'refunded', subscriptionReference: 'p1', facts: [REFUNDED] },
      { kind: 'expired', subscriptionReference: 'p1', facts: ['', PURCHASED] }
    ])
  })

  it('reports an expiry alone, told apart by the end it reports', () => {
    // Scenario: a purchase with an end stops giving access, with no refund.
    const before = snapshotOf([purchase({ accessUntil: REFUNDED })])
    const after = snapshotOf([purchase({ givesAccess: false, accessUntil: REFUNDED })])
    expect(purchaseChanges(before, after)).toStrictEqual([
      { kind: 'expired', subscriptionReference: 'p1', facts: [REFUNDED, PURCHASED] }
    ])
  })

  it.each([
    ['no change', purchase(), purchase()],
    [
      'a refund already recorded',
      purchase({ givesAccess: false, refundedAt: REFUNDED }),
      purchase({ givesAccess: false, refundedAt: REFUNDED })
    ],
    [
      'access that was already gone',
      purchase({ givesAccess: false }),
      purchase({ givesAccess: false })
    ],
    ['access gained', purchase({ givesAccess: false }), purchase({ givesAccess: true })]
  ])('reports nothing for %s', (_label, was, is) => {
    // Scenario: only a refund appearing or access going away is a change.
    expect(purchaseChanges(snapshotOf([was]), snapshotOf([is]))).toStrictEqual([])
  })

  it('reports nothing for a purchase the previous snapshot did not hold, or on first contact', () => {
    // Scenario: a new purchase is the start rule's business, not this one's.
    expect(purchaseChanges(null, snapshotOf([purchase({ givesAccess: false })]))).toStrictEqual([])
    expect(
      purchaseChanges(snapshotOf([]), snapshotOf([purchase({ refundedAt: REFUNDED })]))
    ).toStrictEqual([])
    expect(purchaseChanges(snapshotOf(undefined), snapshotOf(undefined))).toStrictEqual([])
  })
})

describe('transferChanges with purchases', () => {
  it('reports a transfer when a purchase the previous snapshot held is gone, with its reference', () => {
    // Scenario: the purchase moved to another customer of the source.
    expect(transferChanges(snapshotOf([purchase()]), snapshotOf([]))).toStrictEqual([
      { kind: 'transferred', subscriptionReference: null, facts: ['cust-1', 'p1'] }
    ])
  })

  it('reports no transfer when a purchase is added or kept', () => {
    // Scenario: only a loss is a transfer.
    expect(transferChanges(snapshotOf([]), snapshotOf([purchase()]))).toStrictEqual([])
    expect(transferChanges(snapshotOf([purchase()]), snapshotOf([purchase()]))).toStrictEqual([])
  })
})

describe('diffSnapshots of a purchase', () => {
  it('reports the grant of a first purchase and its refund through the existing kinds', () => {
    // Scenario: D31: a lifetime grant is a start, and its refund is a refund and an expiry.
    const granted = diffSnapshots(null, snapshotOf([purchase()]))
    expect(granted.map((change) => change.kind)).toStrictEqual(['started'])
    const removed = diffSnapshots(
      snapshotOf([purchase()]),
      snapshotOf([purchase({ givesAccess: false, refundedAt: REFUNDED })])
    )
    expect(removed.map((change) => change.kind)).toStrictEqual(['expired', 'refunded'])
  })

  it('gives the same key to the same change however often it is computed', () => {
    // Scenario: keys are stable, and a purchase's key differs from another purchase's.
    const first = diffSnapshots(null, snapshotOf([purchase()]))
    expect(diffSnapshots(null, snapshotOf([purchase()]))).toStrictEqual(first)
    expect(
      diffSnapshots(null, snapshotOf([purchase({ purchaseReference: 'p2' })]))[0]?.key
    ).not.toBe(first[0]?.key)
  })

  it('reports an overlap when a purchase and a subscription grant one entitlement', () => {
    // Scenario: the grantors the snapshot records decide; a purchase counts as a grantor.
    const entitlement = (
      grantors: readonly string[]
    ): SubscriptionSnapshot['entitlements'][number] => ({
      name: 'pro',
      active: true,
      until: null,
      grantingSubscriptionReference: grantors[0] ?? null,
      grantingSubscriptionReferences: grantors
    })
    const before = snapshotOf([purchase()], { entitlements: [entitlement(['p1'])] })
    const after = snapshotOf([purchase()], { entitlements: [entitlement(['p1', 's1'])] })
    expect(diffSnapshots(before, after).map((change) => change.kind)).toStrictEqual([
      'overlap_detected'
    ])
  })
})
