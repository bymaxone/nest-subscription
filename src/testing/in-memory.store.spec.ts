/**
 * @fileoverview Pins what the conformance suite does not state about the in-memory store: the
 * construction warning, input validation and the isolation of stored values from callers.
 * @layer testing
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { createEmptySnapshot, type SubscriptionChange } from '../shared'
import { InMemorySubscriptionStore } from './in-memory.store'

const AT = '2026-01-01T00:00:00.000Z'

function quiet(): InMemorySubscriptionStore {
  return new InMemorySubscriptionStore({ logger: () => undefined })
}

function snapshot(accountId: string): ReturnType<typeof createEmptySnapshot> {
  return createEmptySnapshot({ accountId, source: 's', fetchedAt: AT })
}

describe('InMemorySubscriptionStore', () => {
  it('warns once at construction, through the logger, that it is not for production', () => {
    // Scenario: the logger is injected, so nothing reaches the console; one call, one message.
    const messages: string[] = []
    const store = new InMemorySubscriptionStore({ logger: (message) => messages.push(message) })
    void store
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('not for production')
  })

  it('warns through a process warning when no logger is given', () => {
    // Scenario: the default logger raises one process warning and writes nothing itself.
    const emit = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
    const store = new InMemorySubscriptionStore()
    void store
    expect(emit).toHaveBeenCalledTimes(1)
    expect(String(emit.mock.calls[0]?.[0])).toContain('not for production')
    expect(emit.mock.calls[0]?.[1]).toBe('SubscriptionWarning')
  })

  it('refuses a write, a mark and a listing carrying an instant that is not a date', async () => {
    // Scenario: a malformed instant is a caller error with the catalogue code.
    const store = quiet()
    const code = { code: 'SUBSCRIPTION_INVALID_INPUT' }
    await expect(store.putSnapshot('k', snapshot('a'), [], 'x')).rejects.toMatchObject(code)
    await expect(store.markEventProcessed('s', 'e', 'x')).rejects.toBeInstanceOf(SubscriptionError)
    await expect(store.deleteEventsOlderThan('x')).rejects.toMatchObject(code)
    await expect(store.listStaleKeys('x', 5, null)).rejects.toMatchObject(code)
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses the page limit %s', async (limit) => {
    // Scenario: a page holds a positive whole number of keys.
    const store = quiet()
    await expect(store.listStaleKeys(AT, limit, null)).rejects.toBeInstanceOf(SubscriptionError)
    await expect(store.listKeysWithPendingChanges(limit, null)).rejects.toBeInstanceOf(
      SubscriptionError
    )
  })

  it('is not changed by an object the caller passed in or received', async () => {
    // Scenario: the caller mutates what it wrote and what it read; the stored value stays.
    const store = quiet()
    const written = { ...snapshot('a'), accountId: 'a' }
    const changes: SubscriptionChange[] = [{ kind: 'started', key: 'c1' }]
    await store.putSnapshot('k', written, changes, AT)
    changes[0] = { kind: 'expired', key: 'changed' }
    const read = await store.getSnapshot('k')
    if (read !== null) (read.pendingChanges as SubscriptionChange[]).length = 0
    expect((await store.getSnapshot('k'))?.pendingChanges).toEqual([{ kind: 'started', key: 'c1' }])
  })

  it('leaves the snapshot alone when it clears changes of another key', async () => {
    // Scenario: clearing on one key does not touch another key's pending changes.
    const store = quiet()
    await store.putSnapshot('one', snapshot('one'), [{ kind: 'started', key: 'c' }], AT)
    await store.putSnapshot('two', snapshot('two'), [{ kind: 'started', key: 'c' }], AT)
    await store.clearPendingChanges('one', ['c'])
    expect((await store.getSnapshot('two'))?.pendingChanges).toHaveLength(1)
  })

  it('pages in key order and ends with a null cursor', async () => {
    // Scenario: five keys read two at a time come back sorted, with the cursor of each page.
    const store = quiet()
    for (const key of ['e', 'b', 'a', 'd', 'c']) {
      await store.putSnapshot(key, snapshot(key), [], AT)
    }
    const later = '2026-06-01T00:00:00.000Z'
    const first = await store.listStaleKeys(later, 2, null)
    const second = await store.listStaleKeys(later, 2, first.nextCursor)
    const third = await store.listStaleKeys(later, 2, second.nextCursor)
    expect([first, second, third]).toEqual([
      { keys: ['a', 'b'], nextCursor: 'b' },
      { keys: ['c', 'd'], nextCursor: 'd' },
      { keys: ['e'], nextCursor: null }
    ])
  })

  it('accepts a page limit of exactly one', async () => {
    // Scenario: the smallest valid page holds one key and points at the next.
    const store = quiet()
    await store.putSnapshot('a', snapshot('a'), [], AT)
    await store.putSnapshot('b', snapshot('b'), [], AT)
    expect(await store.listStaleKeys('2026-06-01T00:00:00.000Z', 1, null)).toEqual({
      keys: ['a'],
      nextCursor: 'a'
    })
  })

  it('ends the listing at a page that is exactly full', async () => {
    // Scenario: four keys read two at a time; the second page is full and is the last.
    const store = quiet()
    for (const key of ['a', 'b', 'c', 'd']) await store.putSnapshot(key, snapshot(key), [], AT)
    const later = '2026-06-01T00:00:00.000Z'
    const first = await store.listStaleKeys(later, 2, null)
    expect(await store.listStaleKeys(later, 2, first.nextCursor)).toEqual({
      keys: ['c', 'd'],
      nextCursor: null
    })
  })

  it('lists the keys with pending changes in key order, whatever the order written', async () => {
    // Scenario: keys written out of order come back sorted, so a cursor is a position.
    const store = quiet()
    const change = { kind: 'started', key: 'c' } as const
    for (const key of ['c', 'a', 'b']) await store.putSnapshot(key, snapshot(key), [change], AT)
    expect(await store.listKeysWithPendingChanges(2, null)).toEqual({
      keys: ['a', 'b'],
      nextCursor: 'b'
    })
  })
})
