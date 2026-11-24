/**
 * @fileoverview Pins the names the `revenuecat` entry point exports.
 * @layer revenuecat
 */
import * as entry from './index'

describe('revenuecat entry point', () => {
  it('exports no name', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case.
    expect(Object.keys(entry)).toEqual([])
  })
})
