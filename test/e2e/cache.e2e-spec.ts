/**
 * @fileoverview The optional cache, end to end: a real application with a map-backed cache reads
 * through it, sees a change on the next read, keeps tenants apart, and keeps answering when the
 * host's cache throws. An application with no cache runs the same reads against the store.
 * @layer e2e
 */
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'
import { SubscriptionModule, SubscriptionService } from '@bymax-one/nest-subscription'
import type {
  AccountReference,
  SubscriptionCache,
  SubscriptionModuleOptions,
  SubscriptionOptionsInput,
  SubscriptionStore
} from '@bymax-one/nest-subscription'
import { createEmptySnapshot, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import { SnapshotCache } from '../../src/core/cache/snapshot-cache'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }

/** A snapshot with one entitlement `pro`, active or not, as of a source instant. */
function snapshotOf(
  account: AccountReference,
  active: boolean,
  sourceUpdatedAt: string
): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: 'fake',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    }),
    entitlements: [{ name: 'pro', active, until: null, grantingSubscriptionReference: null }],
    sourceUpdatedAt
  }
}

/** A map-backed host cache that keeps every entry it was given. */
function mapCache(): SubscriptionCache & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
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
}

/** A host cache that throws on every call. */
const THROWING_CACHE: SubscriptionCache = {
  get: () => Promise.reject(new Error('cache down')),
  set: () => Promise.reject(new Error('cache down')),
  delete: () => Promise.reject(new Error('cache down'))
}

/** An application with the given cache, or none. */
async function boot(
  cache?: SubscriptionCache,
  multiTenant = false,
  extra: Partial<SubscriptionModuleOptions> = {}
): Promise<{
  app: TestingModule
  service: SubscriptionService
  source: FakeSubscriptionSource
  store: InMemorySubscriptionStore
}> {
  const source = new FakeSubscriptionSource()
  const store = new InMemorySubscriptionStore({ logger: () => undefined })
  const app = await Test.createTestingModule({
    imports: [
      SubscriptionModule.forRoot({
        source,
        store,
        multiTenant,
        clock: new ManualClock(),
        accountResolver: () => null,
        ...(cache === undefined ? {} : { cache }),
        ...extra
      })
    ]
  }).compile()
  return { app, service: app.get(SubscriptionService), source, store }
}

/** A store whose reads wait for `gate.hold`, when it is set, after they have read. */
function holdingStore(): { store: SubscriptionStore; gate: { hold: Promise<void> | undefined } } {
  const memory = new InMemorySubscriptionStore({ logger: () => undefined })
  const gate: { hold: Promise<void> | undefined } = { hold: undefined }
  const store: SubscriptionStore = {
    getSnapshot: async (key) => {
      const result = await memory.getSnapshot(key)
      await gate.hold
      return result
    },
    putSnapshot: (key, snapshot, changes, at) => memory.putSnapshot(key, snapshot, changes, at),
    clearPendingChanges: (key, keys) => memory.clearPendingChanges(key, keys),
    listKeysWithPendingChanges: (limit, cursor) => memory.listKeysWithPendingChanges(limit, cursor),
    markEventProcessed: (name, id, at) => memory.markEventProcessed(name, id, at),
    forgetEvent: (name, id) => memory.forgetEvent(name, id),
    deleteEventsOlderThan: (instant) => memory.deleteEventsOlderThan(instant),
    listStaleKeys: (olderThan, limit, cursor) => memory.listStaleKeys(olderThan, limit, cursor)
  }
  return { store, gate }
}

/** A host cache that honours the lifetime it is given, measured on the injected clock. */
function expiringCache(clock: ManualClock): SubscriptionCache {
  const entries = new Map<string, { value: string; until: number }>()
  return {
    get: (key) => {
      const entry = entries.get(key)
      return Promise.resolve(
        entry !== undefined && entry.until > clock.now().getTime() ? entry.value : null
      )
    },
    set: (key, value, ttlMs) => {
      entries.set(key, { value, until: clock.now().getTime() + ttlMs })
      return Promise.resolve()
    },
    delete: (key) => {
      entries.delete(key)
      return Promise.resolve()
    }
  }
}

