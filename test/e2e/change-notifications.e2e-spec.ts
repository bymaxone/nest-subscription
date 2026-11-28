/**
 * @fileoverview Change notifications, end to end: a real application with the in-memory store, the
 * fake source and a manual clock. A stored change reaches the host's hook after the write, a hook
 * that fails leaves the snapshot and its pending changes in place, a reconciliation run delivers
 * what is still pending with the same keys and no previous snapshot, and nothing reaches the hook
 * before the write resolved.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionError,
  SubscriptionModule,
  SubscriptionService,
  encodeAccountKey,
  hashAccountKey,
  type SubscriptionChangeNotification,
  type SubscriptionObserver,
  type StoredSnapshot,
  type SubscriptionStore
} from '@bymax-one/nest-subscription'
import type { SubscriptionRecord, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { createEmptySnapshot, resolveEntitlements } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:01:00.000Z'
const ACCOUNT = { accountId: 'sentinel-acc-1' }
const KEY = encodeAccountKey(ACCOUNT)

const RECORD: SubscriptionRecord = {
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

/** The source state of the account with one subscription whose period ends at `periodEnd`. */
function sourceState(periodEnd: string, sourceUpdatedAt: string): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ ...ACCOUNT, source: 'fake', fetchedAt: T0 }),
    subscriptions: [{ ...RECORD, currentPeriodEnd: periodEnd }],
    sourceUpdatedAt
  }
}

/** The source state of the account with these subscriptions, each granting `premium`. */
function stateOf(records: readonly SubscriptionRecord[]): SubscriptionSnapshot {
  const grants = new Map(records.map((r) => [r.subscriptionReference, ['premium']]))
  return {
    ...createEmptySnapshot({ ...ACCOUNT, source: 'fake', fetchedAt: T0 }),
    subscriptions: records,
    entitlements: resolveEntitlements(records, grants).entitlements
  }
}

/** What the host's hook does with a call. */
type Behaviour = (notification: SubscriptionChangeNotification) => unknown

/** What an application under test gives back. */
interface Harness {
  readonly app: TestingModule
  readonly service: SubscriptionService
  readonly source: FakeSubscriptionSource
  readonly store: InMemorySubscriptionStore
  readonly clock: ManualClock
  /** Every call the hook received, in order. */
  readonly notifications: SubscriptionChangeNotification[]
  /** Every line the library logged. */
  readonly lines: string[]
  /** Replaces what the hook does from now on. */
  readonly setBehaviour: (behaviour: Behaviour) => void
}

/** Boots an application whose hook records its calls and then does what the test says. */
async function boot(
  options: {
    wrap?: (base: InMemorySubscriptionStore) => SubscriptionStore
    observer?: SubscriptionObserver
  } = {}
): Promise<Harness> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock(T0)
  const notifications: SubscriptionChangeNotification[] = []
  const lines: string[] = []
  let behaviour: Behaviour = () => undefined
  const app = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store: options.wrap?.(store) ?? store,
        clock,
        accountResolver: () => null,
        logger: { warn: (message) => void lines.push(message) },
        ...(options.observer === undefined ? {} : { observer: options.observer }),
        onChange: (notification) => {
          notifications.push(notification)
          return behaviour(notification)
        }
      })
    ]
  }).compile()
  return {
    app,
    service: app.get(SubscriptionService),
    source,
    store,
    clock,
    notifications,
    lines,
    setBehaviour: (next) => {
      behaviour = next
    }
  }
}

/** The keys of the changes still pending for the account. */
async function pendingKeys(store: SubscriptionStore): Promise<string[]> {
  return ((await store.getSnapshot(KEY))?.pendingChanges ?? []).map((change) => change.key)
}

