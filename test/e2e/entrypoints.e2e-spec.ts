/**
 * @fileoverview Pins that each published subpath resolves through its alias and exposes exactly
 * the names it should.
 * @layer e2e
 */
import * as core from '@bymax-one/nest-subscription'
import * as finance from '@bymax-one/nest-subscription/finance'
import * as internal from '@bymax-one/nest-subscription/internal'
import * as revenuecat from '@bymax-one/nest-subscription/revenuecat'
import * as shared from '@bymax-one/nest-subscription/shared'
import * as testing from '@bymax-one/nest-subscription/testing'

describe('entry points', () => {
  it('exposes exactly the names of the shared subpath', () => {
    // Scenario: a consumer imports the shared subpath; a name exported without its owning code
    // would show here. Reading every value resolves each re-export to the real value.
    expect(Object.keys(shared).sort()).toEqual([
      'CHANGE_KINDS',
      'SUBSCRIPTION_ENVIRONMENTS',
      'SUBSCRIPTION_ERROR_CODES',
      'SUBSCRIPTION_ORIGINS',
      'SUBSCRIPTION_STATUSES',
      'SubscriptionInputError',
      'WILL_RENEW_VALUES',
      'createEmptySnapshot',
      'resolveEntitlements'
    ])
    expect(Object.values(shared)).toHaveLength(9)
    expect([...shared.SUBSCRIPTION_ENVIRONMENTS]).toEqual(['production', 'sandbox'])
  })

  it('exposes exactly the names of the root and the internal bundle', () => {
    // Scenario: the root re-exports the error class and the codes; the internal bundle holds the
    // class itself.
    expect(Object.keys(core).sort()).toEqual([
      'SUBSCRIPTION_ERROR_CODES',
      'SubscriptionError',
      'encodeAccountKey'
    ])
    expect(Object.values(core)).toHaveLength(3)
    expect(Object.keys(internal)).toEqual(['SubscriptionError', 'encodeAccountKey'])
  })

  it('exposes nothing yet from the adapter and testing subpaths', () => {
    // Scenario: these subpaths are loaded through their aliases and hold no name.
    for (const entry of [revenuecat, finance, testing]) {
      expect(Object.keys(entry)).toEqual([])
    }
  })

  it('raises one error class whichever entry point it is reached from', () => {
    // Scenario: the root re-exports the class the internal bundle defines, so one constructor
    // serves every instanceof check, and its serialized form holds the code and message only.
    expect(core.SubscriptionError).toBe(internal.SubscriptionError)
    expect(core.encodeAccountKey).toBe(internal.encodeAccountKey)
    const error = new core.SubscriptionError(core.SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
    expect(error).toBeInstanceOf(internal.SubscriptionError)
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: 'SUBSCRIPTION_NO_ACCESS',
      message: error.message
    })
  })
})
