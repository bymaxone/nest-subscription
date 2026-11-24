/**
 * @fileoverview Pins the names the `internal` entry point exports.
 * @layer internal
 */
import * as entry from './index'
import { encodeAccountKey } from './account-key'
import { SubscriptionError } from './subscription.error'

describe('internal entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the module's own value.
    expect(Object.keys(entry)).toEqual(['SubscriptionError', 'encodeAccountKey'])
    expect(entry.SubscriptionError).toBe(SubscriptionError)
    expect(entry.encodeAccountKey).toBe(encodeAccountKey)
  })
})