describe('change notifications', () => {
  it('calls the hook with the previous snapshot, the new one and the changes, and clears them', async () => {
    // Scenario: a first refresh finds a subscription, a second one a renewal.
    const { service, source, store, clock, notifications } = await boot()
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    clock.advance(60_000)
    source.setAccount(ACCOUNT, sourceState('2026-03-01T00:00:00.000Z', T1))
    await service.refresh(ACCOUNT)
    expect(
      notifications.map((n) => ({
        kinds: n.changes.map((change) => change.kind),
        previous: n.previous?.subscriptions[0]?.currentPeriodEnd ?? null,
        current: n.current.subscriptions[0]?.currentPeriodEnd,
        redelivery: n.redelivery
      }))
    ).toStrictEqual([
      {
        kinds: ['started'],
        previous: null,
        current: '2026-02-01T00:00:00.000Z',
        redelivery: false
      },
      {
        kinds: ['renewed'],
        previous: '2026-02-01T00:00:00.000Z',
        current: '2026-03-01T00:00:00.000Z',
        redelivery: false
      }
    ])
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('calls the hook once when access returns through a new subscription', async () => {
    // Scenario: the subscription expires, then another one appears beside the expired record.
    const { service, source, clock, notifications } = await boot()
    const expired: SubscriptionRecord = { ...RECORD, status: 'expired', givesAccess: false }
    const next: SubscriptionRecord = { ...RECORD, subscriptionReference: 'sub-2' }
    for (const records of [[RECORD], [expired], [expired, next]]) {
      source.setAccount(ACCOUNT, stateOf(records))
      await service.refresh(ACCOUNT)
      clock.advance(60_000)
    }
    expect(notifications.map((n) => n.changes.map((change) => change.kind))).toStrictEqual([
      ['started'],
      ['expired'],
      ['started']
    ])
  })

  it('calls no hook for a refresh that changes nothing', async () => {
    // Scenario: the same source state is read twice.
    const { service, source, clock, notifications } = await boot()
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    clock.advance(60_000)
    await service.refresh(ACCOUNT)
    expect(notifications).toHaveLength(1)
  })

  it('leaves the stored snapshot and its pending changes when the hook throws, and reports it', async () => {
    // Scenario: the hook throws on the first delivery; the refresh still succeeds, the failure is
    // logged by its code and told to the observer.
    const onChangeDelivery = jest.fn()
    const { service, source, store, lines, setBehaviour } = await boot({
      observer: { onChangeDelivery }
    })
    setBehaviour(() => {
      throw new Error('hook broke for sentinel-acc-1')
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await expect(service.refresh(ACCOUNT)).resolves.toMatchObject({ accountId: 'sentinel-acc-1' })
    const held = await store.getSnapshot(KEY)
    expect(held?.snapshot.subscriptions).toHaveLength(1)
    expect(held?.pendingChanges.map((change) => change.kind)).toStrictEqual(['started'])
    expect(lines).toStrictEqual([
      `The change hook failed; its changes stay pending and are delivered again (account ${hashAccountKey(KEY)}): unclassified.`
    ])
    expect(onChangeDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed', redelivery: false, changeCount: 1 })
    )
  })

  it('delivers the same change keys again from reconciliation after a failed call', async () => {
    // Scenario: the first delivery fails (as a crash between the write and the hook would leave
    // it); a later reconciliation run calls the hook with the same keys, marked as a redelivery
    // and with no previous snapshot, and clears them.
    const { service, source, store, notifications, setBehaviour } = await boot()
    setBehaviour(() => Promise.reject(new Error('down')))
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    setBehaviour(() => undefined)
    await service.reconcile({})
    const [first, again] = notifications
    expect(notifications).toHaveLength(2)
    expect(again?.redelivery).toBe(true)
    expect(again?.previous).toBeNull()
    expect(again?.changes).toStrictEqual(first?.changes)
    expect(again?.changes.map((change) => change.kind)).toStrictEqual(['started'])
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('delivers a stored change that no hook call ever followed', async () => {
    // Scenario: the snapshot and its change were stored and the process ended before the hook was
    // called, so only the pending mark remains; the next reconciliation run delivers it.
    const { service, source, store, notifications, setBehaviour } = await boot()
    setBehaviour(() => undefined)
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    const kept = sourceState('2026-02-01T00:00:00.000Z', T0)
    await store.putSnapshot(KEY, kept, [{ kind: 'started', key: 'stored-before-the-crash' }], T0)
    await service.reconcile({})
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.changes).toStrictEqual([
      { kind: 'started', key: 'stored-before-the-crash' }
    ])
    expect(notifications[0]?.redelivery).toBe(true)
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('keeps pending the changes whose hook call fails during reconciliation', async () => {
    // Scenario: the redelivery fails too; nothing is cleared and the next run tries again.
    const { service, source, store, setBehaviour } = await boot()
    setBehaviour(() => {
      throw new Error('still down')
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    const before = await pendingKeys(store)
    await service.reconcile({})
    expect(before).toHaveLength(1)
    expect(await pendingKeys(store)).toStrictEqual(before)
  })

  it('never calls the hook before the store write has resolved', async () => {
    // Scenario: the write is held. While it is in flight the hook has not been called and nothing
    // is stored; the hook is called only after the write resolved.
    let release: () => void = () => undefined
    const { service, source, store, notifications } = await boot({
      wrap: (base) => ({
        getSnapshot: (key) => base.getSnapshot(key),
        putSnapshot: async (key, snapshot, changes, at) => {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          return base.putSnapshot(key, snapshot, changes, at)
        },
        clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
        listKeysWithPendingChanges: (limit, cursor) =>
          base.listKeysWithPendingChanges(limit, cursor),
        markEventProcessed: (name, id, at) => base.markEventProcessed(name, id, at),
        forgetEvent: (name, id) => base.forgetEvent(name, id),
        deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
        listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor)
      })
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    const refreshing = service.refresh(ACCOUNT)
    await new Promise((resolve) => setImmediate(resolve))
    expect(notifications).toHaveLength(0)
    expect(await store.getSnapshot(KEY)).toBeNull()
    release()
    await refreshing
    expect(notifications).toHaveLength(1)
  })

  it('does not call the hook when the store write fails', async () => {
    // Scenario: the store rejects the write; the refresh fails and the hook was never told.
    const failure = new Error('store down')
    const { service, source, notifications } = await boot({
      wrap: (base) => ({
        getSnapshot: (key) => base.getSnapshot(key),
        putSnapshot: () => Promise.reject(failure),
        clearPendingChanges: (key, keys) => base.clearPendingChanges(key, keys),
        listKeysWithPendingChanges: (limit, cursor) =>
          base.listKeysWithPendingChanges(limit, cursor),
        markEventProcessed: (name, id, at) => base.markEventProcessed(name, id, at),
        forgetEvent: (name, id) => base.forgetEvent(name, id),
        deleteEventsOlderThan: (instant) => base.deleteEventsOlderThan(instant),
        listStaleKeys: (olderThan, limit, cursor) => base.listStaleKeys(olderThan, limit, cursor)
      })
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await expect(service.refresh(ACCOUNT)).rejects.toBe(failure)
    expect(notifications).toHaveLength(0)
  })

  it('returns from a refresh after the hook has returned', async () => {
    // Scenario: a slow hook; the host's own refresh call waits for it.
    const { service, source, setBehaviour } = await boot()
    let finished = false
    setBehaviour(async () => {
      await new Promise((resolve) => setImmediate(resolve))
      finished = true
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    expect(finished).toBe(true)
  })

  it('gives the same change the same key in two applications', async () => {
    // Scenario: two applications compute the same transition from the same two source states; the
    // keys they hand the hook are equal.
    const keysOf = async (): Promise<string[]> => {
      const { service, source, clock, notifications } = await boot()
      source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
      await service.refresh(ACCOUNT)
      clock.advance(3_600_000)
      source.setAccount(ACCOUNT, sourceState('2026-03-01T00:00:00.000Z', T1))
      await service.refresh(ACCOUNT)
      return notifications.flatMap((n) => n.changes.map((change) => change.key))
    }
    expect(await keysOf()).toStrictEqual(await keysOf())
  })
})

/** The store with some methods replaced; the others reach it unchanged. */
function over(
  base: InMemorySubscriptionStore,
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

describe('change notifications when the store or the observer misbehaves', () => {
  it('logs a failure to clear and delivers the same changes again on the next run', async () => {
    // Scenario: the hook returns but the store cannot clear; the next run calls it again with the
    // same keys, and this time the clear works.
    let clearing = false
    const { service, source, store, lines, notifications } = await boot({
      wrap: (base) =>
        over(base, {
          clearPendingChanges: (key, keys) =>
            clearing ? base.clearPendingChanges(key, keys) : Promise.reject(new Error('store down'))
        })
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    expect(await pendingKeys(store)).toHaveLength(1)
    expect(lines).toStrictEqual([
      `The change hook returned but its changes could not be cleared; they are delivered again (account ${hashAccountKey(KEY)}): unclassified.`
    ])
    clearing = true
    await service.reconcile({})
    expect(notifications.map((n) => n.redelivery)).toStrictEqual([false, true])
    expect(notifications[1]?.changes).toStrictEqual(notifications[0]?.changes)
    expect(await pendingKeys(store)).toStrictEqual([])
  })

  it('logs that pending changes could not be read and keeps them for the next run', async () => {
    // Scenario: the store cannot be read while a run tries to deliver; nothing is called or cleared.
    let reading = true
    const { service, source, store, lines, notifications, setBehaviour } = await boot({
      wrap: (base) =>
        over(base, {
          getSnapshot: (key) =>
            reading ? Promise.reject(new Error('store down')) : base.getSnapshot(key)
        })
    })
    setBehaviour(() => Promise.reject(new Error('hook down')))
    reading = false
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    reading = true
    lines.length = 0
    await service.reconcile({})
    reading = false
    expect(lines).toContain(
      `The pending changes of an account could not be read for delivery (account ${hashAccountKey(KEY)}): unclassified.`
    )
    expect(notifications).toHaveLength(1)
    expect(await pendingKeys(store)).toHaveLength(1)
  })

  it('skips a pending key it cannot decode and delivers the others', async () => {
    // Scenario: the listing holds a key the library never wrote; the run goes on.
    const { service, source, notifications, setBehaviour } = await boot({
      wrap: (base) =>
        over(base, {
          listKeysWithPendingChanges: async (limit, cursor) => {
            const page = await base.listKeysWithPendingChanges(limit, cursor)
            return { ...page, keys: ['not-a-key', ...page.keys] }
          }
        })
    })
    setBehaviour(() => Promise.reject(new Error('hook down')))
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    setBehaviour(() => undefined)
    await service.reconcile({})
    expect(notifications.map((n) => n.redelivery)).toStrictEqual([false, true])
  })

  it.each([
    [
      'throws',
      {
        onRefresh: (): never => {
          throw new Error('observer broke')
        },
        onCacheLookup: (): Promise<void> => Promise.reject(new Error('observer rejected'))
      }
    ],
    [
      'exposes a method that throws when read',
      Object.defineProperty({}, 'onRefresh', {
        get(): never {
          throw new Error('getter broke')
        }
      })
    ]
  ])('does not fail a refresh or a read when the observer %s', async (_how, observer) => {
    // Scenario: an observer that breaks in each way; the host's operations succeed.
    const { service, source } = await boot({ observer })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await expect(service.refresh(ACCOUNT)).resolves.toMatchObject({ accountId: 'sentinel-acc-1' })
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({
      accountId: 'sentinel-acc-1'
    })
  })
})

describe('change notifications from reconciliation, bounds and defences', () => {
  it('logs the code of a library error the hook throws', async () => {
    // Scenario: the hook throws an error of the library's catalogue; its code is what is logged.
    const { service, source, lines, setBehaviour } = await boot()
    setBehaviour(() => {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.OPERATION_NOT_POSSIBLE)
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    expect(lines).toStrictEqual([
      `The change hook failed; its changes stay pending and are delivered again (account ${hashAccountKey(KEY)}): SUBSCRIPTION_OPERATION_NOT_POSSIBLE.`
    ])
  })

  it('delivers no more accounts in a run than the batch bound and the rest in the next run', async () => {
    // Scenario: three accounts pending and a bound of two; the next run delivers the third.
    const { service, store, notifications } = await boot()
    for (const accountId of ['sentinel-acc-a', 'sentinel-acc-b', 'sentinel-acc-c']) {
      const account = { accountId }
      await store.putSnapshot(
        encodeAccountKey(account),
        { ...sourceState('2026-02-01T00:00:00.000Z', T0), accountId },
        [{ kind: 'started', key: `key-${accountId}` }],
        T0
      )
    }
    await service.reconcile({ batchSize: 2 })
    expect(notifications).toHaveLength(2)
    await service.reconcile({ batchSize: 2 })
    expect(notifications).toHaveLength(3)
    expect(notifications.every((notification) => notification.redelivery)).toBe(true)
  })

  it.each([
    ['no snapshot', (): Promise<null> => Promise.resolve(null)],
    [
      'no pending change',
      (base: SubscriptionStore): Promise<unknown> =>
        base
          .getSnapshot(KEY)
          .then((held) => (held === null ? null : { ...held, pendingChanges: [] }))
    ],
    [
      'the snapshot of another account',
      (base: SubscriptionStore): Promise<unknown> =>
        base
          .getSnapshot(KEY)
          .then((held) =>
            held === null
              ? null
              : { ...held, snapshot: { ...held.snapshot, accountId: 'someone-else' } }
          )
    ]
  ])('calls no hook on a redelivery when the store answers with %s', async (_what, answer) => {
    // Scenario: the pending list names the account, but what the store then holds cannot be
    // delivered; the hook is not called and nothing is cleared.
    let answering = false
    const { service, source, store, notifications, setBehaviour } = await boot({
      wrap: (base) =>
        over(base, {
          getSnapshot: async (key) =>
            answering ? ((await answer(base)) as StoredSnapshot | null) : base.getSnapshot(key)
        })
    })
    setBehaviour(() => Promise.reject(new Error('hook down')))
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await service.refresh(ACCOUNT)
    answering = true
    await service.reconcile({})
    answering = false
    expect(notifications).toHaveLength(1)
    expect(await pendingKeys(store)).toHaveLength(1)
  })
})

describe('change notifications for an entitlement with several grantors', () => {
  it('stores, reads back and reports an entitlement that two subscriptions grant', async () => {
    // Scenario: the source reports two subscriptions that both grant pro; the snapshot with both
    // grantors passes the store's validation, is read back whole, and the hook hears of the overlap.
    const { service, source, notifications } = await boot()
    const one = sourceState('2026-02-01T00:00:00.000Z', T0)
    const subscriptions = [
      RECORD,
      { ...RECORD, subscriptionReference: 'sub-2', productReference: 'web_yearly' }
    ]
    const { entitlements } = resolveEntitlements(
      subscriptions,
      new Map([
        ['sub-1', ['pro']],
        ['sub-2', ['pro']]
      ])
    )
    source.setAccount(ACCOUNT, { ...one, subscriptions, entitlements })
    await service.refresh(ACCOUNT)
    const read = await service.getSnapshot(ACCOUNT)
    expect(read.entitlements[0]?.grantingSubscriptionReferences).toStrictEqual(['sub-1', 'sub-2'])
    expect(notifications[0]?.changes.map((change) => change.kind)).toStrictEqual([
      'started',
      'started',
      'overlap_detected'
    ])
  })
})

describe('change notifications when the hook refreshes the same account', () => {
  it('lets a hook await a refresh of its own account, without the two waiting for each other', async () => {
    // Scenario: the hook, on its first call, awaits a refresh of the account it was called for.
    // The outer refresh must resolve, the hook's own call must return, and its changes must be
    // cleared; the race below names the outcome by assertion instead of by a timeout.
    const { service, source, store, notifications, setBehaviour } = await boot()
    let inner = 'not returned'
    setBehaviour(async () => {
      if (notifications.length > 1) return
      await service.refresh(ACCOUNT)
      inner = 'returned'
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    const stuck = (async (): Promise<string> => {
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve))
      return 'stuck'
    })()
    const winner = await Promise.race([service.refresh(ACCOUNT).then(() => 'resolved'), stuck])
    expect(winner).toBe('resolved')
    expect(inner).toBe('returned')
    expect(notifications).toHaveLength(1)
    expect(await pendingKeys(store)).toStrictEqual([])
    expect(source.readCount(ACCOUNT)).toBe(2)
  })
})
