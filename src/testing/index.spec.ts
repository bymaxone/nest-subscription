/**
 * @fileoverview Pins the names the `testing` entry point exports.
 * @layer testing
 */
import { FakeSubscriptionSource } from './fake.source'
import * as entry from './index'
import { InMemorySubscriptionStore } from './in-memory.store'
import { storeConformanceCases } from './store-conformance'

describe('testing entry point', () => {
  it('exports exactly the names it promises', () => {
    // Scenario: the entry point is loaded by its relative path; a name exported without its own
    // test would appear here and fail the case, and a re-export must be the module's own value.
    expect(Object.keys(entry).sort()).toEqual([
      'FakeSubscriptionSource',
      'InMemorySubscriptionStore',
      'storeConformanceCases'
    ])
    expect(entry.FakeSubscriptionSource).toBe(FakeSubscriptionSource)
    expect(entry.InMemorySubscriptionStore).toBe(InMemorySubscriptionStore)
    expect(entry.storeConformanceCases).toBe(storeConformanceCases)
  })

  it('does not export the broken stores', () => {
    // Scenario: the deliberately broken stores are test fixtures and never part of the subpath.
    expect(Object.keys(entry).some((name) => /broken/i.test(name))).toBe(false)
  })
})
