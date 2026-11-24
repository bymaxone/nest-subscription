/**
 * @fileoverview Runs the conformance suite the way a host does, from the `testing` subpath, and
 * proves it rejects broken stores.
 * @layer e2e
 */
import { SubscriptionError } from '@bymax-one/nest-subscription'
import {
  InMemorySubscriptionStore,
  storeConformanceCases,
  type StoreFactory
} from '@bymax-one/nest-subscription/testing'
import { BROKEN_STORES, VALID_VARIANTS } from '../../src/testing/broken-stores.fixture'

const AT = '2026-01-01T00:00:00.000Z'

/** The names of the cases the factory's store fails. */
async function failures(factory: StoreFactory): Promise<string[]> {
  const failed: string[] = []
  for (const conformance of storeConformanceCases()) {
    try {
      await conformance.run(factory)
    } catch {
      failed.push(conformance.name)
    }
  }
  return failed
}

describe('store conformance through the testing subpath', () => {
  it('passes every case with the in-memory store', async () => {
    // Scenario: a host runs the cases against the shipped store; none fails.
    expect(
      await failures(() => new InMemorySubscriptionStore({ logger: () => undefined }))
    ).toEqual([])
  })

  it.each(Object.keys(VALID_VARIANTS))('passes every case with the %s store', async (variant) => {
    // Scenario: a store that differs only where the port leaves room passes the whole suite.
    const create =
      VALID_VARIANTS[variant] ?? ((): InMemorySubscriptionStore => new InMemorySubscriptionStore())
    expect(await failures(create)).toEqual([])
  })

  it.each(Object.keys(BROKEN_STORES))(
    'fails at least one case with the %s store',
    async (defect) => {
      // Scenario: each defect is caught by the suite; a store with a defect never passes whole.
      const create =
        BROKEN_STORES[defect] ?? ((): InMemorySubscriptionStore => new InMemorySubscriptionStore())
      expect((await failures(create)).length).toBeGreaterThan(0)
    }
  )
})

describe('the in-memory store through the testing subpath', () => {
  it('warns once and refuses malformed instants and page limits', async () => {
    // Scenario: the default logger raises a process warning; bad input is the library's error.
    const warnings: string[] = []
    const store = new InMemorySubscriptionStore({ logger: (message) => warnings.push(message) })
    expect(warnings).toHaveLength(1)
    await expect(store.markEventProcessed('s', 'e', 'x')).rejects.toBeInstanceOf(SubscriptionError)
    await expect(store.listStaleKeys(AT, 0, null)).rejects.toBeInstanceOf(SubscriptionError)
  })

  it('raises its default warning as a process warning', () => {
    // Scenario: with no logger given, the warning goes through `process.emitWarning`.
    const emit = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    const store = new InMemorySubscriptionStore()
    expect(store).toBeInstanceOf(InMemorySubscriptionStore)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('treats an empty clear, an unknown forget and an empty page as no-ops', async () => {
    // Scenario: nothing is stored; each call answers without error.
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    await store.clearPendingChanges('none', ['c'])
    await store.forgetEvent('none', 'e')
    expect(await store.listStaleKeys(AT, 3, null)).toEqual({ keys: [], nextCursor: null })
  })
})
