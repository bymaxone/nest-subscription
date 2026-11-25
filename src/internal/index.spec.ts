/**
 * @fileoverview Pins the names the `internal` entry point exports.
 * @layer internal
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/shared'

import { hashAccountKey } from './account-hash'
import { decodeAccountKey, encodeAccountKey } from './account-key'
import * as entry from './index'
import * as tokens from './tokens'

describe('internal entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the module's own value.
    expect(Object.keys(entry).sort()).toEqual([
      'SECRET_PLACEHOLDER',
      'SUBSCRIPTION_CACHE',
      'SUBSCRIPTION_CLOCK',
      'SUBSCRIPTION_OBSERVER',
      'SUBSCRIPTION_OPTIONS',
      'SUBSCRIPTION_SOURCE',
      'SUBSCRIPTION_STORE',
      'Secret',
      'SubscriptionError',
      'decodeAccountKey',
      'encodeAccountKey',
      'hashAccountKey'
    ])
    expect(entry.SubscriptionError).toBe(SubscriptionError)
    expect(entry.encodeAccountKey).toBe(encodeAccountKey)
    expect(entry.decodeAccountKey).toBe(decodeAccountKey)
    expect(entry.hashAccountKey).toBe(hashAccountKey)
    for (const [name, token] of Object.entries(tokens)) {
      expect(entry[name as keyof typeof entry]).toBe(token)
    }
  })
})
