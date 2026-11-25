/**
 * @fileoverview Pins the names the `revenuecat` entry point exports.
 * @layer revenuecat
 */
import * as entry from './index'
import { revenueCatSource } from './revenuecat.source'

describe('revenuecat entry point', () => {
  it('exports the source factory and nothing else at run time', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and the factory is the one in the source file.
    expect(Object.keys(entry)).toStrictEqual(['revenueCatSource'])
    expect(entry.revenueCatSource).toBe(revenueCatSource)
  })
})
