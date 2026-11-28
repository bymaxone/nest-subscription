/**
 * @fileoverview The failing store through the `testing` subpath, the way a host uses it: while
 * healthy it passes the whole store conformance suite, so wrapping a store changes nothing, and
 * once switched to failing every method of the port rejects.
 * @layer e2e
 */
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import {
  InMemorySubscriptionStore,
  createFailingStore,
  storeConformanceCases,
  type FailingStore
} from '@bymax-one/nest-subscription/testing'

const AT = '2026-01-01T00:00:00.000Z'

/** A failing store over a quiet in-memory one. */
function wrapped(): FailingStore {
  return createFailingStore(new InMemorySubscriptionStore({ logger: () => undefined }))
}

describe('the failing store through the testing subpath', () => {
  it.each(storeConformanceCases().map((conformance) => [conformance.name, conformance] as const))(
    'passes the conformance case "%s" while it is healthy',
    async (_name, conformance) => {
      // Scenario: a host wraps its store for an outage test; until it fails the wrapper, every
      // guarantee of the port still holds.
      await expect(conformance.run(wrapped)).resolves.toBeUndefined()
    }
  )

  it.each(['putSnapshot', 'replaceSnapshot'] as const)(
    'rejects a conditional write when %s is named as failing',
    async (method) => {
      // Scenario: a conditional write is a write, so naming either method fails it.
      const store = wrapped()
      store.fail([method])
      const snapshot = createEmptySnapshot({ accountId: 'k', source: 'fake', fetchedAt: AT })
      await expect(store.replaceSnapshot?.('k', null, snapshot, [], AT)).rejects.toThrow(
        'failing store'
      )
    }
  )

  it('offers no conditional write over a store that has none', () => {
    // Scenario: a host store without the optional method is wrapped.
    const memory = new InMemorySubscriptionStore({ logger: () => undefined })
    Object.defineProperty(memory, 'replaceSnapshot', { value: undefined })
    expect(createFailingStore(memory).replaceSnapshot).toBeUndefined()
  })

  it('rejects every method of the port once switched to failing, and none after recover', async () => {
    // Scenario: all eight methods are called while failing and then again after recovering.
    const store = wrapped()
    const calls = [
      () => store.getSnapshot('k'),
      () =>
        store.putSnapshot(
          'k',
          createEmptySnapshot({ accountId: 'k', source: 'fake', fetchedAt: AT }),
          [],
          AT
        ),
      () => store.clearPendingChanges('k', []),
      () => store.listKeysWithPendingChanges(10, null),
      () => store.markEventProcessed('fake', 'e1', AT),
      () => store.forgetEvent('fake', 'e1'),
      () => store.deleteEventsOlderThan(AT),
      () => store.listStaleKeys(AT, 10, null)
    ]
    store.fail()
    for (const call of calls) await expect(call()).rejects.toThrow('failing store')
    store.recover()
    for (const call of calls) await expect(call()).resolves.not.toThrow()
  })
})
