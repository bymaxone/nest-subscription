/**
 * @fileoverview Read and refresh, end to end: a real NestJS application boots with the fake source
 * and the in-memory store, a state is set on the source, refreshed and read back, and the source's
 * call counts show when it is read. Time moves only through a manual clock.
 * @layer e2e
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import {
  SUBSCRIPTION_ERROR_CODES,
  SubscriptionError,
  SubscriptionModule,
  SubscriptionService,
  encodeAccountKey
} from '@bymax-one/nest-subscription'
import type {
  AccountReference,
  SubscriptionModuleOptions,
  SubscriptionStore
} from '@bymax-one/nest-subscription'
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
async function boot(extra: Partial<SubscriptionModuleOptions> = {}): Promise<{
  app: TestingModule
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
  clock: ManualClock
}> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const clock = new ManualClock()
  const app = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({ source, store, clock, accountResolver: () => null, ...extra })
    ]
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
    const fast = new SnapshotRefresher(source, store, clock, null)
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
    const late = new SnapshotRefresher(source, gated, clock, null).refresh(ACCOUNT)
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
    const result = await new SnapshotRefresher(source, refusing, clock, null).refresh(ACCOUNT)
    expect(result.written).toBe(false)
    expect(result.current.sourceUpdatedAt).toBe(T10)
    await app.close()
  })
})

describe('read and refresh: the service in a running application', () => {
  it('reads an entitlement from the store and calls the source only for the refresh', async () => {
    // Scenario: a state is set on the source and refreshed on demand; every later read answers from
    // the store, so the source's read count stays at the one refresh.
    const { app, source } = await boot()
    const service = app.get(SubscriptionService)
    source.setAccount(ACCOUNT, {
      ...snapshotOf(ACCOUNT, T10),
      entitlements: [{ name: 'pro', active: true, until: null, grantingSubscriptionReference: 's' }]
    })
    expect((await service.refresh(ACCOUNT)).ageMs).toBe(0)
    for (let read = 0; read < 5; read += 1) {
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
      await service.getSnapshot(ACCOUNT)
    }
    expect(source.readCount(ACCOUNT)).toBe(1)
    await app.close()
  })

  it('answers an unknown account as an empty snapshot and false without a source call', async () => {
    // Scenario: nothing is stored for the account; the source is held and still no read waits.
    const { app, source } = await boot()
    const service = app.get(SubscriptionService)
    source.delayNextRead()
    expect(await service.hasEntitlement(ACCOUNT, 'pro')).toBe(false)
    expect((await service.getSnapshot(ACCOUNT)).entitlements).toEqual([])
    expect(source.totalReads).toBe(0)
    await app.close()
  })

  it('refuses a missing tenant when the application is configured as multi-tenant', async () => {
    // Scenario: forRoot with multiTenant; the caller passes no tenant.
    const source = new FakeSubscriptionSource()
    const store = new InMemorySubscriptionStore({ logger: () => undefined })
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source,
          store,
          multiTenant: true,
          accountResolver: () => null
        })
      ]
    }).compile()
    const error = await app
      .get(SubscriptionService)
      .getSnapshot(ACCOUNT)
      .catch((caught: unknown) => caught)
    expect((error as SubscriptionError).code).toBe(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    const withTenant = await app
      .get(SubscriptionService)
      .getSnapshot({ tenantId: 'acme', accountId: 'acc-1' })
    expect(withTenant.tenantId).toBe('acme')
    await app.close()
  })
})

/** Lets every promise that can settle without outside help settle, then one turn of the loop. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

describe('read and refresh: a stale snapshot in a running application', () => {
  const MAX = 1000
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  /** A booted application whose account is stored and has aged past the maximum age. */
  async function stale(extra: Partial<SubscriptionModuleOptions> = {}): ReturnType<typeof boot> {
    const built = await boot({ maxSnapshotAgeMs: MAX, ...extra })
    built.source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await built.app.get(SubscriptionService).refresh(ACCOUNT)
    built.clock.advance(MAX + 1)
    return built
  }

  it('answers a stale read from the store at once and lets the background refresh land', async () => {
    // Scenario: the refresh is held; the read returns the old snapshot, then the refresh lands.
    const { app, source } = await stale()
    const service = app.get(SubscriptionService)
    const release = source.delayNextRead()
    expect((await service.getSnapshot(ACCOUNT)).ageMs).toBe(MAX + 1)
    await settle()
    expect(source.readCount(ACCOUNT)).toBe(2)
    release()
    await settle()
    expect((await service.getSnapshot(ACCOUNT)).ageMs).toBe(0)
    await app.close()
  })

  it('logs a failed background refresh by code and tells the observer, leaving the read answered', async () => {
    // Scenario: the source fails during the background refresh of a stale snapshot.
    const onBackgroundRefreshFailure = jest.fn()
    const { app, source } = await stale({ observer: { onBackgroundRefreshFailure } })
    source.failNextRead(new Error('down'))
    await expect(app.get(SubscriptionService).getSnapshot(ACCOUNT)).resolves.toBeDefined()
    await settle()
    expect(onBackgroundRefreshFailure).toHaveBeenCalledWith({
      code: SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE
    })
    expect(String(warn.mock.calls[0]?.[0])).toContain(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    await app.close()
  })

  it('logs a failed background refresh when the observer has no hook and when there is none', async () => {
    // Scenario: one application with an observer that handles nothing, one with no observer.
    for (const extra of [{ observer: {} }, {}]) {
      const { app, source } = await stale(extra)
      source.failNextRead(new Error('down'))
      await app.get(SubscriptionService).getSnapshot(ACCOUNT)
      await settle()
      await app.close()
    }
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('reports a store failure during the refresh with no code', async () => {
    // Scenario: the store serves the stale read, then fails on the refresh's own read of it.
    const failure = new Error('store down')
    const onBackgroundRefreshFailure = jest.fn()
    const memory = new InMemorySubscriptionStore({ logger: () => undefined })
    let passes = Infinity
    const store = delegating(memory, {
      getSnapshot: (key) => (passes-- > 0 ? memory.getSnapshot(key) : Promise.reject(failure))
    })
    const source = new FakeSubscriptionSource()
    const clock = new ManualClock()
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source,
          store,
          clock,
          maxSnapshotAgeMs: MAX,
          observer: { onBackgroundRefreshFailure },
          accountResolver: () => null
        })
      ]
    }).compile()
    const service = app.get(SubscriptionService)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, T10))
    await service.refresh(ACCOUNT)
    clock.advance(MAX + 1)
    passes = 1
    await service.getSnapshot(ACCOUNT)
    await settle()
    expect(onBackgroundRefreshFailure).toHaveBeenCalledWith({ code: null })
    await app.close()
  })

  it('keeps answering when the observer throws', async () => {
    // Scenario: the hook throws while the failure is reported; the read was already answered.
    const { app, source } = await stale({
      observer: {
        onBackgroundRefreshFailure: () => {
          throw new Error('observer broke')
        }
      }
    })
    source.failNextRead(new Error('down'))
    await expect(app.get(SubscriptionService).getSnapshot(ACCOUNT)).resolves.toBeDefined()
    await settle()
    await app.close()
  })
})