describe('cache', () => {
  it('serves an entry younger than the lifetime the host set and not one older', async () => {
    // Scenario: a lifetime of five seconds on the injected clock; a read 4.999 s after the fill is
    // served from the cache, a read 5 s after it reaches the store.
    const clock = new ManualClock()
    const { app, service, source, store } = await boot(expiringCache(clock), false, {
      clock,
      cacheTtlMs: 5000
    })
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    await service.getSnapshot(ACCOUNT)
    const reads = jest.spyOn(store, 'getSnapshot')
    clock.advance(4999)
    await service.getSnapshot(ACCOUNT)
    expect(reads).toHaveBeenCalledTimes(0)
    clock.advance(1)
    await service.getSnapshot(ACCOUNT)
    expect(reads).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('does not reach the store for a second read of one account', async () => {
    // Scenario: refresh, then three reads; the store is read once, the cache answers the others.
    const { app, service, source, store } = await boot(mapCache())
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    const reads = jest.spyOn(store, 'getSnapshot')
    for (let read = 0; read < 3; read += 1) {
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    }
    expect(reads).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('shows a change on the next read after the refresh that wrote it', async () => {
    // Scenario: the entitlement is cached as active; a newer source state removes it.
    const { app, service, source } = await boot(mapCache())
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, false, '2026-01-01T00:00:20.000Z'))
    await service.refresh(ACCOUNT)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    await app.close()
  })

  it('holds only what the store holds, under a fixed prefix, and one entry per tenant', async () => {
    // Scenario: the same account identifier under two tenants fills two entries, each the stored
    // snapshot as JSON.
    const cache = mapCache()
    const { app, service, source, store } = await boot(cache, true)
    const one: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
    const two: AccountReference = { tenantId: 'two', accountId: 'acc-1' }
    source.setAccount(one, snapshotOf(one, true, '2026-01-01T00:00:10.000Z'))
    source.setAccount(two, snapshotOf(two, false, '2026-01-01T00:00:10.000Z'))
    await service.refresh(one)
    await service.refresh(two)
    await service.getSnapshot(one)
    await service.getSnapshot(two)
    expect([...cache.entries.keys()].every((key) => key.startsWith('subscription:snapshot:'))).toBe(
      true
    )
    expect(cache.entries.size).toBe(2)
    const storedOne = (await store.getSnapshot('t3:one:a5:acc-1'))?.snapshot
    expect([...cache.entries.values()]).toContain(JSON.stringify(storedOne))
    await expect(service.hasEntitlement(one, 'pro')).resolves.toBe(true)
    await expect(service.hasEntitlement(two, 'pro')).resolves.toBe(false)
    await app.close()
  })

  it.each(['not json', '{"unrelated":true}'])(
    'ignores a cache entry that is not a snapshot (%s) and answers from the store',
    async (poisoned) => {
      // Scenario: the host cache holds something else under the snapshot's key; the store's
      // snapshot is returned and replaces it, and no read is left pending.
      const cache = mapCache()
      const { app, service, source } = await boot(cache)
      source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
      await service.refresh(ACCOUNT)
      cache.entries.set('subscription:snapshot:a5:acc-1', poisoned)
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
      expect(cache.entries.get('subscription:snapshot:a5:acc-1')).not.toBe(poisoned)
      expect(app.get(SnapshotCache)?.pendingLoads).toBe(0)
      expect(app.get(SnapshotCache)?.pendingAccounts).toBe(0)
      await app.close()
    }
  )

  it('does not let a read that began before a refresh put its old value back in the cache', async () => {
    // Scenario: two cache misses read the store, which is held; a refresh stores a newer state and
    // invalidates; the old value is released, answered, and not cached.
    const cache = mapCache()
    const source = new FakeSubscriptionSource()
    const { store, gate } = holdingStore()
    const app = await Test.createTestingModule({
      imports: [
        SubscriptionModule.forRoot({
          source,
          store,
          cache,
          clock: new ManualClock(),
          accountResolver: () => null
        })
      ]
    }).compile()
    const service = app.get(SubscriptionService)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    let release!: () => void
    gate.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const stale = service.hasEntitlement(ACCOUNT, 'pro')
    const alsoStale = service.getSnapshot(ACCOUNT)
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    const open = gate.hold
    gate.hold = undefined
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, false, '2026-01-01T00:00:20.000Z'))
    await service.refresh(ACCOUNT)
    release()
    await open
    await expect(stale).resolves.toBe(true)
    await expect(alsoStale).resolves.toMatchObject({ accountId: 'acc-1' })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    await app.close()
  })

  it('serves the store, not another account, when the host cache holds a foreign snapshot under the key', async () => {
    // Scenario: a well-formed snapshot of another account sits under this account's key.
    const cache = mapCache()
    const { app, service, source } = await boot(cache)
    const other: AccountReference = { accountId: 'acc-2' }
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    cache.entries.set(
      'subscription:snapshot:a5:acc-1',
      JSON.stringify(snapshotOf(other, false, '2026-01-01T00:00:10.000Z'))
    )
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    expect((await service.getSnapshot(ACCOUNT)).accountId).toBe('acc-1')
    await app.close()
  })

  it('does not serve revoked access after a held cache write lands behind a refresh', async () => {
    // Scenario: a read fills the cache with active access, and the host cache holds that write; a
    // refresh then revokes the access and invalidates; the held write lands afterwards.
    const entries = new Map<string, string>()
    let land = (): void => undefined
    let first = true
    const cache: SubscriptionCache = {
      get: (key) => Promise.resolve(entries.get(key) ?? null),
      set: (key, value) => {
        if (!first) {
          entries.set(key, value)
          return Promise.resolve()
        }
        first = false
        return new Promise<void>((resolve) => {
          land = () => {
            entries.set(key, value)
            resolve()
          }
        })
      },
      delete: (key) => {
        entries.delete(key)
        return Promise.resolve()
      }
    }
    const { app, service, source } = await boot(cache)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, false, '2026-01-01T00:00:20.000Z'))
    await service.refresh(ACCOUNT)
    land()
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    await app.close()
  })

  it('keeps answering reads and refreshes when the host cache throws on every call', async () => {
    // Scenario: get, set and delete all reject.
    const { app, service, source } = await boot(THROWING_CACHE)
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await expect(service.refresh(ACCOUNT)).resolves.toBeDefined()
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
    await app.close()
  })

  it('runs the same reads with no cache and holds no cache object', async () => {
    // Scenario: nothing configured; the snapshot cache provider holds null and every read reaches
    // the store.
    const { app, service, source, store } = await boot()
    expect(app.get(SnapshotCache)).toBeNull()
    source.setAccount(ACCOUNT, snapshotOf(ACCOUNT, true, '2026-01-01T00:00:10.000Z'))
    await service.refresh(ACCOUNT)
    const reads = jest.spyOn(store, 'getSnapshot')
    await service.getSnapshot(ACCOUNT)
    await service.getSnapshot(ACCOUNT)
    expect(reads).toHaveBeenCalledTimes(2)
    await app.close()
  })

  it('builds the snapshot cache from an asynchronous configuration too', async () => {
    // Scenario: forRootAsync with a cache gives a snapshot cache; without one it gives null.
    const build = async (cache?: SubscriptionCache): Promise<TestingModule> =>
      Test.createTestingModule({
        imports: [
          SubscriptionModule.forRootAsync({
            useFactory: (): SubscriptionOptionsInput => ({
              source: new FakeSubscriptionSource(),
              store: new InMemorySubscriptionStore({ logger: () => undefined }),
              accountResolver: () => null,
              ...(cache === undefined ? {} : { cache })
            })
          })
        ]
      }).compile()
    const withCache = await build(mapCache())
    const without = await build()
    expect(withCache.get(SnapshotCache)).toBeInstanceOf(SnapshotCache)
    expect(without.get(SnapshotCache)).toBeNull()
    await withCache.close()
    await without.close()
  })
})
