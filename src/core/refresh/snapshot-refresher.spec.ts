/**
 * @fileoverview Pins the refresher: one source call for concurrent refreshes of one account, no
 * waiting between accounts, ordered writes under sequential and concurrent refreshes, and a source
 * failure that leaves the stored snapshot untouched. Time comes from a manual clock and every
 * ordering from promises the test settles by hand.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type StoredSnapshot,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionRecord,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { SnapshotCache } from '../cache/snapshot-cache'
import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { ObserverBridge } from '../observer/observer-bridge'
import type { SubscriptionObserver } from '../observer/observer.types'
import type {
  SubscriptionCache,
  SubscriptionChangeNotification
} from '../options/subscription-options.types'
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

/** The snapshot stored for an account, or `null`. */
async function stored(
  store: SubscriptionStore,
  account: AccountReference
): Promise<SubscriptionSnapshot | null> {
  return (await store.getSnapshot(encodeAccountKey(account)))?.snapshot ?? null
}

describe('SnapshotRefresher', () => {
  it('reads the source, stamps the fetch instant from the clock and stores the snapshot', async () => {
    // Scenario: a first refresh of an account with nothing stored.
    const { source, store, clock, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    clock.set(T20)
    const result = await refresher.refresh(ACCOUNT)
    expect(result.previous).toBeNull()
    expect(result.written).toBe(true)
    expect(result.current).toEqual({ ...snapshotOf(ACCOUNT, T10), fetchedAt: T20 })
    expect(await stored(store, ACCOUNT)).toEqual(result.current)
  })

  it('returns the previous snapshot beside the new one', async () => {
    // Scenario: a second refresh with a newer source state reports both.
    const { source, clock, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'first'))
    const first = await refresher.refresh(ACCOUNT)
    clock.advance(1000)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20, 'second'))
    const second = await refresher.refresh(ACCOUNT)
    expect(second.previous).toEqual(first.current)
    expect(second.current.sourceCustomer?.id).toBe('second')
    expect(second.written).toBe(true)
  })

  it('makes one source call for a hundred concurrent refreshes and gives every caller one result', async () => {
    // Scenario: a hundred refreshes of one account start while the first read is held.
    const { source, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const release = source.delayNextRead()
    const callers = Array.from({ length: 100 }, () => refresher.refresh(ACCOUNT))
    await flush()
    release()
    const results = await Promise.all(callers)
    expect(source.readCount(ACCOUNT)).toBe(1)
    for (const result of results) expect(result).toBe(results[0])
  })

  it('does not make a refresh of one account wait for the held refresh of another', async () => {
    // Scenario: the read of account A is held; the refresh of account B completes meanwhile.
    const { source, refresher } = setup()
    const other: AccountReference = { accountId: 'acc-2' }
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    source.setAccount(other, snapshotOf(other, T10))
    const release = source.delayNextRead()
    const held = refresher.refresh(ACCOUNT)
    await flush()
    await expect(refresher.refresh(other)).resolves.toMatchObject({ written: true })
    expect(source.readCount(other)).toBe(1)
    release()
    await expect(held).resolves.toMatchObject({ written: true })
  })

  it('does not make one account identifier wait for the same identifier under another tenant', async () => {
    // Scenario: acc-1 of tenant one is held; acc-1 of tenant two completes and stays apart.
    const { source, store, refresher } = setup()
    const one: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
    const two: AccountReference = { tenantId: 'two', accountId: 'acc-1' }
    source.setAccount(one, snapshotOf(one, T10, 'one'))
    source.setAccount(two, snapshotOf(two, T10, 'two'))
    const release = source.delayNextRead()
    const held = refresher.refresh(one)
    await flush()
    await refresher.refresh(two)
    release()
    await held
    expect(source.readCount(one)).toBe(1)
    expect(source.readCount(two)).toBe(1)
    expect((await stored(store, one))?.sourceCustomer?.id).toBe('one')
    expect((await stored(store, two))?.sourceCustomer?.id).toBe('two')
  })

  it('keeps apart two accounts whose identifiers join into one string with a delimiter', async () => {
    // Scenario: ("a:b", "c") and ("a", "b:c") are refreshed together; each has its own read.
    const { source, store, refresher } = setup()
    const first: AccountReference = { tenantId: 'a:b', accountId: 'c' }
    const second: AccountReference = { tenantId: 'a', accountId: 'b:c' }
    source.setAccount(first, snapshotOf(first, T10, 'first'))
    source.setAccount(second, snapshotOf(second, T10, 'second'))
    await Promise.all([refresher.refresh(first), refresher.refresh(second)])
    expect(source.readCount(first)).toBe(1)
    expect(source.readCount(second)).toBe(1)
    expect((await stored(store, first))?.sourceCustomer?.id).toBe('first')
    expect((await stored(store, second))?.sourceCustomer?.id).toBe('second')
  })

  it('does not attempt a write for a snapshot the source reports as older than the stored one', async () => {
    // Scenario: the source goes back in time; the refresher answers with the stored snapshot and
    // never calls the store's write, whatever the store would have answered.
    const { source, store, clock } = setup()
    const putSnapshot = jest.fn(store.putSnapshot.bind(store))
    const counting = delegating(store, { putSnapshot })
    const refresher = new SnapshotRefresher(
      source,
      counting,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20, 'newer'))
    const first = await refresher.refresh(ACCOUNT)
    clock.advance(1000)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'older'))
    const second = await refresher.refresh(ACCOUNT)
    expect(putSnapshot).toHaveBeenCalledTimes(1)
    expect(second.written).toBe(false)
    expect(second.previous).toEqual(first.current)
    expect(second.current).toEqual(first.current)
    expect(await stored(store, ACCOUNT)).toEqual(first.current)
  })

  it('writes a snapshot the source reports as of the same instant as the stored one', async () => {
    // Scenario: an identical source state replaces the stored snapshot and moves its fetch instant.
    const { source, store, clock, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await refresher.refresh(ACCOUNT)
    clock.set(T20)
    const again = await refresher.refresh(ACCOUNT)
    expect(again.written).toBe(true)
    expect((await stored(store, ACCOUNT))?.fetchedAt).toBe(T20)
  })

  it('orders by the fetch instant when the source reports no update instant', async () => {
    // Scenario: with no source instant, a later refresh is newer and is written.
    const { source, clock, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, null, 'first'))
    await refresher.refresh(ACCOUNT)
    clock.advance(5000)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, null, 'second'))
    const second = await refresher.refresh(ACCOUNT)
    expect(second.written).toBe(true)
    expect(second.current.sourceCustomer?.id).toBe('second')
  })

  it('keeps the newer snapshot when two reads of one account resolve in the opposite order to their start', async () => {
    // Scenario: two refreshers share a store, as two processes would. The first read starts, is
    // held and returns older data; the second starts later, finishes first with newer data.
    const { source, store, clock } = setup()
    const slow = new SnapshotRefresher(
      source,
      store,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    )
    const fast = new SnapshotRefresher(
      source,
      store,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'older'))
    const release = source.delayNextRead()
    const slowRefresh = slow.refresh(ACCOUNT)
    await flush()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20, 'newer'))
    await expect(fast.refresh(ACCOUNT)).resolves.toMatchObject({ written: true })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'older'))
    release()
    const late = await slowRefresh
    expect(late.written).toBe(false)
    expect(late.current.sourceCustomer?.id).toBe('newer')
    expect((await stored(store, ACCOUNT))?.sourceCustomer?.id).toBe('newer')
  })

  it('keeps the read that started later when the source reports no update instant', async () => {
    // Scenario: as above for a source with no instant of its own. The first read starts, is held,
    // and finishes last; ordered by the instant a read started, it is the older one.
    const { source, store, clock } = setup()
    const build = (): SnapshotRefresher =>
      new SnapshotRefresher(source, store, clock, null, null, new ObserverBridge(null, clock))
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, null, 'older'))
    const release = source.delayNextRead()
    const slowRefresh = build().refresh(ACCOUNT)
    await flush()
    clock.set(T10)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, null, 'newer'))
    await expect(build().refresh(ACCOUNT)).resolves.toMatchObject({ written: true })
    clock.set(T20)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, null, 'older'))
    release()
    await expect(slowRefresh).resolves.toMatchObject({ written: false })
    expect(await stored(store, ACCOUNT)).toMatchObject({
      sourceCustomer: { id: 'newer' },
      fetchedAt: T10
    })
  })

  it('reports the stored snapshot as current when the store refuses the write of a racing refresh', async () => {
    // Scenario: the pre-write read finds nothing, but another writer wins before the write; the
    // store refuses and the refresher answers with what the store now holds.
    const { source, store, clock } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'older'))
    const winner = snapshotOf(ACCOUNT, T20, 'winner')
    const racing = delegating(store, {
      putSnapshot: async (key, snapshot, changes, at) => {
        await store.putSnapshot(key, winner, [], T20)
        return store.putSnapshot(key, snapshot, changes, at)
      }
    })
    const result = await new SnapshotRefresher(
      source,
      racing,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    ).refresh(ACCOUNT)
    expect(result.written).toBe(false)
    expect(result.previous).toBeNull()
    expect(result.current.sourceCustomer?.id).toBe('winner')
  })

  it('answers with the fetched snapshot when a refusing store holds nothing to read back', async () => {
    // Scenario: a store that refuses every write and holds nothing; the refresher does not throw
    // and reports that nothing was written.
    const { source, store, clock } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'fetched'))
    const refusing = delegating(store, {
      getSnapshot: (): Promise<StoredSnapshot | null> => Promise.resolve(null),
      putSnapshot: () => Promise.resolve(false)
    })
    const result = await new SnapshotRefresher(
      source,
      refusing,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    ).refresh(ACCOUNT)
    expect(result.written).toBe(false)
    expect(result.current.sourceCustomer?.id).toBe('fetched')
  })

  it('rejects every waiting caller with the source-unavailable code and keeps the stored snapshot', async () => {
    // Scenario: the read fails while five callers wait; the cause is kept and no identifier is
    // in the message.
    const { source, store, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10, 'kept'))
    await refresher.refresh(ACCOUNT)
    const before = await stored(store, ACCOUNT)
    const cause = new Error('upstream 503 for acc-1')
    source.failNextRead(cause)
    const release = source.delayNextRead()
    const callers = Array.from({ length: 5 }, () => refresher.refresh(ACCOUNT).catch((e) => e))
    await flush()
    release()
    for (const error of await Promise.all(callers)) {
      expect(error).toBeInstanceOf(SubscriptionError)
      expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
      expect(error.cause).toBe(cause)
      expect(error.message).not.toContain('acc-1')
    }
    expect(await stored(store, ACCOUNT)).toEqual(before)
  })

  it('wraps a source rejection that is not an Error and keeps it as the cause', async () => {
    // Scenario: the source rejects with a string.
    const { source, refresher } = setup()
    source.failNextRead('plain text')
    const error = await refresher.refresh(ACCOUNT).catch((e) => e)
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    expect(error.cause).toBe('plain text')
  })

  it('calls the source again on the next refresh after a failed one', async () => {
    // Scenario: one failure, then a success; the failed flight is not replayed.
    const { source, refresher } = setup()
    source.failNextRead(new Error('down'))
    await expect(refresher.refresh(ACCOUNT)).rejects.toBeInstanceOf(SubscriptionError)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await expect(refresher.refresh(ACCOUNT)).resolves.toMatchObject({ written: true })
    expect(source.readCount(ACCOUNT)).toBe(2)
  })

  it('holds no flight after a success and none after a failure', async () => {
    // Scenario: the in-flight count is read during a held refresh, after it, and after a failure.
    const { source, refresher } = setup()
    expect(refresher.inFlight).toBe(0)
    const release = source.delayNextRead()
    const held = refresher.refresh(ACCOUNT)
    await flush()
    expect(refresher.inFlight).toBe(1)
    release()
    await held
    expect(refresher.inFlight).toBe(0)
    source.failNextRead(new Error('down'))
    await refresher.refresh(ACCOUNT).catch(() => undefined)
    expect(refresher.inFlight).toBe(0)
  })

  it('does not call the source for an account identifier that is blank', async () => {
    // Scenario: a blank identifier is refused as invalid input before any read.
    const { source, refresher } = setup()
    const error = await refresher.refresh({ accountId: '  ' }).catch((e) => e)
    expect(error.code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    expect(source.totalReads).toBe(0)
  })

  it('lets a store failure through as it is, not as a source failure', async () => {
    // Scenario: the store cannot be read; the refresh rejects with the store's own error.
    const { source, store, clock } = setup()
    const failure = new Error('store down')
    const broken = delegating(store, { getSnapshot: () => Promise.reject(failure) })
    await expect(
      new SnapshotRefresher(
        source,
        broken,
        clock,
        null,
        null,
        new ObserverBridge(null, clock)
      ).refresh(ACCOUNT)
    ).rejects.toBe(failure)
  })
})

