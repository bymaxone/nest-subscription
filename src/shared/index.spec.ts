/**
 * @fileoverview Pins the names the `shared` entry point exports.
 * @layer shared
 */
import * as entry from './index'
import { createEmptySnapshot } from './empty-snapshot'
import { SUBSCRIPTION_ERROR_CODES } from './error-codes'
import { SubscriptionInputError, resolveEntitlements } from './entitlements'
import * as values from './values'

describe('shared entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the module's own value.
    expect(Object.keys(entry).sort()).toEqual([
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
    expect(entry.CHANGE_KINDS).toBe(values.CHANGE_KINDS)
    expect(entry.SUBSCRIPTION_ENVIRONMENTS).toBe(values.SUBSCRIPTION_ENVIRONMENTS)
    expect(entry.SUBSCRIPTION_ERROR_CODES).toBe(SUBSCRIPTION_ERROR_CODES)
    expect(entry.createEmptySnapshot).toBe(createEmptySnapshot)
    expect(entry.resolveEntitlements).toBe(resolveEntitlements)
    expect(entry.SubscriptionInputError).toBe(SubscriptionInputError)
    expect(entry.SUBSCRIPTION_ORIGINS).toBe(values.SUBSCRIPTION_ORIGINS)
    expect(entry.SUBSCRIPTION_STATUSES).toBe(values.SUBSCRIPTION_STATUSES)
    expect(entry.WILL_RENEW_VALUES).toBe(values.WILL_RENEW_VALUES)
  })
})
