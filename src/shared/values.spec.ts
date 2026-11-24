/**
 * @fileoverview Pins the members of the value sets of the model, that each set is frozen, and that
 * the model offers no function from a status to access.
 * @layer shared
 */
import * as entry from './index'
import type { SubscriptionRecord } from './snapshot.types'
import {
  CHANGE_KINDS,
  SUBSCRIPTION_ENVIRONMENTS,
  SUBSCRIPTION_ORIGINS,
  SUBSCRIPTION_STATUSES,
  WILL_RENEW_VALUES,
  type SubscriptionEnvironment,
  type SubscriptionStatus
} from './values'

describe('value sets', () => {
  const sets: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    [
      'SUBSCRIPTION_STATUSES',
      SUBSCRIPTION_STATUSES,
      ['trialing', 'active', 'in_grace', 'on_hold', 'paused', 'expired', 'unknown']
    ],
    ['WILL_RENEW_VALUES', WILL_RENEW_VALUES, ['yes', 'no', 'changes_product', 'pauses', 'unknown']],
    [
      'SUBSCRIPTION_ORIGINS',
      SUBSCRIPTION_ORIGINS,
      ['app_store', 'play_store', 'web', 'promotional', 'other']
    ],
    ['SUBSCRIPTION_ENVIRONMENTS', SUBSCRIPTION_ENVIRONMENTS, ['production', 'sandbox']],
    [
      'CHANGE_KINDS',
      CHANGE_KINDS,
      [
        'started',
        'renewed',
        'trial_converted',
        'will_not_renew',
        'will_renew_again',
        'entered_grace',
        'put_on_hold',
        'recovered',
        'paused',
        'resumed',
        'product_changed',
        'expired',
        'refunded',
        'transferred',
        'overlap_detected'
      ]
    ]
  ]

  it.each(sets)('%s lists exactly the specified members, in order', (_name, actual, expected) => {
    // Scenario: each set is compared with the members the specification fixes; an added, removed
    // or renamed member fails the case.
    expect([...actual]).toEqual([...expected])
  })

  it.each(sets)('%s is frozen', (_name, actual) => {
    // Scenario: a host holding the set cannot add or replace a member for every other caller.
    expect(Object.isFrozen(actual)).toBe(true)
  })

  it('types each member as the union', () => {
    // Scenario: the derived unions accept a member and are the type of reading one back; a
    // renamed member fails to compile here.
    const environment: SubscriptionEnvironment = SUBSCRIPTION_ENVIRONMENTS[1]
    const status: SubscriptionStatus = SUBSCRIPTION_STATUSES[0]
    expect(environment).toBe('sandbox')
    expect(status).toBe('trialing')
  })
})

describe('status and access', () => {
  it('exports no function that takes a status and returns access', () => {
    // Scenario: the only functions the entry point exports are the ones listed; none is named for
    // a status, and the behaviour below shows the resolution follows the flag for every status.
    const functions = Object.entries(entry)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()
    expect(functions).toEqual([
      'SubscriptionError',
      'createEmptySnapshot',
      'parseInstant',
      'resolveEntitlements'
    ])
  })

  it.each(
    SUBSCRIPTION_STATUSES.flatMap((status) => [[status, true] as const, [status, false] as const])
  )(
    'resolves status %s with the access flag %s to the flag, not to the name',
    (status, givesAccess) => {
      // Scenario: every status with either flag value; the entitlement is active exactly when the
      // flag is set, so the status name never decides.
      const record: SubscriptionRecord = {
        subscriptionReference: 's1',
        status,
        givesAccess,
        willRenew: 'unknown',
        origin: 'other',
        environment: 'production',
        productReference: 'p',
        billingInterval: 'month',
        currentPeriodStart: '2026-01-01T00:00:00.000Z',
        currentPeriodEnd: '2026-02-01T00:00:00.000Z',
        accessUntil: null,
        billingIssueSince: null,
        cancelledAt: null,
        refundedAt: null,
        managementReference: null
      }
      const resolution = entry.resolveEntitlements([record], new Map([['s1', ['pro']]]))
      expect(resolution.entitlements[0]?.active).toBe(givesAccess)
    }
  )
})
