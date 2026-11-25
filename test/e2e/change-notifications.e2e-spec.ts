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
  SubscriptionModule,
  SubscriptionService,
  encodeAccountKey,
  type SubscriptionChangeNotification,
  type SubscriptionObserver,
  type SubscriptionStore
} from '@bymax-one/nest-subscription'
import type { SubscriptionRecord, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:01:00.000Z'
const ACCOUNT = { accountId: 'acc-1' }
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
  it('calls the hook after the write with the previous snapshot, the new one and the changes', async () => {
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
      throw new Error('hook broke for acc-1')
    })
    source.setAccount(ACCOUNT, sourceState('2026-02-01T00:00:00.000Z', T0))
    await expect(service.refresh(ACCOUNT)).resolves.toMatchObject({ accountId: 'acc-1' })
    const held = await store.getSnapshot(KEY)
    expect(held?.snapshot.subscriptions).toHaveLength(1)
    expect(held?.pendingChanges.map((change) => change.kind)).toStrictEqual(['started'])
    expect(lines).toStrictEqual([
      'The change hook failed; its changes stay pending and are delivered again: unclassified.'
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

  it('gives the same change the same key whenever it is computed', async () => {
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