/** A host cache whose delete can be held. */
function hostCache(held?: Promise<void>): SubscriptionCache & { readonly deleted: string[] } {
  const deleted: string[] = []
  return {
    deleted,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: async (key) => {
      await held
      deleted.push(key)
    }
  }
}

describe('SnapshotRefresher with a cache', () => {
  it('invalidates the account after a write and before the caller is answered', async () => {
    // Scenario: the cache's delete is held; the refresh is still pending until it is released.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const cache = hostCache(held)
    const { source, store, clock } = setup()
    const refresher = new SnapshotRefresher(
      source,
      store,
      clock,
      new SnapshotCache(cache, 30_000, clock, new ObserverBridge(null, clock)),
      null,
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    let settled = false
    const refreshing = refresher.refresh(ACCOUNT).then((result) => {
      settled = true
      return result
    })
    await flush()
    expect(settled).toBe(false)
    release()
    await refreshing
    expect(cache.deleted).toEqual([`subscription:snapshot:${encodeAccountKey(ACCOUNT)}`])
  })

  it('does not invalidate when the source reports an older state and nothing is written', async () => {
    // Scenario: a newer state is stored; the older one is refused before the write.
    const cache = hostCache()
    const { source, store, clock } = setup()
    const refresher = new SnapshotRefresher(
      source,
      store,
      clock,
      new SnapshotCache(cache, 30_000, clock, new ObserverBridge(null, clock)),
      null,
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20))
    await refresher.refresh(ACCOUNT)
    cache.deleted.length = 0
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await refresher.refresh(ACCOUNT)
    expect(cache.deleted).toEqual([])
  })

  it('does not fail the refresh when the cache cannot delete', async () => {
    // Scenario: the host cache rejects the delete; the write stands and the refresh succeeds.
    const cache: SubscriptionCache = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.reject(new Error('cache down'))
    }
    const { source, store, clock } = setup()
    const refresher = new SnapshotRefresher(
      source,
      store,
      clock,
      new SnapshotCache(cache, 30_000, clock, new ObserverBridge(null, clock)),
      null,
      new ObserverBridge(null, clock)
    )
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await expect(refresher.refresh(ACCOUNT)).resolves.toMatchObject({ written: true })
  })
})

