/**
 * @fileoverview Pins the names the `core` entry point exports.
 * @layer core
 */
import * as entry from './index'

describe('core entry point', () => {
  it('exports no name', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case.
    expect(Object.keys(entry)).toEqual([])
  })
})
