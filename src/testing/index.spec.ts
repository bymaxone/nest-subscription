/**
 * @fileoverview Pins the names the `testing` entry point exports.
 * @layer testing
 */
import * as entry from './index'

describe('testing entry point', () => {
  it('exports no name', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case.
    expect(Object.keys(entry)).toEqual([])
  })
})
