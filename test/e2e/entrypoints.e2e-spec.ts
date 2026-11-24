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
      'SubscriptionError',
      'WILL_RENEW_VALUES',
      'createEmptySnapshot',
      'parseInstant',
      'resolveEntitlements'
    ])
    expect(Object.values(shared)).toHaveLength(10)
    expect([...shared.SUBSCRIPTION_ENVIRONMENTS]).toEqual(['production', 'sandbox'])
  })

  it('exposes exactly the names of the root and the internal bundle', () => {
    // Scenario: the root and the internal bundle re-export the error class that the shared subpath
    // defines, so all three name one class.
    expect(Object.keys(core).sort()).toEqual(
      [
        'SUBSCRIPTION_CACHE',
        'SUBSCRIPTION_CLOCK',
        'SUBSCRIPTION_OBSERVER',
        'SUBSCRIPTION_OPTIONS',
        'SUBSCRIPTION_SOURCE',
        'SUBSCRIPTION_STORE',
        'SUBSCRIPTION_ERROR_CODES',
        'SECRET_PLACEHOLDER',
        'Secret',
        'SubscriptionError',
        'SubscriptionModule',
        'encodeAccountKey',
        'resolveOptions',
        'validateOptions'
      ].sort()
    )
    expect(Object.values(core)).toHaveLength(14)
    expect(Object.keys(internal).sort()).toEqual(
      [
        'SUBSCRIPTION_CACHE',
        'SUBSCRIPTION_CLOCK',
        'SUBSCRIPTION_OBSERVER',
        'SUBSCRIPTION_OPTIONS',
        'SUBSCRIPTION_SOURCE',
        'SUBSCRIPTION_STORE',
        'SECRET_PLACEHOLDER',
        'Secret',
        'SubscriptionError',
        'encodeAccountKey'
      ].sort()
    )
    expect(Object.values(internal)).toHaveLength(10)
    expect(core.SubscriptionError).toBe(shared.SubscriptionError)
    expect(internal.SubscriptionError).toBe(shared.SubscriptionError)
  })

  it('exposes nothing yet from the adapter subpaths', () => {
    // Scenario: these subpaths are loaded through their aliases and hold no name.
    for (const entry of [revenuecat, finance]) {
      expect(Object.keys(entry)).toEqual([])
    }
  })

  it('exposes exactly the names of the testing subpath', () => {
    // Scenario: the store and the conformance cases are the only names it holds so far.
    expect(Object.keys(testing).sort()).toEqual([
      'FakeSubscriptionSource',
      'InMemorySubscriptionStore',
      'storeConformanceCases'
    ])
    expect(Object.values(testing)).toHaveLength(3)
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
