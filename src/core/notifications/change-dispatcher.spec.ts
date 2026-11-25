/**
 * @fileoverview Pins the change dispatcher: the hook runs only when called after a write, gets the
 * previous snapshot on a first delivery and none on a redelivery, changes are cleared only after
 * the hook returned, a failing hook or clear leaves them pending, and no failure reaches the
 * caller, the log or the observer with an identifier or an error text.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  hashAccountKey,
  type AccountReference,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import { InMemorySubscriptionStore, ManualClock } from '@bymax-one/nest-subscription/testing'

import { ObserverBridge } from '../observer/observer-bridge'
import type { SubscriptionObserver } from '../observer/observer.types'
import type { SubscriptionChangeNotification } from '../options/subscription-options.types'
import { ChangeDispatcher } from './change-dispatcher'

const ACCOUNT: AccountReference = { accountId: 'sentinel-account', tenantId: 'sentinel-tenant' }
const KEY = encodeAccountKey(ACCOUNT)
const T0 = '2026-01-01T00:00:00.000Z'
const CHANGES: readonly SubscriptionChange[] = [
  { kind: 'renewed', key: 'key-1' },
  { kind: 'refunded', key: 'key-2' }
]

/** A snapshot of the account, marked so two of them can be told apart. */
function snapshot(marker: string, account: AccountReference = ACCOUNT): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    sourceCustomer: { id: marker }
  }
}

/** A dispatcher over a fresh store holding the snapshot and the changes, with its recorders. */
async function setup(
  hook: (notification: SubscriptionChangeNotification) => unknown,
  options: {
    observer?: SubscriptionObserver
    store?: (base: SubscriptionStore) => SubscriptionStore
  } = {}
): Promise<{
  dispatcher: ChangeDispatcher
  store: SubscriptionStore
  lines: string[]
}> {
  const base = new InMemorySubscriptionStore({ logger: () => undefined })
  await base.putSnapshot(KEY, snapshot('now'), CHANGES, T0)
  const store = options.store?.(base) ?? base
  const lines: string[] = []
  const bridge = new ObserverBridge(options.observer ?? null, new ManualClock(T0))
  const logger = { warn: (message: string): void => void lines.push(message) }
  return { dispatcher: new ChangeDispatcher(hook, store, logger, bridge), store, lines }
}

/** The keys of the changes still pending for the account. */
async function pendingKeys(store: SubscriptionStore): Promise<string[]> {
  return ((await store.getSnapshot(KEY))?.pendingChanges ?? []).map((change) => change.key)
}

describe('ChangeDispatcher.deliver', () => {
  it('calls the hook with the previous snapshot, the new one and the changes', async () => {
    // Scenario: a first delivery after a write.
    const hook = jest.fn()
    const { dispatcher } = await setup(hook)
    const previous = snapshot('before')
    const current = snapshot('now')
    await dispatcher.deliver(KEY, previous, current, CHANGES)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith({ previous, current, changes: CHANGES, redelivery: false })
  })

  it('passes a null previous snapshot when the account had none stored', async () => {
    // Scenario: the first contact with an account.
    const hook = jest.fn()
    const { dispatcher } = await setup(hook)
    await dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)
    expect(hook.mock.calls[0]?.[0]).toMatchObject({ previous: null, redelivery: false })
  })

  it('clears the delivered keys and no others', async () => {
    // Scenario: two changes pending, the hook is told of one; only that key is cleared.
    const hook = jest.fn()
    const { dispatcher, store } = await setup(hook)
    await dispatcher.deliver(KEY, null, snapshot('now'), [CHANGES[0] as SubscriptionChange])
    expect(await pendingKeys(store)).toStrictEqual(['key-2'])
  })

  it('waits for an asynchronous hook before it clears anything', async () => {
    // Scenario: the hook settles later; at that moment the changes are still pending.
    let release: () => void = () => undefined
    const hook = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const { dispatcher, store } = await setup(hook)
    const delivery = dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)
    await new Promise((resolve) => setImmediate(resolve))
    expect(await pendingKeys(store)).toStrictEqual(['key-1', 'key-2'])
    release()
    await delivery
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('calls nothing for an empty list of changes', async () => {
    // Scenario: a refresh that changed nothing has nothing to tell.
    const hook = jest.fn()
    const { dispatcher } = await setup(hook)
    await dispatcher.deliver(KEY, null, snapshot('now'), [])
    expect(hook).not.toHaveBeenCalled()
  })

  it.each([
    [
      'throws',
      (): never => {
        throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
      }
    ],
    ['rejects', () => Promise.reject(new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT))]
  ])(
    'keeps the changes pending, logs the code and resolves when the hook %s',
    async (_how, hook) => {
      // Scenario: a hook failing both ways; the snapshot stays, the changes stay marked, the log
      // line names the code of the catalogue and nothing else.
      const { dispatcher, store, lines } = await setup(hook)
      await expect(dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)).resolves.toBeUndefined()
      expect(await pendingKeys(store)).toStrictEqual(['key-1', 'key-2'])
      expect((await store.getSnapshot(KEY))?.snapshot.sourceCustomer?.id).toBe('now')
      expect(lines).toStrictEqual([
        `The change hook failed; its changes stay pending and are delivered again (account ${hashAccountKey(KEY)}): SUBSCRIPTION_INVALID_INPUT.`
      ])
    }
  )

  it("logs an error that is not the library's as unclassified, without its text", async () => {
    // Scenario: the host's hook throws an error whose message carries the account identifier.
    const { dispatcher, lines } = await setup(() => {
      throw new Error('boom for sentinel-account')
    })
    await dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/: unclassified\.$/)
    expect(lines[0]).not.toMatch(/sentinel|boom/)
  })

  it('tells the observer how the call ended, with no identifier', async () => {
    // Scenario: one delivered call and one failed call.
    const onChangeDelivery = jest.fn()
    let fail = false
    const { dispatcher } = await setup(
      () => {
        if (fail) throw new Error('boom')
      },
      { observer: { onChangeDelivery } }
    )
    await dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)
    fail = true
    await dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)
    expect(onChangeDelivery.mock.calls.map(([event]) => event)).toStrictEqual([
      { outcome: 'delivered', redelivery: false, changeCount: 2, durationMs: 0, code: null },
      { outcome: 'failed', redelivery: false, changeCount: 2, durationMs: 0, code: null }
    ])
  })

  it('logs a failure to clear and leaves the changes to be delivered again', async () => {
    // Scenario: the hook returned but the store cannot clear; the call still resolves.
    const failure = new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    const { dispatcher, store, lines } = await setup(jest.fn(), {
      store: (base) => ({
        ...bind(base),
        clearPendingChanges: () => Promise.reject(failure)
      })
    })
    await expect(dispatcher.deliver(KEY, null, snapshot('now'), CHANGES)).resolves.toBeUndefined()
    expect(await pendingKeys(store)).toStrictEqual(['key-1', 'key-2'])
    expect(lines).toStrictEqual([
      `The change hook returned but its changes could not be cleared; they are delivered again (account ${hashAccountKey(KEY)}): SUBSCRIPTION_SOURCE_UNAVAILABLE.`
    ])
  })
})

