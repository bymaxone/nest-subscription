/**
 * @fileoverview Read and refresh, end to end: a real NestJS application boots with the fake source
 * and the in-memory store, a state is set on the source, refreshed and read back, and the source's
 * call counts show when it is read. Time moves only through a manual clock.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionError,
  SubscriptionModule,
  encodeAccountKey
} from '@bymax-one/nest-subscription'
import type { AccountReference, SubscriptionStore } from '@bymax-one/nest-subscription'
import { createEmptySnapshot } from '@bymax-one/nest-subscription/shared'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { SnapshotRefresher } from '../../src/core/refresh/snapshot-refresher'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const T10 = '2026-01-01T00:00:10.000Z'

/** A snapshot of an account as of the given source instant. */
function snapshotOf(account: AccountReference, sourceUpdatedAt: string): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      source: 'fake',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    }),
    sourceUpdatedAt
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

/** An application wired to a fake source, an in-memory store and a manual clock. */
async function boot(): Promise<{
  app: TestingModule
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
}> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock()
  const app = await Test.createTestingModule({
    imports: [SubscriptionModule.forRoot({ source, store, clock, accountResolver: () => null })]
  }).compile()
  return { app, source, store, clock }
}

describe('read and refresh: the refresher in a running application', () => {
  it('stores what the source reports and reads it back from the store', async () => {
    // Scenario: a state is set on the source, refreshed through the module's refresher and read
    // from the store the module was given.
    const { app, source, store, clock } = await boot()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    clock.advance(60_000)
    const refresher = app.get(SnapshotRefresher)
    const result = await refresher.refresh(ACCOUNT)
    expect(result.written).toBe(true)
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.fetchedAt).toBe('2026-01-01T00:01:00.000Z')
    expect(stored?.snapshot.sourceUpdatedAt).toBe(T10)
    await app.close()
  })

  it('makes one source call for a hundred concurrent refreshes of one account', async () => {
    // Scenario: a hundred refreshes start while the read is held by the fake source.
    const { app, source } = await boot()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const release = source.delayNextRead()
    const refresher = app.get(SnapshotRefresher)
    const callers = Array.from({ length: 100 }, () => refresher.refresh(ACCOUNT))
    await Promise.resolve()
    release()
    await Promise.all(callers)
    expect(source.readCount(ACCOUNT)).toBe(1)
    expect(refresher.inFlight).toBe(0)
    await app.close()
  })

  it('reports a source failure as the source-unavailable code and keeps the stored snapshot', async () => {
    // Scenario: a stored snapshot, then a failing read.
    const { app, source, store } = await boot()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const refresher = app.get(SnapshotRefresher)
    await refresher.refresh(ACCOUNT)
    const before = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    source.failNextRead(new Error('upstream down'))
    const error = await refresher.refresh(ACCOUNT).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SubscriptionError)
    expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    expect(await store.getSnapshot(encodeAccountKey(ACCOUNT))).toEqual(before)
    await app.close()
  })

  it('keeps the newer snapshot when the source later reports an older state', async () => {
    // Scenario: a newer state is stored, the clock moves on, and the source reports an older one.
    const { app, source, store, clock } = await boot()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, '2026-01-01T00:00:20.000Z'))
    const refresher = app.get(SnapshotRefresher)
    const first = await refresher.refresh(ACCOUNT)
    clock.set('2026-01-02T00:00:00.000Z')
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const second = await refresher.refresh(ACCOUNT)
    expect(second.written).toBe(false)
    expect(second.current).toEqual(first.current)
    expect((await store.getSnapshot(encodeAccountKey(ACCOUNT)))?.snapshot).toEqual(first.current)
    await app.close()
  })

  it('keeps the newer snapshot when two refreshers finish in the opposite order to their start', async () => {
    // Scenario: two refreshers share one store, as two processes would. The read that started
    // first is held and returns an older state after the second has stored a newer one.
    const { app, source, store, clock } = await boot()
    const slow = app.get(SnapshotRefresher)
    const fast = new SnapshotRefresher(source, store, clock)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const release = source.delayNextRead()
    const late = slow.refresh(ACCOUNT)
    await Promise.resolve()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, '2026-01-01T00:00:20.000Z'))
    await fast.refresh(ACCOUNT)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    release()
    expect((await late).written).toBe(false)
    const stored = await store.getSnapshot(encodeAccountKey(ACCOUNT))
    expect(stored?.snapshot.sourceUpdatedAt).toBe('2026-01-01T00:00:20.000Z')
    await app.close()
  })

  it('keeps the newer snapshot when the store refuses the write of a refresh that read before it', async () => {
    // Scenario: the slow refresher reads the store (nothing there), is held before its write, the
    // fast one stores a newer state, and the store then refuses the slow write.
    const { app, source, store, clock } = await boot()
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const gated = delegating(store, {
      putSnapshot: async (key, snapshot, changes, at) => {
        await gate
        return store.putSnapshot(key, snapshot, changes, at)
      }
    })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const late = new SnapshotRefresher(source, gated, clock).refresh(ACCOUNT)
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, '2026-01-01T00:00:20.000Z'))
    await app.get(SnapshotRefresher).refresh(ACCOUNT)
    open()
    const result = await late
    expect(result.written).toBe(false)
    expect(result.current.sourceUpdatedAt).toBe('2026-01-01T00:00:20.000Z')
    await app.close()
  })

  it('orders by the fetch instant when the source reports no update instant', async () => {
    // Scenario: a snapshot with no source instant is stored, then a later one replaces it.
    const { app, source, clock } = await boot()
    const refresher = app.get(SnapshotRefresher)
    source.setAccount(ACCOUNT, { ...snapshotOf(ACCOUNT, T10), sourceUpdatedAt: null })
    await refresher.refresh(ACCOUNT)
    clock.advance(1000)
    expect((await refresher.refresh(ACCOUNT)).written).toBe(true)
    await app.close()
  })

  it('answers with what it fetched when a store refuses the write and holds nothing to read back', async () => {
    // Scenario: a store that breaks its contract by refusing a first write; no error is raised.
    const { app, source, store, clock } = await boot()
    const refusing = delegating(store, {
      getSnapshot: () => Promise.resolve(null),
      putSnapshot: () => Promise.resolve(false)
    })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    const result = await new SnapshotRefresher(source, refusing, clock).refresh(ACCOUNT)
    expect(result.written).toBe(false)
    expect(result.current.sourceUpdatedAt).toBe(T10)
    await app.close()
  })
})
