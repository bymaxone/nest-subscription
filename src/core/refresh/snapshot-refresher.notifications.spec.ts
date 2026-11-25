/**
 * @fileoverview Pins what the refresher does for the host's change hook and observer: the changes
 * are stored with the snapshot in one write, the hook is called only after that write resolved and
 * never when nothing was written, a refresh does not wait for it unless asked to, a failing hook
 * leaves the snapshot and its changes in place, and an observer hears of refreshes and source
 * errors at no cost when there is none.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import type { SubscriptionObserver } from '../observer/observer.types'
import type { SubscriptionChangeNotification } from '../options/subscription-options.types'
import { SnapshotRefresher } from './snapshot-refresher'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const T0 = '2026-01-01T00:00:00.000Z'
const T10 = '2026-01-01T00:00:10.000Z'
const T20 = '2026-01-01T00:00:20.000Z'

/** A snapshot of an account the source says is as of `sourceUpdatedAt`, with one marker. */
function snapshotOf(
  account: AccountReference,
  sourceUpdatedAt: string | null,
  marker = 'x'
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: T0
    }),
    sourceCustomer: { id: marker },
    sourceUpdatedAt
  }
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

/** A store, a source, a clock and the refresher over them. */
function setup(): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  refresher: SnapshotRefresher
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  return {
    source,
    store,
    clock,
    refresher: new SnapshotRefresher(
      source,
      store,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    )
  }
}

/** The store with some methods replaced; the others reach it unchanged. */
function delegating(
  base: SubscriptionStore,
  overrides: Partial<SubscriptionStore>
): SubscriptionStore {
  return {
    getSnapshot: (key) => base.getSnapshot(key),
    putSnapshot: (key, snapshot, changes, at) => base.putSnapshot(key, snapshot, changes, at),
    clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => base.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (source, id, at) => base.markEventProcessed(source, id, at),
    forgetEvent: (source, id) => base.forgetEvent(source, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor),
    ...overrides
  }
}

const RECORD: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: '2026-01-01T00:00:00.000Z',
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A snapshot with one subscription whose period ends at the given instant. */
function subscribed(
  sourceUpdatedAt: string,
  periodEnd = RECORD.currentPeriodEnd
): SubscriptionSnapshot {
  return {
    ...snapshotOf(ACCOUNT, sourceUpdatedAt),
    subscriptions: [{ ...RECORD, currentPeriodEnd: periodEnd }]
  }
}

/** A dispatcher over a hook and a store, whose log lines are collected. */
function dispatcherOver(
  hook: (notification: SubscriptionChangeNotification) => unknown,
  store: SubscriptionStore,
  clock: ManualClock,
  lines: string[] = []
): ChangeDispatcher {
  const logger = { warn: (message: string): void => void lines.push(message) }
  return new ChangeDispatcher(hook, store, logger, new ObserverBridge(null, clock))
}

/** A refresher with a change dispatcher over a hook, with the log lines it produces. */
function withHook(hook: (notification: SubscriptionChangeNotification) => unknown): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  refresher: SnapshotRefresher
  lines: string[]
} {
  const { source, store, clock } = setup()
  const lines: string[] = []
  const dispatcher = dispatcherOver(hook, store, clock, lines)
  const refresher = new SnapshotRefresher(
    source,
    store,
    clock,
    null,
    dispatcher,
    new ObserverBridge(null, clock)
  )
  return { source, store, clock, lines, refresher }
}

