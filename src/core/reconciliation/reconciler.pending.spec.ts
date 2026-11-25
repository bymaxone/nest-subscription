/**
 * @fileoverview Pins how reconciliation delivers pending changes again: from the stored snapshot
 * and the stored keys with no previous snapshot, a page at a time up to the batch bound, with a
 * cursor of its own so an account whose hook keeps failing keeps no later account waiting, and
 * apart from the refresh of stale accounts.
 * @layer core
 */
import {
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionChange,
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
import { resolveOptions } from '../options/resolve-options'
import type { SubscriptionChangeNotification } from '../options/subscription-options.types'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { Reconciler } from './reconciler'

const T0 = '2026-01-01T00:00:00.000Z'
const DAY = 86_400_000
const SUBSCRIPTION: SubscriptionRecord = {
  subscriptionReference: 'sub-1',
  status: 'active',
  givesAccess: true,
  willRenew: 'yes',
  origin: 'app_store',
  environment: 'production',
  productReference: 'pro_monthly',
  billingInterval: 'P1M',
  currentPeriodStart: T0,
  currentPeriodEnd: '2026-02-01T00:00:00.000Z',
  accessUntil: '2026-02-01T00:00:00.000Z',
  billingIssueSince: null,
  cancelledAt: null,
  refundedAt: null,
  managementReference: null
}

/** A snapshot of an account fetched at the given instant. */
function fetchedAt(
  account: AccountReference,
  instant: string,
  sourceUpdatedAt: string | null = null
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: instant
    }),
    sourceUpdatedAt
  }
}

/** The account named `acc-<n>`, with its number padded so the keys sort as the numbers do. */
function account(n: number): AccountReference {
  return { accountId: `acc-${String(n).padStart(5, '0')}` }
}

/** A reconciler over a fresh source, store and clock. */
function setup(extra: { multiTenant?: boolean; maxSnapshotAgeMs?: number } = {}): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
  reconciler: Reconciler
  reads: number[]
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const options = resolveOptions({ source, store, clock, accountResolver: () => null, ...extra })
  const refresher = new SnapshotRefresher(
    source,
    store,
    clock,
    null,
    null,
    new ObserverBridge(null, clock)
  )
  const reads: number[] = []
  const original = source.readAccount.bind(source)
  jest.spyOn(source, 'readAccount').mockImplementation((reference) => {
    reads.push(clock.now().getTime())
    return original(reference)
  })
  return {
    source,
    store,
    clock,
    reconciler: new Reconciler(store, clock, refresher, options, null),
    reads
  }
}

/** Stores `count` accounts fetched at `instant`. */
async function seed(
  store: SubscriptionStore,
  count: number,
  instant = T0,
  from = 1
): Promise<void> {
  for (let n = from; n < from + count; n += 1) {
    const reference = account(n)
    await store.putSnapshot(encodeAccountKey(reference), fetchedAt(reference, instant), [], instant)
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
    markEventProcessed: (name, id, at) => base.markEventProcessed(name, id, at),
    forgetEvent: (name, id) => base.forgetEvent(name, id),
    deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor),
    ...overrides
  }
}

/** A wait that moves the manual clock by the time asked, as a host's timer would. */
function advancing(clock: ManualClock): (ms: number) => Promise<void> {
  return (ms) => {
    clock.advance(ms)
    return Promise.resolve()
  }
}

/** The two pending changes every seeded account is stored with. */
function pendingFor(n: number): SubscriptionChange[] {
  return [
    { kind: 'renewed', key: `renewed-${String(n)}` },
    { kind: 'refunded', key: `refunded-${String(n)}` }
  ]
}

/** A reconciler with a change dispatcher over `hook`, and the store, the clock and the log. */
function withHook(
  hook: (notification: SubscriptionChangeNotification) => unknown,
  extra: { multiTenant?: boolean } = {},
  wrap: (store: SubscriptionStore) => SubscriptionStore = (store) => store
): {
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  view: SubscriptionStore
  clock: ManualClock
  reconciler: Reconciler
  lines: string[]
} {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const view = wrap(store)
  const clock = new ManualClock(T0)
  const options = resolveOptions({
    source,
    store: view,
    clock,
    accountResolver: () => null,
    onChange: hook,
    ...extra
  })
  const lines: string[] = []
  const dispatcher = new ChangeDispatcher(
    hook,
    view,
    { warn: (message) => void lines.push(message) },
    new ObserverBridge(null, clock)
  )
  const refresher = new SnapshotRefresher(
    source,
    view,
    clock,
    null,
    dispatcher,
    new ObserverBridge(null, clock)
  )
  return {
    source,
    store,
    view,
    clock,
    lines,
    reconciler: new Reconciler(view, clock, refresher, options, dispatcher)
  }
}

