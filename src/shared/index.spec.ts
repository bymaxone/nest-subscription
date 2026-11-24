/**
 * @fileoverview Pins the names the `shared` entry point exports.
 * @layer shared
 */
import * as entry from './index'
import { SUBSCRIPTION_ENVIRONMENTS } from './values'

describe('shared entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the module's own value.
    expect(Object.keys(entry)).toEqual(['SUBSCRIPTION_ENVIRONMENTS'])
    expect(entry.SUBSCRIPTION_ENVIRONMENTS).toBe(SUBSCRIPTION_ENVIRONMENTS)
  })
})