describe('SnapshotRefresher with a snapshot that does not fit the account asked for', () => {
  const TENANTED: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
  const subscription = {
    subscriptionReference: 's',
    status: 'active',
    givesAccess: true,
    willRenew: 'yes',
    origin: 'web',
    environment: 'production',
    productReference: 'p',
    billingInterval: 'month',
    currentPeriodStart: T0,
    currentPeriodEnd: T10,
    accessUntil: null,
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt: null,
    managementReference: null
  } as const
  const rows: ReadonlyArray<readonly [string, AccountReference, Record<string, unknown>]> = [
    ['another account', ACCOUNT, { accountId: 'other' }],
    ['another tenant', TENANTED, { tenantId: 'two' }],
    ['no tenant for a tenanted account', TENANTED, { tenantId: undefined }],
    ['a tenant for an account with none', ACCOUNT, { tenantId: 'one' }],
    [
      'an entitlement whose until cannot be read',
      ACCOUNT,
      {
        entitlements: [
          {
            name: 'pro',
            active: true,
            until: 'not-a-date',
            grantingSubscriptionReference: null,
            grantingSubscriptionReferences: []
          }
        ]
      }
    ],
    ['a source instant that cannot be read', ACCOUNT, { sourceUpdatedAt: 'later' }],
    ['a fetch instant that cannot be read', ACCOUNT, { fetchedAt: 'now' }],
    [
      'a subscription instant that cannot be read',
      ACCOUNT,
      { subscriptions: [{ ...subscription, billingIssueSince: '31 Feb' }] }
    ],
    ['a list that is not a list', ACCOUNT, { entitlements: 'none' }],
    [
      'an access flag that is not a boolean',
      ACCOUNT,
      {
        entitlements: [
          {
            name: 'pro',
            active: 'false',
            until: null,
            grantingSubscriptionReference: null,
            grantingSubscriptionReferences: []
          }
        ]
      }
    ]
  ]

  it.each(rows)(
    'refuses %s as a source failure, stores nothing and leaves the stored snapshot',
    async (_name, account, patch) => {
      // Scenario: a good refresh stores a snapshot; the source then returns a damaged one.
      const { source, store, clock, refresher } = setup()
      source.setAccount(account, snapshotOf(account, T10, 'good'))
      await refresher.refresh(account)
      const before = await stored(store, account)
      clock.advance(1000)
      source.setAccount(account, Object.assign({}, snapshotOf(account, T20, 'bad'), patch))
      const error = await refresher.refresh(account).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SubscriptionError)
      expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
      expect((error as SubscriptionError).message).not.toContain('acc-1')
      expect(await stored(store, account)).toEqual(before)
    }
  )

  it('refuses a snapshot whose fields cannot be read as a source failure, with nothing stored', async () => {
    // Scenario: the source returns an object whose entitlements getter throws.
    const { source, store, refresher } = setup()
    const unreadable = Object.defineProperty({ ...snapshotOf(ACCOUNT, T10) }, 'entitlements', {
      enumerable: true,
      get: () => {
        throw new Error('getter broke')
      }
    })
    source.setAccount(ACCOUNT, unreadable)
    await expect(refresher.refresh(ACCOUNT)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(await stored(store, ACCOUNT)).toBeNull()
  })

  it('stores nothing at all for the first refresh when the snapshot is refused', async () => {
    // Scenario: nothing stored yet; the source names another account.
    const { source, store, refresher } = setup()
    source.setAccount(ACCOUNT, { ...snapshotOf(ACCOUNT, T10), accountId: 'other' })
    await expect(refresher.refresh(ACCOUNT)).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(await stored(store, ACCOUNT)).toBeNull()
    expect(await stored(store, { accountId: 'other' })).toBeNull()
  })

  it('serves reads from the cache again after a good refresh follows a refused one', async () => {
    // Scenario: with a cache, a refused snapshot leaves no entry; the next good refresh and read fill it.
    const entries = new Map<string, string>()
    const cache: SubscriptionCache = {
      get: (key) => Promise.resolve(entries.get(key) ?? null),
      set: (key, value) => {
        entries.set(key, value)
        return Promise.resolve()
      },
      delete: (key) => {
        entries.delete(key)
        return Promise.resolve()
      }
    }
    const { source, store, clock } = setup()
    const snapshotCache = new SnapshotCache(cache, 30_000, clock, new ObserverBridge(null, clock))
    const refresher = new SnapshotRefresher(
      source,
      store,
      clock,
      snapshotCache,
      null,
      new ObserverBridge(null, clock)
    )
    const load = async (): Promise<SubscriptionSnapshot | null> => stored(store, TENANTED)
    source.setAccount(TENANTED, { ...snapshotOf(TENANTED, T10), tenantId: 'two' })
    await refresher.refresh(TENANTED).catch(() => undefined)
    expect(await snapshotCache.read(TENANTED, load)).toBeNull()
    source.setAccount(TENANTED, snapshotOf(TENANTED, T20, 'good'))
    await refresher.refresh(TENANTED)
    const loader = jest.fn(load)
    await snapshotCache.read(TENANTED, loader)
    await snapshotCache.read(TENANTED, loader)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(entries.size).toBe(1)
  })
})