/** Stores `count` accounts fetched now, each with two pending changes. */
async function seedPending(store: SubscriptionStore, count: number, from = 1): Promise<void> {
  for (let n = from; n < from + count; n += 1) {
    const reference = account(n)
    await store.putSnapshot(
      encodeAccountKey(reference),
      fetchedAt(reference, T0),
      pendingFor(n),
      T0
    )
  }
}

/** The number of accounts that still have a pending change. */
async function pendingAccounts(store: SubscriptionStore): Promise<number> {
  return (await store.listKeysWithPendingChanges(1000, null)).keys.length
}

describe('Reconciler pending changes', () => {
  it('delivers pending changes again with their stored keys, no previous snapshot, and clears them', async () => {
    // Scenario: a crash after the write left two changes pending for one account.
    const hook = jest.fn()
    const { store, reconciler } = withHook(hook)
    await seedPending(store, 1)
    await reconciler.run({})
    const stored = await store.getSnapshot(encodeAccountKey(account(1)))
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith({
      previous: null,
      current: fetchedAt(account(1), T0),
      changes: pendingFor(1),
      redelivery: true
    })
    expect(stored?.pendingChanges).toStrictEqual([])
  })

  it('clears only the accounts whose hook call returned', async () => {
    // Scenario: the hook fails for the second account; its changes stay pending and the first
    // account's are cleared.
    const hook = jest.fn((notification: SubscriptionChangeNotification) => {
      if (notification.changes[0]?.key === 'renewed-2') throw new Error('boom')
    })
    const { store, reconciler, lines } = withHook(hook)
    await seedPending(store, 3)
    await reconciler.run({})
    const left = (await store.listKeysWithPendingChanges(10, null)).keys
    expect(left).toStrictEqual([encodeAccountKey(account(2))])
    expect(lines).toHaveLength(1)
  })

  it('goes on to refresh stale accounts after a failing hook', async () => {
    // Scenario: a hook that fails does not stop the run's own refreshes.
    const { source, store, clock, reconciler } = withHook(() => {
      throw new Error('boom')
    })
    await seedPending(store, 1)
    await seed(store, 1, T0, 2)
    clock.advance(2 * DAY)
    const result = await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(result.refreshed).toBe(2)
    expect(source.readCount(account(2))).toBe(1)
  })

  it('delivers no more accounts than the batch bound', async () => {
    // Scenario: five accounts pending and a bound of two; the others wait for the next run.
    const hook = jest.fn()
    const { store, reconciler } = withHook(hook)
    await seedPending(store, 5)
    await reconciler.run({ batchSize: 2 })
    expect(hook).toHaveBeenCalledTimes(2)
    expect(await pendingAccounts(store)).toBe(3)
  })

  it('delivers in pages of at most a hundred accounts, up to the bound', async () => {
    // Scenario: 120 accounts pending and a bound of 150; the listing is asked for 100 then 50.
    const hook = jest.fn()
    let limits: number[] = []
    const { store, reconciler } = withHook(hook, {}, (base) =>
      delegating(base, {
        listKeysWithPendingChanges: (limit, cursor) => {
          limits = [...limits, limit]
          return base.listKeysWithPendingChanges(limit, cursor)
        }
      })
    )
    await seedPending(store, 120)
    await reconciler.run({ batchSize: 150 })
    expect(limits).toStrictEqual([100, 50])
    expect(hook).toHaveBeenCalledTimes(120)
    expect(await pendingAccounts(store)).toBe(0)
  })

  it('delivers the changes of an account it refreshes before it returns', async () => {
    // Scenario: a stale account whose source state gained a subscription; the hook has been called
    // by the time the run resolves, as a first delivery.
    const hook = jest.fn()
    const { source, store, clock, reconciler } = withHook(hook)
    await seed(store, 1)
    clock.advance(2 * DAY)
    source.setAccount(account(1), {
      ...fetchedAt(account(1), T0),
      subscriptions: [SUBSCRIPTION]
    })
    await reconciler.run({ olderThanMs: DAY, wait: advancing(clock) })
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0]?.[0]).toMatchObject({ redelivery: false })
  })

  it('skips a pending key it cannot use and delivers the others', async () => {
    // Scenario: the listing returns a key the encoder could not have written.
    const hook = jest.fn()
    const { store, reconciler } = withHook(hook, {}, (base) =>
      delegating(base, {
        listKeysWithPendingChanges: async (limit, cursor) => {
          const page = await base.listKeysWithPendingChanges(limit, cursor)
          return { ...page, keys: ['not-a-key', ...page.keys] }
        }
      })
    )
    await seedPending(store, 1)
    await reconciler.run({})
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('skips a pending account without a tenant when the host is multi-tenant', async () => {
    // Scenario: a stored key with no tenant in a multi-tenant host is not usable.
    const hook = jest.fn()
    const { store, reconciler } = withHook(hook, { multiTenant: true })
    await seedPending(store, 1)
    await reconciler.run({})
    expect(hook).not.toHaveBeenCalled()
  })

  it('rejects the run when the pending listing fails', async () => {
    // Scenario: the store cannot list pending changes.
    const failure = new Error('store down')
    const { reconciler } = withHook(jest.fn(), {}, (base) =>
      delegating(base, { listKeysWithPendingChanges: () => Promise.reject(failure) })
    )
    await expect(reconciler.run({})).rejects.toBe(failure)
  })

  it('does not list pending changes when the host set no hook', async () => {
    // Scenario: no dispatcher; the listing of pending changes is never asked.
    const { store, reconciler } = setup()
    const listing = jest.spyOn(store, 'listKeysWithPendingChanges')
    await reconciler.run({})
    expect(listing).not.toHaveBeenCalled()
  })
})

