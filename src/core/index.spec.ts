/**
 * @fileoverview Pins the names the `core` entry point exports.
 * @layer core
 */
import * as internal from '@bymax-one/nest-subscription/internal'
import * as entry from './index'
import { SUBSCRIPTION_ERROR_CODES } from '../shared/error-codes'

describe('core entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case.
    expect(Object.keys(entry).sort()).toEqual([
      'SUBSCRIPTION_CACHE',
      'SUBSCRIPTION_CLOCK',
      'SUBSCRIPTION_ERROR_CODES',
      'SUBSCRIPTION_OBSERVER',
      'SUBSCRIPTION_OPTIONS',
      'SUBSCRIPTION_SOURCE',
      'SUBSCRIPTION_STORE',
      'SubscriptionError',
      'encodeAccountKey'
    ])
  })

  it('re-exports the values of their origin, not copies', () => {
    // Scenario: each name the root takes from the internal bundle or from `shared` is the very
    // value of its origin, so one constructor and one set of symbols serve every entry point.
    expect(entry.SUBSCRIPTION_ERROR_CODES).toBe(SUBSCRIPTION_ERROR_CODES)
    for (const [name, value] of Object.entries(internal)) {
      expect(entry[name as keyof typeof entry]).toBe(value)
    }
  })
})