describe('SnapshotRefresher change notifications', () => {
  it('stores the changes with the snapshot in one write', async () => {
    // Scenario: the first refresh finds a subscription; the store receives the `started` change in
    // the same putSnapshot call as the snapshot, and nowhere else.
    const { source, store, clock, refresher } = withHook(jest.fn())
    const putSnapshot = jest.spyOn(store, 'putSnapshot')
    source.setAccount(ACCOUNT, subscribed(T10))
    clock.set(T20)
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    expect(putSnapshot).toHaveBeenCalledTimes(1)
    expect(putSnapshot.mock.calls[0]?.[2]).toStrictEqual(result.changes)
    expect(result.changes.map((change) => change.kind)).toStrictEqual(['started'])
  })

  it('calls the hook with the previous snapshot, the new one and the changes, then clears them', async () => {
    // Scenario: a renewal between two refreshes reaches the hook once and leaves nothing pending.
    const hook = jest.fn()
    const { source, store, clock, refresher } = withHook(hook)
    source.setAccount(ACCOUNT, subscribed(T10))
    await (
      await refresher.refresh(ACCOUNT)
    ).delivery
    hook.mockClear()
    clock.advance(1000)
    source.setAccount(ACCOUNT, subscribed(T20, '2026-03-01T00:00:00.000Z'))
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith({
      previous: result.previous,
      current: result.current,
      changes: result.changes,
      redelivery: false
    })
    expect(result.changes.map((change) => change.kind)).toStrictEqual(['renewed'])
    expect((await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.pendingChanges).toStrictEqual([])
  })

  it('does not call the hook until the store write has resolved', async () => {
    // Scenario: the write is held; the hook has not run, and it runs after the write is released.
    const hook = jest.fn()
    const { source, store, clock } = setup()
    let release: () => void = () => undefined
    const slow = delegating(store, {
      putSnapshot: async (key, snapshot, changes, at) => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return store.putSnapshot(key, snapshot, changes, at)
      }
    })
    const refresher = new SnapshotRefresher(
      source,
      slow,
      clock,
      null,
      dispatcherOver(hook, slow, clock),
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, subscribed(T10))
    const refreshing = refresher.refresh(ACCOUNT)
    await flush()
    expect(hook).not.toHaveBeenCalled()
    release()
    await (
      await refreshing
    ).delivery
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('does not call the hook when the store refuses the write', async () => {
    // Scenario: a newer snapshot is already stored, so the write returns false and no change exists.
    const hook = jest.fn()
    const { source, store, clock } = setup()
    const refusing = delegating(store, { putSnapshot: () => Promise.resolve(false) })
    const refresher = new SnapshotRefresher(
      source,
      refusing,
      clock,
      null,
      dispatcherOver(hook, refusing, clock),
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, subscribed(T10))
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    expect(result.written).toBe(false)
    expect(result.changes).toStrictEqual([])
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not call the hook when the stored snapshot is newer than the one read', async () => {
    // Scenario: the source answers with an older state than the store holds.
    const hook = jest.fn()
    const { source, refresher } = withHook(hook)
    source.setAccount(ACCOUNT, subscribed(T20))
    await (
      await refresher.refresh(ACCOUNT)
    ).delivery
    hook.mockClear()
    source.setAccount(ACCOUNT, subscribed(T10, '2026-03-01T00:00:00.000Z'))
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    expect(result.written).toBe(false)
    expect(hook).not.toHaveBeenCalled()
  })

  it('calls no hook for a refresh that changes nothing', async () => {
    // Scenario: the same state is read again later; only the fetch instant differs.
    const hook = jest.fn()
    const { source, store, clock, refresher } = withHook(hook)
    source.setAccount(ACCOUNT, subscribed(T10))
    await (
      await refresher.refresh(ACCOUNT)
    ).delivery
    hook.mockClear()
    clock.advance(60_000)
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    expect(result.changes).toStrictEqual([])
    expect(hook).not.toHaveBeenCalled()
    expect((await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.pendingChanges).toStrictEqual([])
  })

  it('resolves before a slow hook finishes, and delivery settles when it does', async () => {
    // Scenario: a webhook-style caller that does not wait for the host's reaction.
    let release: () => void = () => undefined
    const hook = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const { source, refresher } = withHook(hook)
    source.setAccount(ACCOUNT, subscribed(T10))
    const result = await refresher.refresh(ACCOUNT)
    let settled = false
    void result.delivery.then(() => {
      settled = true
    })
    await flush()
    expect(hook).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    release()
    await result.delivery
    expect(settled).toBe(true)
  })

  it('keeps the stored snapshot and the pending changes when the hook throws', async () => {
    // Scenario: the hook fails; the refresh still resolves with the snapshot written.
    const { source, store, refresher, lines } = withHook(() => {
      throw new Error('boom')
    })
    source.setAccount(ACCOUNT, subscribed(T10))
    const result = await refresher.refresh(ACCOUNT)
    await result.delivery
    const held = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(result.written).toBe(true)
    expect(held?.snapshot).toStrictEqual(result.current)
    expect(held?.pendingChanges).toStrictEqual(result.changes)
    expect(lines).toHaveLength(1)
  })

  it('stores no change when the host set no hook', async () => {
    // Scenario: no dispatcher; a subscription appears and the store receives an empty change list.
    const { source, store, clock } = setup()
    const putSnapshot = jest.spyOn(store, 'putSnapshot')
    source.setAccount(ACCOUNT, subscribed(T10))
    const result = await new SnapshotRefresher(
      source,
      store,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    ).refresh(ACCOUNT)
    await result.delivery
    expect(putSnapshot.mock.calls[0]?.[2]).toStrictEqual([])
    expect(result.changes).toStrictEqual([])
  })
})

/** A refresher whose observer is the one given, over a fresh source, store and clock. */
function observed(
  observer: SubscriptionObserver | null,
  hook: (notification: SubscriptionChangeNotification) => unknown = jest.fn()
): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  refresher: SnapshotRefresher
} {
  const { source, store, clock } = setup()
  const dispatcher = dispatcherOver(hook, store, clock)
  const bridge = new ObserverBridge(observer, clock)
  return {
    source,
    store,
    clock,
    refresher: new SnapshotRefresher(source, store, clock, null, dispatcher, bridge)
  }
}

describe('SnapshotRefresher observer', () => {
  it('reports a written refresh with its source, duration and change count', async () => {
    // Scenario: the read is held for 250 ms of the injected clock, then the snapshot is stored.
    const onRefresh = jest.fn()
    const { source, clock, refresher } = observed({ onRefresh })
    source.setAccount(ACCOUNT, subscribed(T10))
    const release = source.delayNextRead()
    const refreshing = refresher.refresh(ACCOUNT)
    await flush()
    clock.advance(250)
    release()
    await (
      await refreshing
    ).delivery
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledWith({
      outcome: 'written',
      source: 'fake',
      durationMs: 250,
      changeCount: 1
    })
  })

  it('reports a refresh whose snapshot a newer one superseded, with no changes', async () => {
    // Scenario: the stored snapshot is newer than the one the source returns.
    const onRefresh = jest.fn()
    const { source, refresher } = observed({ onRefresh })
    source.setAccount(ACCOUNT, subscribed(T20))
    await refresher.refresh(ACCOUNT)
    onRefresh.mockClear()
    source.setAccount(ACCOUNT, subscribed(T10))
    await refresher.refresh(ACCOUNT)
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'superseded', changeCount: 0 })
    )
  })

  it('reports one refresh for many concurrent callers', async () => {
    // Scenario: ten callers share one read, so the observer hears of one refresh.
    const onRefresh = jest.fn()
    const { source, refresher } = observed({ onRefresh })
    source.setAccount(ACCOUNT, subscribed(T10))
    await Promise.all(Array.from({ length: 10 }, () => refresher.refresh(ACCOUNT)))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('reports a failed read as a source error and not as a refresh', async () => {
    // Scenario: the source rejects after 40 ms of the injected clock.
    const onSourceError = jest.fn()
    const onRefresh = jest.fn()
    const { source, clock, refresher } = observed({ onSourceError, onRefresh })
    source.failNextRead(new Error('source down'))
    const release = source.delayNextRead()
    const refreshing = refresher.refresh(ACCOUNT)
    await flush()
    clock.advance(40)
    release()
    await expect(refreshing).rejects.toBeInstanceOf(SubscriptionError)
    expect(onSourceError).toHaveBeenCalledWith({ source: 'fake', durationMs: 40 })
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('reports a snapshot that does not fit the account as a source error', async () => {
    // Scenario: the source answers with another account's snapshot.
    const onSourceError = jest.fn()
    const { source, refresher } = observed({ onSourceError })
    source.setAccount(ACCOUNT, snapshotOf({ accountId: 'someone-else' }, T10))
    await expect(refresher.refresh(ACCOUNT)).rejects.toBeInstanceOf(SubscriptionError)
    expect(onSourceError).toHaveBeenCalledTimes(1)
  })

  describe.each([
    [
      'throws',
      (): never => {
        throw new Error('observer broke')
      }
    ],
    ['rejects', (): Promise<never> => Promise.reject(new Error('observer rejected'))]
  ])('when the observer %s', (_how, fail) => {
    const broken: SubscriptionObserver = { onRefresh: fail, onSourceError: fail }

    /** What one refresh leaves: its result, the stored state and what the hook was given. */
    async function leaves(observer: SubscriptionObserver | null): Promise<unknown> {
      const hook = jest.fn()
      const { source, store, refresher } = observed(observer, hook)
      source.setAccount(ACCOUNT, subscribed(T10))
      const result = await refresher.refresh(ACCOUNT)
      await result.delivery
      return {
        written: result.written,
        changes: result.changes,
        stored: await store.getSnapshot(encodeAccountKey(ACCOUNT)),
        delivered: hook.mock.calls
      }
    }

    it('leaves the result, the stored state and the delivery as they are with no observer', async () => {
      // Scenario: the same refresh with and without a broken observer; everything it leaves is equal.
      const without = await leaves(null)
      expect(await leaves(broken)).toStrictEqual(without)
      expect(without).toMatchObject({ written: true, delivered: [expect.anything()] })
    })

    it('rejects a failed read with the same error as with no observer', async () => {
      // Scenario: the source fails; the refresh rejects with the library's error either way.
      const reject = async (observer: SubscriptionObserver | null): Promise<unknown> => {
        const { source, refresher } = observed(observer)
        source.failNextRead(new Error('source down'))
        return refresher.refresh(ACCOUNT).catch((error: unknown) => error)
      }
      const without = await reject(null)
      const withBroken = await reject(broken)
      expect(without).toBeInstanceOf(SubscriptionError)
      expect(withBroken).toBeInstanceOf(SubscriptionError)
      expect(withBroken).toMatchObject({ code: (without as SubscriptionError).code })
    })
  })

  it('reads the clock no more often with no observer than the refresh itself needs', async () => {
    // Scenario: one refresh reads the clock once, for the fetch instant, when no observer is set;
    // with an observer that wants durations it reads it twice more.
    const reads = async (observer: SubscriptionObserver | null): Promise<number> => {
      const { source, clock, refresher } = observed(observer)
      const now = jest.spyOn(clock, 'now')
      source.setAccount(ACCOUNT, subscribed(T10))
      await refresher.refresh(ACCOUNT)
      return now.mock.calls.length
    }
    expect(await reads(null)).toBe(1)
    expect(await reads({ onRefresh: jest.fn() })).toBe(3)
  })
})

describe('SnapshotRefresher callers that share a flight', () => {
  it('makes one source read and one hook call for ten concurrent refreshes, with one delivery', async () => {
    // Scenario: ten refreshes of one account start while the read is held; they share one flight,
    // so the source is read once and the hook is called once, and each caller's delivery is the
    // same promise.
    const hook = jest.fn()
    const { source, refresher } = withHook(hook)
    source.setAccount(ACCOUNT, subscribed(T10))
    const release = source.delayNextRead()
    const callers = Array.from({ length: 10 }, () => refresher.refresh(ACCOUNT))
    await flush()
    release()
    const results = await Promise.all(callers)
    await results[0]?.delivery
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(hook).toHaveBeenCalledTimes(1)
    for (const result of results) expect(result.delivery).toBe(results[0]?.delivery)
  })

  it('starts the delivery after the flight of the account is released', async () => {
    // Scenario: the hook looks at how many flights are in progress when it is called.
    let inFlight = -1
    const hookRefresher: { current?: SnapshotRefresher } = {}
    const { source, refresher } = withHook(() => {
      inFlight = hookRefresher.current?.inFlight ?? -1
    })
    hookRefresher.current = refresher
    source.setAccount(ACCOUNT, subscribed(T10))
    await (
      await refresher.refresh(ACCOUNT)
    ).delivery
    expect(inFlight).toBe(0)
  })
})
