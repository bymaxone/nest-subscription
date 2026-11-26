/**
 * @fileoverview Pins how non-renewing purchases count in the entitlement resolution (D31, FR05):
 * a purchase that gives access makes its entitlement active with its own end, a lifetime grant
 * has no end, several purchases and subscriptions that grant one entitlement give one entitlement
 * with the latest end, and every grantor is listed by its reference.
 * @layer shared
 */
import { resolveEntitlements } from './entitlements'
import { SubscriptionError } from './subscription.error'
import type {
  EntitlementState,
  NonRenewingPurchaseRecord,
  SubscriptionRecord
} from './snapshot.types'

const JAN = '2026-01-01T00:00:00.000Z'
const FEB = '2026-02-01T00:00:00.000Z'
const MAR = '2026-03-01T00:00:00.000Z'

function sub(reference: string, overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    subscriptionReference: reference,
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'web',
    environment: 'production',
    productReference: 'pro',
    billingInterval: 'month',
    currentPeriodStart: JAN,
    currentPeriodEnd: FEB,
    accessUntil: FEB,
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null,
    ...overrides
  }
}

function purchase(
  reference: string,
  names: readonly string[],
  overrides: Partial<NonRenewingPurchaseRecord> = {}
): NonRenewingPurchaseRecord {
  return {
    purchaseReference: reference,
    entitlementNames: names,
    givesAccess: true,
    origin: 'app_store',
    environment: 'production',
    productReference: 'lifetime',
    purchasedAt: JAN,
    accessUntil: null,
    refundedAt: null,
    ...overrides
  }
}

function state(
  name: string,
  active: boolean,
  until: string | null,
  decisive: string | null,
  grantors: readonly string[]
): EntitlementState {
  return {
    name,
    active,
    until,
    grantingSubscriptionReference: decisive,
    grantingSubscriptionReferences: grantors
  }
}

interface Row {
  readonly rule: string
  readonly subscriptions: readonly SubscriptionRecord[]
  readonly grants: ReadonlyMap<string, readonly string[]>
  readonly purchases: readonly NonRenewingPurchaseRecord[]
  readonly entitlements: readonly EntitlementState[]
  readonly overlapping: readonly string[]
}

const NONE = new Map<string, readonly string[]>()