/** The methods of a store bound to it, so a copy of them can override one. */
function bind(base: SubscriptionStore): SubscriptionStore {
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (key, snap, changes, at) => base.putSnapshot(key, snap, changes, at),
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (source, id, at) => base.markEventProcessed(source, id, at),
    forgetEvent: (source, id) => base.forgetEvent(source, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor)
  }
}

describe('ChangeDispatcher.redeliver', () => {
  it('calls the hook with the stored snapshot, the pending changes and no previous snapshot', async () => {
    // Scenario: a crash left two changes pending; the redelivery carries their stored keys.
    const hook = jest.fn()
    const { dispatcher, store } = await setup(hook)
    await dispatcher.redeliver(KEY, ACCOUNT)
    const stored = await store.getSnapshot(KEY)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith({
      previous: null,
      current: stored?.snapshot,
      changes: CHANGES,
      redelivery: true
    })
  })

  it('clears the changes it delivered', async () => {
    // Scenario: the hook returns, so the pending mark is removed.
    const { dispatcher, store } = await setup(jest.fn())
    await dispatcher.redeliver(KEY, ACCOUNT)
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('keeps the changes pending when the hook fails, and resolves', async () => {
    // Scenario: the hook rejects on the redelivery; the next run will try again.
    const { dispatcher, store, lines } = await setup(() => Promise.reject(new Error('boom')))
    await expect(dispatcher.redeliver(KEY, ACCOUNT)).resolves.toBeUndefined()
    expect(await pendingKeys(store)).toStrictEqual(['key-1', 'key-2'])
    expect(lines).toHaveLength(1)
  })

  it('tells the observer the call was a redelivery', async () => {
    // Scenario: the observer sees the redelivery flag.
    const onChangeDelivery = jest.fn()
    const { dispatcher } = await setup(jest.fn(), { observer: { onChangeDelivery } })
    await dispatcher.redeliver(KEY, ACCOUNT)
    expect(onChangeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'delivered', redelivery: true, changeCount: 2 })
    )
  })

  it('calls nothing when the account has no pending change', async () => {
    // Scenario: everything was cleared already.
    const hook = jest.fn()
    const { dispatcher, store } = await setup(hook)
    await store.clearPendingChanges(KEY, ['key-1', 'key-2'])
    await dispatcher.redeliver(KEY, ACCOUNT)
    expect(hook).not.toHaveBeenCalled()
  })

  it('calls nothing when no snapshot is stored under the key', async () => {
    // Scenario: the key names an account the store does not hold.
    const hook = jest.fn()
    const { dispatcher } = await setup(hook)
    const other = { accountId: 'other' }
    await dispatcher.redeliver(encodeAccountKey(other), other)
    expect(hook).not.toHaveBeenCalled()
  })

  it('calls nothing when the stored snapshot does not name the account of the key', async () => {
    // Scenario: a store that answers with another account's snapshot is not trusted.
    const hook = jest.fn()
    const { dispatcher } = await setup(hook, {
      store: (base) => ({
        ...bind(base),
        getSnapshot: async () => ({
          snapshot: snapshot('other', { accountId: 'someone-else' }),
          pendingChanges: CHANGES
        })
      })
    })
    await dispatcher.redeliver(KEY, ACCOUNT)
    expect(hook).not.toHaveBeenCalled()
  })

  it('logs the code and calls nothing when the store cannot be read', async () => {
    // Scenario: the read of the pending changes fails.
    const hook = jest.fn()
    const { dispatcher, lines } = await setup(hook, {
      store: (base) => ({
        ...bind(base),
        getSnapshot: () => Promise.reject(new Error('store down for sentinel-account'))
      })
    })
    await expect(dispatcher.redeliver(KEY, ACCOUNT)).resolves.toBeUndefined()
    expect(hook).not.toHaveBeenCalled()
    expect(lines).toStrictEqual([
      `The pending changes of an account could not be read for delivery (account ${hashAccountKey(KEY)}): unclassified.`
    ])
  })
})
