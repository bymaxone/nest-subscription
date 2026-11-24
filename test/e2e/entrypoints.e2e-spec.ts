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
  it('resolves each published subpath through its alias and exposes exactly its names', () => {
    // Scenario: a consumer imports the package root and each subpath; every alias must reach a
    // module of its own directory, and a name exported without its owning code would show here
    // and fail the case.
    expect(Object.keys(shared).sort()).toEqual([
      'CHANGE_KINDS',
      'SUBSCRIPTION_ENVIRONMENTS',
      'SUBSCRIPTION_ERROR_CODES',
      'SUBSCRIPTION_ORIGINS',
      'SUBSCRIPTION_STATUSES',
      'WILL_RENEW_VALUES'
    ])
    // Reading the export resolves its re-export to the real value.
    expect([...shared.SUBSCRIPTION_ENVIRONMENTS]).toEqual(['production', 'sandbox'])
    expect(Object.keys(core).sort()).toEqual(['SUBSCRIPTION_ERROR_CODES', 'SubscriptionError'])
    expect(Object.keys(internal)).toEqual(['SubscriptionError'])
    // The root re-exports the class the internal bundle defines: one constructor, one instanceof.
    expect(core.SubscriptionError).toBe(internal.SubscriptionError)
    const error = new core.SubscriptionError(core.SUBSCRIPTION_ERROR_CODES.NO_ACCESS)
    expect(error).toBeInstanceOf(internal.SubscriptionError)
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: 'SUBSCRIPTION_NO_ACCESS',
      message: error.message
    })
    // Reading every export resolves each re-export to its real value, so the suite measures the
    // names it claims.
    expect(Object.values(core)).toHaveLength(2)
    expect(Object.values(shared)).toHaveLength(6)
    for (const entry of [revenuecat, finance, testing]) {
      expect(Object.keys(entry)).toEqual([])
    }
  })
})
