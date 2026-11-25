/**
 * @fileoverview Pins what the service does with a snapshot it cannot trust: one a cache or a store
 * returns with a field of the wrong type, an unreadable instant, another account's identity or a
 * property that throws when read. Each is read as absent, never as access.
 * @layer core
 */
import { Test } from '@nestjs/testing'
import { encodeAccountKey, type AccountReference } from '@bymax-one/nest-subscription/internal'
import {
  createEmptySnapshot,
  type EntitlementState,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import {
  FakeSubscriptionSource,
  InMemorySubscriptionStore,
  ManualClock
} from '@bymax-one/nest-subscription/testing'

import type { SubscriptionCache } from './options/subscription-options.types'
import { SubscriptionService } from './subscription.service'
import { SubscriptionModule } from './subscription.module'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const T0 = '2026-01-01T00:00:00.000Z'

/** The snapshot of the account with the entitlement `pro` active or not. */
function snapshotOf(active: boolean): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({ accountId: 'acc-1', source: 'fake', fetchedAt: T0 }),
    entitlements: [
      {
        name: 'pro',
        active,
        until: null,
        grantingSubscriptionReference: null,
        grantingSubscriptionReferences: []
      }
    ]
  }
}

/** The same snapshot with one entitlement field replaced, which may break its type. */
function withEntitlement(patch: Record<string, unknown>): SubscriptionSnapshot {
  const entitlement: EntitlementState = Object.assign({}, snapshotOf(false).entitlements[0], patch)
  return { ...snapshotOf(false), entitlements: [entitlement] }
}

/** A service over the module, with a fake source, an in-memory store and an optional cache. */
async function build(cache?: SubscriptionCache): Promise<{
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
        clock: new ManualClock(T0),
        accountResolver: () => null,
        ...(cache === undefined ? {} : { cache })
      })
    ]
  }).compile()
  return { service: app.get(SubscriptionService), source, store }
}

/** A host cache backed by a map the test can write to. */
function mapCache(entries: Map<string, string>): SubscriptionCache {
  return {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: () => Promise.resolve(),
    delete: () => Promise.resolve()
  }
}

const KEY = `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`

describe('SubscriptionService with a cache that holds an unreadable snapshot', () => {
  it.each([
    ['fetch instant', { ...snapshotOf(false), fetchedAt: 'invalid' }],
    ['source instant', { ...snapshotOf(false), sourceUpdatedAt: 'later' }],
    ['entitlement until', withEntitlement({ active: false, until: 'not-a-date' })]
  ])(
    'answers the store snapshot, and does not reject, for an unreadable %s',
    async (_name, cached) => {
      // Scenario: the host cache returns the right account, without access, with one instant
      // that cannot be read; the store holds access, so only the store's answer is true.
      const entries = new Map<string, string>()
      const { service, source } = await build(mapCache(entries))
      source.setAccount(ACCOUNT, snapshotOf(true))
      await service.refresh(ACCOUNT)
      entries.set(KEY, JSON.stringify(cached))
      await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(true)
      await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({ accountId: 'acc-1' })
    }
  )
})

describe('SubscriptionService with a snapshot whose access flag is not a boolean', () => {
  it('answers false for an entitlement whose stored active flag is the text false', async () => {
    // Scenario: a host store returns active: 'false'; the text must not grant access.
    const { service, store } = await build()
    jest
      .spyOn(store, 'getSnapshot')
      .mockResolvedValue({ snapshot: withEntitlement({ active: 'false' }), pendingChanges: [] })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
  })

  it('answers the store, not a cached entitlement whose active flag is the text false', async () => {
    // Scenario: the cache holds active: 'false' and the store holds the real, inactive entitlement.
    const entries = new Map<string, string>()
    const { service, source, store } = await build(mapCache(entries))
    source.setAccount(ACCOUNT, snapshotOf(false))
    await service.refresh(ACCOUNT)
    entries.set(KEY, JSON.stringify(withEntitlement({ active: 'false' })))
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    const reads = jest.spyOn(store, 'getSnapshot')
    await service.getSnapshot(ACCOUNT)
    expect(reads).toHaveBeenCalled()
  })
})

describe('SubscriptionService with a stored snapshot that cannot be read', () => {
  it('answers an empty snapshot and false, and does not reject, for an unreadable instant', async () => {
    // Scenario: a host store returns a snapshot whose fetch instant is garbled.
    const { service, store } = await build()
    jest.spyOn(store, 'getSnapshot').mockResolvedValue({
      snapshot: { ...snapshotOf(true), fetchedAt: 'invalid' },
      pendingChanges: []
    })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({
      entitlements: [],
      subscriptions: []
    })
  })

  it('answers an empty snapshot when the store holds the snapshot of another account under the key', async () => {
    // Scenario: a host store returns another account's snapshot for this key.
    const { service, store } = await build()
    jest.spyOn(store, 'getSnapshot').mockResolvedValue({
      snapshot: { ...snapshotOf(true), accountId: 'other' },
      pendingChanges: []
    })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
  })

  it('answers an empty snapshot and false, not an error, when reading the snapshot throws', async () => {
    // Scenario: the store returns a proxy whose get trap throws.
    const { service, store } = await build()
    const hostile = new Proxy(snapshotOf(true), {
      get: () => {
        throw new Error('get trap broke')
      }
    })
    jest.spyOn(store, 'getSnapshot').mockResolvedValue({ snapshot: hostile, pendingChanges: [] })
    await expect(service.hasEntitlement(ACCOUNT, 'pro')).resolves.toBe(false)
    await expect(service.getSnapshot(ACCOUNT)).resolves.toMatchObject({ entitlements: [] })
  })
})
