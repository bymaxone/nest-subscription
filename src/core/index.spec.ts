/**
 * @fileoverview Pins the names the `core` entry point exports.
 * @layer core
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import * as entry from './index'
import { SUBSCRIPTION_ERROR_CODES } from '../shared/error-codes'

describe('core entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the origin's own value.
    expect(Object.keys(entry).sort()).toEqual(['SUBSCRIPTION_ERROR_CODES', 'SubscriptionError'])
    expect(entry.SubscriptionError).toBe(SubscriptionError)
    expect(entry.SUBSCRIPTION_ERROR_CODES).toBe(SUBSCRIPTION_ERROR_CODES)
  })
})