describe('SnapshotRefresher with a stored snapshot that cannot be read', () => {
  it('refreshes over it, reporting no previous snapshot', async () => {
    // Scenario: the store returns a snapshot with an unreadable instant; a refresh must still work.
    const { source, store, clock } = setup()
    const corrupt = { ...snapshotOf(ACCOUNT, T10, 'corrupt'), fetchedAt: 'invalid' }
    const reading = delegating(store, {
      getSnapshot: () => Promise.resolve({ snapshot: corrupt, pendingChanges: [] })
    })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20, 'good'))
    const result = await new SnapshotRefresher(
      source,
      reading,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    ).refresh(ACCOUNT)
    expect(result.previous).toBeNull()
    expect(result.written).toBe(true)
    expect(result.current.sourceCustomer?.id).toBe('good')
  })

  /**
   * A refresher over a store where another process writes `meanwhile` right after the first read,
   * so the state the refresh compared against is gone by the time it writes.
   */
  function overtaken(
    meanwhile: SubscriptionSnapshot,
    overrides: Partial<SubscriptionStore> = {}
  ): { store: InMemorySubscriptionStore; refresher: SnapshotRefresher; seed: () => Promise<void> } {
    const { source, store, clock } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20, 'read'))
    clock.set(T20)
    const key = encodeAccountKey(ACCOUNT)
    let reads = 0
    const racing = delegating(store, {
      getSnapshot: async (asked) => {
        const held = await store.getSnapshot(asked)
        reads += 1
        if (reads === 1) await store.putSnapshot(key, meanwhile, [], T10)
        return held
      },
      replaceSnapshot: (...write) => store.replaceSnapshot(...write),
      ...overrides
    })
    const refresher = new SnapshotRefresher(
      source,
      racing,
      clock,
      null,
      null,
      new ObserverBridge(null, clock)
    )
    const seed = async (): Promise<void> => {
      await store.putSnapshot(key, snapshotOf(ACCOUNT, T0, 'seed'), [], T0)
    }
    return { store, refresher, seed }
  }

  const MEANWHILE = { ...snapshotOf(ACCOUNT, T10, 'meanwhile'), fetchedAt: T10 }

  it.each([['a snapshot was stored'], ['nothing was stored']])(
    'compares again with what another process wrote when %s before the read',
    async (before) => {
      // Scenario: a conditional write is refused because the stored state moved, so the refresh
      // reports and compares with the state its write really replaced.
      const { store, refresher, seed } = overtaken(MEANWHILE)
      if (before === 'a snapshot was stored') await seed()
      const result = await refresher.refresh(ACCOUNT)
      expect(result.written).toBe(true)
      expect(result.previous).toEqual(MEANWHILE)
      expect(await stored(store, ACCOUNT)).toEqual(result.current)
    }
  )

  it('keeps the newer snapshot another process wrote before the write', async () => {
    // Scenario: what arrived meanwhile is newer than the read, so nothing is written over it.
    const newer = { ...snapshotOf(ACCOUNT, '2026-01-01T00:00:30.000Z', 'newer'), fetchedAt: T10 }
    const { store, refresher, seed } = overtaken(newer)
    await seed()
    await store.putSnapshot(encodeAccountKey(ACCOUNT), newer, [], '2026-01-01T00:00:30.000Z')
    const result = await refresher.refresh(ACCOUNT)
    expect(result.written).toBe(false)
    expect(result.current).toEqual(newer)
  })

  it('writes nothing after every conditional attempt was refused', async () => {
    // Scenario: the stored state keeps moving; writing without the condition could lose a change.
    const replaceSnapshot = jest.fn(() => Promise.resolve(false))
    const { store, refresher } = overtaken(MEANWHILE, { replaceSnapshot })
    const refused = await refresher.refresh(ACCOUNT).catch((error: unknown) => error)
    expect(refused).toMatchObject({
      code: 'SUBSCRIPTION_SOURCE_UNAVAILABLE',
      cause: { message: expect.stringContaining('20 conditional writes were refused') }
    })
    expect(replaceSnapshot).toHaveBeenCalledTimes(20)
    expect(await stored(store, ACCOUNT)).toEqual(MEANWHILE)
  })

  it('writes without the condition over a stored snapshot that is not of the account', async () => {
    // Scenario: what is stored is treated as absent, and no condition could name it.
    const { source, store, clock, refresher } = setup()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T20))
    clock.set(T20)
    await store.putSnapshot(
      encodeAccountKey(ACCOUNT),
      snapshotOf({ accountId: 'other' }, T10),
      [],
      T10
    )
    const replace = jest.spyOn(store, 'replaceSnapshot')
    const result = await refresher.refresh(ACCOUNT)
    expect(replace).not.toHaveBeenCalled()
    expect(result.written).toBe(true)
    expect(await stored(store, ACCOUNT)).toEqual(result.current)
  })
})