describe('Reconciler pending cursor', () => {
  /** The key of the first pending change of each call, in order. */
  const firstKeys = (hook: jest.Mock): unknown[] =>
    hook.mock.calls.map(([notification]) => notification.changes[0]?.key)

  it('goes on from the pending cursor, so an account whose hook keeps failing starves no other', async () => {
    // Scenario: a batch of one, two accounts pending, and a hook that always throws for the
    // first; the second run, given the pending cursor of the first, reaches the second account.
    const hook = jest.fn((notification: SubscriptionChangeNotification) => {
      if (notification.changes[0]?.key === 'renewed-1') throw new Error('boom')
    })
    const { store, reconciler } = withHook(hook)
    await seedPending(store, 2)
    const first = await reconciler.run({ batchSize: 1 })
    await reconciler.run({ batchSize: 1, pendingCursor: first.pendingCursor })
    expect(firstKeys(hook)).toStrictEqual(['renewed-1', 'renewed-2'])
  })

  it('returns a pending cursor while accounts are left, and null when the listing is exhausted', async () => {
    // Scenario: three accounts pending and a batch of two, then a batch large enough for the rest.
    const { store, reconciler } = withHook(() => {
      throw new Error('boom')
    })
    await seedPending(store, 3)
    const first = await reconciler.run({ batchSize: 2 })
    const second = await reconciler.run({ batchSize: 2, pendingCursor: first.pendingCursor })
    expect([first.pendingCursor === null, second.pendingCursor === null]).toStrictEqual([
      false,
      true
    ])
  })

  it('starts the pending pass from the first account when no pending cursor is given', async () => {
    // Scenario: a failing hook leaves the account pending, and a run with no cursor tries it again.
    const hook = jest.fn(() => {
      throw new Error('boom')
    })
    const { store, reconciler } = withHook(hook)
    await seedPending(store, 1)
    await reconciler.run({})
    await reconciler.run({})
    expect(hook).toHaveBeenCalledTimes(2)
  })

  it('keeps the pending cursor apart from the stale cursor', async () => {
    // Scenario: a run with a pending cursor and none for the stale pass still starts the stale pass
    // at the first stale account and returns its own cursor.
    const { source, store, clock, reconciler } = withHook(jest.fn())
    await seedPending(store, 2)
    clock.advance(2 * DAY)
    const result = await reconciler.run({
      olderThanMs: DAY,
      batchSize: 1,
      pendingCursor: encodeAccountKey(account(1)),
      maxCallsPerSecond: 100
    })
    expect(source.readCount(account(1))).toBe(1)
    expect(result.cursor).not.toBeNull()
  })

  it('returns no pending cursor when the host set no hook', async () => {
    // Scenario: with no dispatcher the pending pass does not run.
    const { reconciler } = setup()
    expect((await reconciler.run({})).pendingCursor).toBeNull()
  })
})
