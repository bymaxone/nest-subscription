/**
 * @fileoverview Pins the failing-store wrapper: it delegates until a test switches it to failing,
 * fails exactly the methods named (or every method when none is named) with a rejection, and
 * recovers on request.
 * @layer testing
 */
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'

import { createFailingStore, type FailingStoreMethod } from './failing.store'
import { InMemorySubscriptionStore } from './in-memory.store'

const AT = '2026-01-01T00:00:00.000Z'
const KEY = 'acc-1'
const SNAPSHOT = createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt: AT })

/** A fresh in-memory store that stays quiet. */
function inner(): InMemorySubscriptionStore {
  return new InMemorySubscriptionStore({ logger: () => undefined })
}

/** Every method of the port, called once with valid arguments, by name. */
const CALLS: Readonly<
  Record<FailingStoreMethod, (store: ReturnType<typeof createFailingStore>) => Promise<unknown>>
> = {
  getSnapshot: (store) => store.getSnapshot(KEY),
  putSnapshot: (store) => store.putSnapshot(KEY, SNAPSHOT, [], AT),
  clearPendingChanges: (store) => store.clearPendingChanges(KEY, []),
  listKeysWithPendingChanges: (store) => store.listKeysWithPendingChanges(10, null),
  markEventProcessed: (store) => store.markEventProcessed('fake', 'e1', AT),
  forgetEvent: (store) => store.forgetEvent('fake', 'e1'),
  deleteEventsOlderThan: (store) => store.deleteEventsOlderThan(AT),
  listStaleKeys: (store) => store.listStaleKeys(AT, 10, null)
}
const METHODS = Object.keys(CALLS) as FailingStoreMethod[]

describe('createFailingStore', () => {
  it.each(METHODS)('delegates %s to the wrapped store until told to fail', async (method) => {
    // Scenario: nothing is switched; each method answers as the wrapped store answers.
    const store = createFailingStore(inner())
    await expect(CALLS[method](store)).resolves.not.toThrow()
  })

  it('returns what the wrapped store returns, not a copy of it', async () => {
    // Scenario: the wrapped store answers a known object; the wrapper hands back that object.
    const wrapped = inner()
    const answer = { snapshot: SNAPSHOT, pendingChanges: [] }
    jest.spyOn(wrapped, 'getSnapshot').mockResolvedValue(answer)
    const store = createFailingStore(wrapped)
    await expect(store.getSnapshot(KEY)).resolves.toBe(answer)
  })

  it.each(METHODS)('fails %s with a rejection when no method is named', async (method) => {
    // Scenario: failing with no names fails every method, and the failure is a rejected promise.
    const store = createFailingStore(inner())
    store.fail()
    const pending = CALLS[method](store)
    await expect(pending).rejects.toThrow('failing store')
  })

  it.each(METHODS)(
    'fails only %s when it alone is named, and delegates every other',
    async (named) => {
      // Scenario: one method of the port is named; it rejects without reaching the wrapped store,
      // and each of the other seven resolves after the wrapped store's own method is called once.
      const wrapped = inner()
      const spies = new Map(METHODS.map((method) => [method, jest.spyOn(wrapped, method)]))
      const store = createFailingStore(wrapped)
      store.fail([named])
      await expect(CALLS[named](store)).rejects.toThrow('failing store')
      expect(spies.get(named)).not.toHaveBeenCalled()
      for (const other of METHODS.filter((method) => method !== named)) {
        await expect(CALLS[other](store)).resolves.not.toThrow()
        expect(spies.get(other)).toHaveBeenCalledTimes(1)
      }
    }
  )

  it('reaches the wrapped store with a write that is not named', async () => {
    // Scenario: only `getSnapshot` is named; a write still lands in the wrapped store, which the
    // test reads directly.
    const wrapped = inner()
    const store = createFailingStore(wrapped)
    store.fail(['getSnapshot'])
    await expect(store.putSnapshot(KEY, SNAPSHOT, [], AT)).resolves.toBe(true)
    expect((await wrapped.getSnapshot(KEY))?.snapshot).toEqual(SNAPSHOT)
  })

  it('names the failing method in the rejection and nothing else', async () => {
    // Scenario: the message holds the method name and no argument, so a test of a guard's body
    // can prove no store detail leaks.
    const store = createFailingStore(inner())
    store.fail(['getSnapshot'])
    await expect(store.getSnapshot('acc-secret-9')).rejects.toThrow(
      new Error('failing store: getSnapshot')
    )
  })

  it('rejects with the error it was given', async () => {
    // Scenario: a test supplies its own error and receives that very object.
    const store = createFailingStore(inner())
    const boom = new Error('boom')
    store.fail(['getSnapshot'], boom)
    await expect(store.getSnapshot(KEY)).rejects.toBe(boom)
  })

  it('does not call the wrapped store while a method is failing', async () => {
    // Scenario: a failing write leaves the wrapped store as it was.
    const wrapped = inner()
    const store = createFailingStore(wrapped)
    store.fail(['putSnapshot'])
    await expect(store.putSnapshot(KEY, SNAPSHOT, [], AT)).rejects.toThrow('failing store')
    expect(await wrapped.getSnapshot(KEY)).toBeNull()
  })

  it('delegates again after recover', async () => {
    // Scenario: a store switched to failing and back reads as before.
    const store = createFailingStore(inner())
    store.fail()
    store.recover()
    await expect(store.getSnapshot(KEY)).resolves.toBeNull()
  })

  it('replaces the earlier failing set when told to fail again', async () => {
    // Scenario: failing `getSnapshot`, then only `putSnapshot`: the read works again.
    const store = createFailingStore(inner())
    store.fail(['getSnapshot'])
    store.fail(['putSnapshot'])
    await expect(store.getSnapshot(KEY)).resolves.toBeNull()
    await expect(store.putSnapshot(KEY, SNAPSHOT, [], AT)).rejects.toThrow('failing store')
  })

  it('rejects even when the wrapped method would throw synchronously', async () => {
    // Scenario: the wrapped method throws before returning a promise; the wrapper still hands the
    // caller a promise, so a caller that awaits and one that attaches a handler behave alike.
    const wrapped = inner()
    jest.spyOn(wrapped, 'getSnapshot').mockImplementation(() => {
      throw new Error('sync throw')
    })
    const store = createFailingStore(wrapped)
    await expect(store.getSnapshot(KEY)).rejects.toThrow('sync throw')
  })
})
