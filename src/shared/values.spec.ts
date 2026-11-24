/**
 * @fileoverview Pins the members of the value sets of the model, that each set is frozen, and that
 * the model offers no function from a status to access.
 * @layer shared
 */
import * as entry from './index'
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

describe('status meanings', () => {
  // The access meaning of each status as the specification states it. A status never decides
  // access in the library; this table records what the source's flag is expected to say.
  const meanings: ReadonlyArray<
    readonly [SubscriptionStatus, 'yes' | 'no' | 'as the source says']
  > = [
    ['trialing', 'yes'],
    ['active', 'yes'],
    ['in_grace', 'yes'],
    ['on_hold', 'no'],
    ['paused', 'no'],
    ['expired', 'no'],
    ['unknown', 'as the source says']
  ]

  it('states a meaning for every status and for no other', () => {
    // Scenario: the table covers each member of the set exactly once, in the set's order.
    expect(meanings.map(([status]) => status)).toEqual([...SUBSCRIPTION_STATUSES])
  })

  it('exports no function from a status to access', () => {
    // Scenario: every runtime export of the shared entry point is a frozen value set, so no
    // function exists that takes a status and returns access.
    const functions = Object.entries(entry).filter(([, value]) => typeof value === 'function')
    expect(functions).toEqual([])
  })
})
