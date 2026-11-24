/**
 * @fileoverview Pins the entitlement resolution rule (several subscriptions, one entitlement) over
 * a table of cases named by the rule each protects.
 * @layer shared
 */
import { resolveEntitlements } from './entitlements'
import { SUBSCRIPTION_ERROR_MESSAGES } from './error-codes'
import { SubscriptionError } from './subscription.error'
import type { EntitlementState, SubscriptionRecord } from './snapshot.types'

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

function state(
  name: string,
  active: boolean,
  until: string | null,
  reference: string | null
): EntitlementState {
  return { name, active, until, grantingSubscriptionReference: reference }
}

interface Row {
  readonly rule: string
  readonly subscriptions: readonly SubscriptionRecord[]
  readonly grants: ReadonlyMap<string, readonly string[]>
  readonly entitlements: readonly EntitlementState[]
  readonly overlapping: readonly string[]
}

const rows: readonly Row[] = [
  {
    rule: 'one subscription that gives access makes its entitlement active until its end',
    subscriptions: [sub('s1')],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [state('pro', true, FEB, 's1')],
    overlapping: []
  },
  {
    rule: 'one subscription that gives no access leaves its entitlement inactive',
    subscriptions: [sub('s1', { givesAccess: false, status: 'expired' })],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [state('pro', false, FEB, null)],
    overlapping: []
  },
  {
    rule: 'an inactive grantor beside an active one does not count and is not an overlap',
    subscriptions: [sub('s1', { givesAccess: false, accessUntil: MAR }), sub('s2')],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, FEB, 's2')],
    overlapping: []
  },
  {
    rule: 'two active grantors report the latest end and the overlap',
    subscriptions: [sub('s1', { accessUntil: FEB }), sub('s2', { accessUntil: MAR })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, MAR, 's2')],
    overlapping: ['pro']
  },
  {
    rule: 'the latest end wins whatever the order of the subscriptions',
    subscriptions: [sub('s1', { accessUntil: MAR }), sub('s2', { accessUntil: FEB })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, MAR, 's1')],
    overlapping: ['pro']
  },
  {
    rule: 'equal ends keep the first subscription as the granting one',
    subscriptions: [sub('s1', { accessUntil: FEB }), sub('s2', { accessUntil: FEB })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, FEB, 's1')],
    overlapping: ['pro']
  },
  {
    rule: 'a lifetime grant outranks a dated one, in either order',
    subscriptions: [sub('s1', { accessUntil: MAR }), sub('s2', { accessUntil: null })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, null, 's2')],
    overlapping: ['pro']
  },
  {
    rule: 'a lifetime grant listed first still outranks a dated one',
    subscriptions: [sub('s1', { accessUntil: null }), sub('s2', { accessUntil: MAR })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, null, 's1')],
    overlapping: ['pro']
  },
  {
    rule: 'two lifetime grants keep the first one',
    subscriptions: [sub('s1', { accessUntil: null }), sub('s2', { accessUntil: null })],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, null, 's1')],
    overlapping: ['pro']
  },
  {
    rule: 'a status of unknown with the access flag set gives access, because the flag decides',
    subscriptions: [sub('s1', { status: 'unknown', givesAccess: true })],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [state('pro', true, FEB, 's1')],
    overlapping: []
  },
  {
    rule: 'a status of active with the access flag unset gives no access, because the flag decides',
    subscriptions: [sub('s1', { status: 'active', givesAccess: false })],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [state('pro', false, FEB, null)],
    overlapping: []
  },
  {
    rule: 'inactive grantors report the latest end among them',
    subscriptions: [
      sub('s1', { givesAccess: false, accessUntil: JAN }),
      sub('s2', { givesAccess: false, accessUntil: FEB })
    ],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', false, FEB, null)],
    overlapping: []
  },
  {
    rule: 'inactive grantors with no dated end report no end',
    subscriptions: [sub('s1', { givesAccess: false, accessUntil: null })],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [state('pro', false, null, null)],
    overlapping: []
  },
  {
    rule: 'an undated inactive grantor does not hide the dated end of another',
    subscriptions: [
      sub('s1', { givesAccess: false, accessUntil: null }),
      sub('s2', { givesAccess: false, accessUntil: JAN })
    ],
    grants: new Map([
      ['s1', ['pro']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', false, JAN, null)],
    overlapping: []
  },
  {
    rule: 'one subscription granting two entitlements yields both, in the order granted',
    subscriptions: [sub('s1')],
    grants: new Map([['s1', ['pro', 'beta']]]),
    entitlements: [state('pro', true, FEB, 's1'), state('beta', true, FEB, 's1')],
    overlapping: []
  },
  {
    rule: 'a name repeated within one subscription counts once and is no overlap',
    subscriptions: [sub('s1')],
    grants: new Map([['s1', ['pro', 'pro']]]),
    entitlements: [state('pro', true, FEB, 's1')],
    overlapping: []
  },
  {
    rule: 'overlap is reported per entitlement, not per account',
    subscriptions: [sub('s1'), sub('s2')],
    grants: new Map([
      ['s1', ['pro', 'beta']],
      ['s2', ['pro']]
    ]),
    entitlements: [state('pro', true, FEB, 's1'), state('beta', true, FEB, 's1')],
    overlapping: ['pro']
  },
  {
    rule: 'a subscription with no grant entry grants nothing',
    subscriptions: [sub('s1')],
    grants: new Map(),
    entitlements: [],
    overlapping: []
  },
  {
    rule: 'no subscriptions resolve to no entitlements',
    subscriptions: [],
    grants: new Map([['s1', ['pro']]]),
    entitlements: [],
    overlapping: []
  }
]

describe('resolveEntitlements', () => {
  it.each(rows)('$rule', ({ subscriptions, grants, entitlements, overlapping }) => {
    // Scenario: the rows above; each states the rule it protects and its expected resolution.
    expect(resolveEntitlements(subscriptions, grants)).toEqual({ entitlements, overlapping })
  })

  it('refuses a malformed instant on a subscription that gives access', () => {
    // Scenario: a caller passes a subscription whose end is not a date.
    expect(() =>
      resolveEntitlements([sub('s1', { accessUntil: 'not-a-date' })], new Map([['s1', ['pro']]]))
    ).toThrow(SubscriptionError)
  })

  it('refuses an instant that is not ISO 8601, though a lenient reader would accept it', () => {
    // Scenario: a day-first date reads as a date to `Date.parse`; the rule refuses it.
    expect(() =>
      resolveEntitlements([sub('s1', { accessUntil: '01/02/2026' })], new Map([['s1', ['pro']]]))
    ).toThrow(SubscriptionError)
  })

  it('refuses a malformed instant that the ranking would never compare', () => {
    // Scenario: a lifetime grant outranks the dated one without parsing it; the malformed date is
    // still a caller error.
    expect(() =>
      resolveEntitlements(
        [sub('s1', { accessUntil: null }), sub('s2', { accessUntil: 'not-a-date' })],
        new Map([
          ['s1', ['pro']],
          ['s2', ['pro']]
        ])
      )
    ).toThrow(SubscriptionError)
  })

  it('refuses a malformed instant on a subscription that grants nothing', () => {
    // Scenario: the subscription has no grant entry, yet its date is checked.
    expect(() =>
      resolveEntitlements([sub('s1', { accessUntil: 'not-a-date' })], new Map())
    ).toThrow(SubscriptionError)
  })

  it('raises an error with the catalogue code and a message that holds no value', () => {
    // Scenario: the failure is typed by code; the message is fixed, so it cannot leak the input.
    const failure = (() => {
      try {
        resolveEntitlements([sub('s1', { accessUntil: 'secret-looking-text' })], new Map())
      } catch (error) {
        return error
      }
      return undefined
    })()
    expect(failure).toBeInstanceOf(SubscriptionError)
    expect((failure as SubscriptionError).code).toBe('SUBSCRIPTION_INVALID_INPUT')
    expect((failure as SubscriptionError).message).toBe(
      SUBSCRIPTION_ERROR_MESSAGES.SUBSCRIPTION_INVALID_INPUT
    )
    expect((failure as SubscriptionError).message).not.toContain('secret-looking-text')
  })

  it('changes none of its arguments and returns the same result twice', () => {
    // Scenario: the rule is pure; frozen inputs would throw on a write, and the result repeats.
    const subscriptions = Object.freeze([sub('s1'), sub('s2', { accessUntil: MAR })])
    const grants = new Map([
      ['s1', Object.freeze(['pro'])],
      ['s2', Object.freeze(['pro'])]
    ])
    const first = resolveEntitlements(subscriptions, grants)
    expect(resolveEntitlements(subscriptions, grants)).toEqual(first)
    expect(grants.get('s1')).toEqual(['pro'])
    expect(subscriptions).toHaveLength(2)
  })
})