const ROWS: readonly Row[] = [
  {
    rule: 'zero subscriptions and zero purchases resolve to nothing',
    subscriptions: [],
    grants: NONE,
    purchases: [],
    entitlements: [],
    overlapping: []
  },
  {
    rule: 'a lifetime purchase that gives access is active with no end',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['pro'])],
    entitlements: [state('pro', true, null, 'p1', ['p1'])],
    overlapping: []
  },
  {
    rule: 'a purchase with an end is active until that end',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['pro'], { accessUntil: FEB })],
    entitlements: [state('pro', true, FEB, 'p1', ['p1'])],
    overlapping: []
  },
  {
    rule: 'a purchase that gives no access leaves its entitlement inactive and reports its end',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['pro'], { givesAccess: false, accessUntil: FEB })],
    entitlements: [state('pro', false, FEB, null, [])],
    overlapping: []
  },
  {
    rule: 'a refunded lifetime purchase gives no access and has no end to report',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['pro'], { givesAccess: false, refundedAt: JAN })],
    entitlements: [state('pro', false, null, null, [])],
    overlapping: []
  },
  {
    rule: 'a purchase that grants two entitlements gives both, each naming it',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['extra', 'pro'])],
    entitlements: [
      state('extra', true, null, 'p1', ['p1']),
      state('pro', true, null, 'p1', ['p1'])
    ],
    overlapping: []
  },
  {
    rule: 'a purchase that grants no entitlement gives none',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', [])],
    entitlements: [],
    overlapping: []
  },
  {
    rule: 'two purchases of one entitlement give one entitlement with the latest end',
    subscriptions: [],
    grants: NONE,
    purchases: [
      purchase('p1', ['pro'], { accessUntil: FEB }),
      purchase('p2', ['pro'], { accessUntil: MAR })
    ],
    entitlements: [state('pro', true, MAR, 'p2', ['p1', 'p2'])],
    overlapping: ['pro']
  },
  {
    rule: 'a lifetime purchase among dated ones makes the entitlement last for ever',
    subscriptions: [],
    grants: NONE,
    purchases: [purchase('p1', ['pro'], { accessUntil: MAR }), purchase('p2', ['pro'])],
    entitlements: [state('pro', true, null, 'p2', ['p1', 'p2'])],
    overlapping: ['pro']
  },
  {
    rule: 'a subscription and a purchase of one entitlement give one entitlement with the latest end',
    subscriptions: [sub('s1', { accessUntil: MAR })],
    grants: new Map([['s1', ['pro']]]),
    purchases: [purchase('p1', ['pro'], { accessUntil: FEB })],
    entitlements: [state('pro', true, MAR, 's1', ['p1', 's1'])],
    overlapping: ['pro']
  },
  {
    rule: 'a subscription and a lifetime purchase of one entitlement last for ever and name both',
    subscriptions: [sub('s1', { accessUntil: MAR })],
    grants: new Map([['s1', ['pro']]]),
    purchases: [purchase('p1', ['pro'])],
    entitlements: [state('pro', true, null, 'p1', ['p1', 's1'])],
    overlapping: ['pro']
  },
  {
    rule: 'a refunded purchase beside an active subscription leaves the subscription the only grantor',
    subscriptions: [sub('s1')],
    grants: new Map([['s1', ['pro']]]),
    purchases: [purchase('p1', ['pro'], { givesAccess: false, refundedAt: JAN })],
    entitlements: [state('pro', true, FEB, 's1', ['s1'])],
    overlapping: []
  },
  {
    rule: 'a purchase and a subscription of different entitlements never overlap',
    subscriptions: [sub('s1')],
    grants: new Map([['s1', ['pro']]]),
    purchases: [purchase('p1', ['extra'])],
    entitlements: [state('pro', true, FEB, 's1', ['s1']), state('extra', true, null, 'p1', ['p1'])],
    overlapping: []
  },
  {
    rule: 'a subscription that gives no access beside a purchase that does leaves the purchase the grantor',
    subscriptions: [sub('s1', { givesAccess: false, status: 'expired' })],
    grants: new Map([['s1', ['pro']]]),
    purchases: [purchase('p1', ['pro'])],
    entitlements: [state('pro', true, null, 'p1', ['p1'])],
    overlapping: []
  }
]

describe('resolveEntitlements with non-renewing purchases', () => {
  it.each(ROWS)('$rule', ({ subscriptions, grants, purchases, entitlements, overlapping }) => {
    // Scenario: one row per rule; the whole resolution is compared.
    expect(resolveEntitlements(subscriptions, grants, purchases)).toStrictEqual({
      entitlements,
      overlapping
    })
  })

  it('resolves the same as before when no purchases are given', () => {
    // Scenario: the third argument is optional, and an empty list is the same as none.
    const subscriptions = [sub('s1')]
    const grants = new Map([['s1', ['pro']]])
    expect(resolveEntitlements(subscriptions, grants)).toStrictEqual(
      resolveEntitlements(subscriptions, grants, [])
    )
  })

  it('refuses a malformed instant on a purchase, as it does on a subscription', () => {
    // Scenario: the up-front check covers the purchases too.
    expect(() =>
      resolveEntitlements([], NONE, [purchase('p1', ['pro'], { accessUntil: 'soon' })])
    ).toThrow(SubscriptionError)
  })

  it('changes none of its arguments', () => {
    // Scenario: the rule is pure; frozen inputs would throw on a write.
    const purchases = Object.freeze([purchase('p1', Object.freeze(['pro']))])
    const subscriptions = Object.freeze([sub('s1')])
    const grants = new Map([['s1', Object.freeze(['pro'])]])
    expect(() => resolveEntitlements(subscriptions, grants, purchases)).not.toThrow()
    expect([...grants.keys()]).toStrictEqual(['s1'])
  })
})
