/**
 * @fileoverview Pins the read-through snapshot cache: a hit skips the load, a miss loads and fills,
 * an invalidation empties, the keys keep tenants and accounts apart, a failing or lying cache
 * degrades to the load, and a value loaded before an invalidation never lands after it.
 * @layer core
 */
import {
  SUBSCRIPTION_ERROR_CODES,
  createEmptySnapshot,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'
import { encodeAccountKey, type AccountReference } from '@bymax-one/nest-subscription/internal'

import type { SubscriptionCache } from '../options/subscription-options.types'
import { ManualClock } from '@bymax-one/nest-subscription/testing'

import { SnapshotCache } from './snapshot-cache'

const TTL_MS = 30_000

const ACCOUNT: AccountReference = { accountId: 'acc-1' }

/** A snapshot carrying a marker in its source customer. */
function snapshotOf(account: AccountReference, marker = 'm'): SubscriptionSnapshot {
  return {
    ...createEmptySnapshot({
      accountId: account.accountId,
      source: 's',
      fetchedAt: '2026-01-01T00:00:00.000Z'
    }),
    sourceCustomer: { id: marker }
  }
}

/** A map-backed cache that records every call. */
function mapCache(): SubscriptionCache & {
  readonly entries: Map<string, string>
  readonly sets: Array<{ key: string; value: string; ttlMs: number }>
  readonly deletes: string[]
} {
  const entries = new Map<string, string>()
  const sets: Array<{ key: string; value: string; ttlMs: number }> = []
  const deletes: string[] = []
  return {
    entries,
    sets,
    deletes,
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value, ttlMs) => {
      sets.push({ key, value, ttlMs })
      entries.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      deletes.push(key)
      entries.delete(key)
      return Promise.resolve()
    }
  }
}

/** A promise and the function that settles it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

/** Lets every promise that can settle without outside help settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe('SnapshotCache', () => {
  it('loads on a miss, fills the cache and answers the second read without loading', async () => {
    // Scenario: two reads of one account; the load runs once.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const load = jest.fn(() => Promise.resolve(snapshotOf(ACCOUNT)))
    expect(await cache.read(ACCOUNT, load)).toEqual(snapshotOf(ACCOUNT))
    expect(await cache.read(ACCOUNT, load)).toEqual(snapshotOf(ACCOUNT))
    expect(load).toHaveBeenCalledTimes(1)
    expect(host.sets).toHaveLength(1)
  })

  it('stores the snapshot as JSON under a fixed prefix and the account key, for the lifetime it was given', async () => {
    // Scenario: the key is the prefix and the encoded account key, nothing built by hand.
    const host = mapCache()
    await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(host.sets[0]).toEqual({
      key: `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`,
      value: JSON.stringify(snapshotOf(ACCOUNT)),
      ttlMs: TTL_MS
    })
  })

  it('stores for the lifetime it was given', async () => {
    // Scenario: a cache built with its own lifetime.
    const host = mapCache()
    await new SnapshotCache(host, 1234, new ManualClock()).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(host.sets[0]?.ttlMs).toBe(1234)
  })

  it('does not cache an account with nothing to load', async () => {
    // Scenario: the load finds no snapshot; nothing is stored and the next read loads again.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const load = jest.fn(() => Promise.resolve(null))
    expect(await cache.read(ACCOUNT, load)).toBeNull()
    await cache.read(ACCOUNT, load)
    expect(host.sets).toEqual([])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads again after the account is invalidated and deletes the key it filled', async () => {
    // Scenario: a hit, an invalidation, then a read that loads the new value.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT, 'old')))
    await cache.invalidate(ACCOUNT)
    expect(host.deletes).toEqual([`subscription:snapshot:${encodeAccountKey(ACCOUNT)}`])
    const fresh = await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT, 'new')))
    expect(fresh?.sourceCustomer?.id).toBe('new')
  })

  it('keeps two tenants of one account identifier apart', async () => {
    // Scenario: the same account identifier under two tenants fills two entries.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const one: AccountReference = { tenantId: 'one', accountId: 'acc-1' }
    const two: AccountReference = { tenantId: 'two', accountId: 'acc-1' }
    await cache.read(one, () => Promise.resolve(snapshotOf(one, 'one')))
    const second = await cache.read(two, () => Promise.resolve(snapshotOf(two, 'two')))
    expect(second?.sourceCustomer?.id).toBe('two')
    expect(host.entries.size).toBe(2)
  })

  it('keeps apart two accounts whose identifiers join into one string with a delimiter', async () => {
    // Scenario: ("a:b", "c") and ("a", "b:c") do not share an entry.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const first: AccountReference = { tenantId: 'a:b', accountId: 'c' }
    const second: AccountReference = { tenantId: 'a', accountId: 'b:c' }
    await cache.read(first, () => Promise.resolve(snapshotOf(first, 'first')))
    const other = await cache.read(second, () => Promise.resolve(snapshotOf(second, 'second')))
    expect(other?.sourceCustomer?.id).toBe('second')
    expect(host.entries.size).toBe(2)
  })

  it('degrades to the load when get throws, and still answers', async () => {
    // Scenario: the host cache cannot be read.
    const host = { ...mapCache(), get: () => Promise.reject(new Error('cache down')) }
    const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(result).toEqual(snapshotOf(ACCOUNT))
  })

  it('answers when set throws', async () => {
    // Scenario: the host cache cannot be written.
    const host = { ...mapCache(), set: () => Promise.reject(new Error('cache full')) }
    const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(result).toEqual(snapshotOf(ACCOUNT))
  })

  it('does not throw when delete throws', async () => {
    // Scenario: the host cache cannot delete.
    const host = { ...mapCache(), delete: () => Promise.reject(new Error('cache down')) }
    await expect(
      new SnapshotCache(host, TTL_MS, new ManualClock()).invalidate(ACCOUNT)
    ).resolves.toBeUndefined()
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"x"'],
    ['an object without the snapshot fields', '{"accountId":"acc-1"}'],
    [
      'an object whose lists are not lists',
      JSON.stringify({ ...snapshotOf(ACCOUNT), entitlements: 'x' })
    ],
    [
      'an object whose subscriptions are not a list',
      JSON.stringify({ ...snapshotOf(ACCOUNT), subscriptions: {} })
    ],
    [
      'an object whose source is not a string',
      JSON.stringify({ ...snapshotOf(ACCOUNT), source: 3 })
    ],
    [
      'an object whose fetch instant is not a string',
      JSON.stringify({ ...snapshotOf(ACCOUNT), fetchedAt: 3 })
    ],
    [
      'an object whose account is not a string',
      JSON.stringify({ ...snapshotOf(ACCOUNT), accountId: 3 })
    ]
  ])('treats %s as a miss and loads', async (_name, poisoned) => {
    // Scenario: the cache returns something that is not a snapshot; it is not trusted.
    const host = mapCache()
    host.entries.set(`subscription:snapshot:${encodeAccountKey(ACCOUNT)}`, poisoned)
    const load = jest.fn(() => Promise.resolve(snapshotOf(ACCOUNT, 'loaded')))
    const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(result?.sourceCustomer?.id).toBe('loaded')
  })

  it.each([
    ['fetch instant', { fetchedAt: 'invalid' }],
    ['source instant', { sourceUpdatedAt: 'later' }],
    [
      'entitlement until',
      {
        entitlements: [
          { name: 'pro', active: true, until: 'not-a-date', grantingSubscriptionReference: null }
        ]
      }
    ],
    [
      'subscription instant',
      {
        subscriptions: [
          {
            subscriptionReference: 's',
            status: 'active',
            givesAccess: true,
            willRenew: 'yes',
            origin: 'web',
            environment: 'production',
            productReference: 'p',
            billingInterval: 'month',
            currentPeriodStart: '2026-01-01T00:00:00.000Z',
            currentPeriodEnd: '2026-02-01T00:00:00.000Z',
            accessUntil: null,
            billingIssueSince: null,
            cancelledAt: 'yesterday',
            refundedAt: null,
            managementReference: null
          }
        ]
      }
    ]
  ])(
    'treats a snapshot of the right account with whose %s cannot be read as a miss and loads',
    async (_name, patch) => {
      // Scenario: the cache holds the right identity with one instant that cannot be read.
      const host = mapCache()
      host.entries.set(
        `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`,
        JSON.stringify({ ...snapshotOf(ACCOUNT, 'cached'), ...patch })
      )
      const load = jest.fn(() => Promise.resolve(snapshotOf(ACCOUNT, 'loaded')))
      const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, load)
      expect(load).toHaveBeenCalledTimes(1)
      expect(result?.sourceCustomer?.id).toBe('loaded')
    }
  )

  it.each([
    ['another account', { accountId: 'acc-2' }],
    ['the same account of another tenant', { accountId: 'acc-1', tenantId: 'other' }]
  ])(
    'treats a valid snapshot of %s under this key as a miss and loads',
    async (_name, identity) => {
      // Scenario: the host cache holds a well-formed snapshot of a different identity under the key.
      const host = mapCache()
      host.entries.set(
        `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`,
        JSON.stringify({ ...snapshotOf(ACCOUNT, 'foreign'), ...identity })
      )
      const load = jest.fn(() => Promise.resolve(snapshotOf(ACCOUNT, 'loaded')))
      const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(ACCOUNT, load)
      expect(load).toHaveBeenCalledTimes(1)
      expect(result?.sourceCustomer?.id).toBe('loaded')
    }
  )

  it('treats a snapshot that names a tenant as a miss for an account that has none, and the reverse', async () => {
    // Scenario: tenant present against absent, both ways.
    const withTenant: AccountReference = { tenantId: 't1', accountId: 'acc-1' }
    for (const [asked, held] of [
      [ACCOUNT, { ...snapshotOf(ACCOUNT, 'foreign'), tenantId: 't1' }],
      [withTenant, snapshotOf(ACCOUNT, 'foreign')]
    ] as const) {
      const host = mapCache()
      host.entries.set(`subscription:snapshot:${encodeAccountKey(asked)}`, JSON.stringify(held))
      const load = jest.fn(() => Promise.resolve(snapshotOf(asked, 'loaded')))
      await new SnapshotCache(host, TTL_MS, new ManualClock()).read(asked, load)
      expect(load).toHaveBeenCalledTimes(1)
    }
  })

  it('serves a cached snapshot whose identity is the account asked for, tenant included', async () => {
    // Scenario: the positive control; a matching entry is served and the load does not run.
    const asked: AccountReference = { tenantId: 't1', accountId: 'acc-1' }
    const host = mapCache()
    host.entries.set(
      `subscription:snapshot:${encodeAccountKey(asked)}`,
      JSON.stringify({ ...snapshotOf(asked, 'cached'), tenantId: 't1' })
    )
    const load = jest.fn(() => Promise.resolve(null))
    const result = await new SnapshotCache(host, TTL_MS, new ManualClock()).read(asked, load)
    expect(result?.sourceCustomer?.id).toBe('cached')
    expect(load).not.toHaveBeenCalled()
  })

  it('lets a failing load reject the read, since nothing else can answer it', async () => {
    // Scenario: the store behind the load fails; the cache does not hide it, and leaves no entry.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    await expect(
      cache.read(ACCOUNT, () => Promise.reject(new Error('store down')))
    ).rejects.toThrow('store down')
    expect(host.sets).toEqual([])
    expect(cache.pendingLoads).toBe(0)
  })

  it('does not cache a value that was loaded before an invalidation of its account', async () => {
    // Scenario: the load is held; the account is invalidated; the old value arrives and is
    // returned to its caller but not stored, so the next read loads the new one.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const held = deferred<SubscriptionSnapshot | null>()
    const reading = cache.read(ACCOUNT, () => held.promise)
    await flush()
    await cache.invalidate(ACCOUNT)
    held.resolve(snapshotOf(ACCOUNT, 'old'))
    expect((await reading)?.sourceCustomer?.id).toBe('old')
    expect(host.sets).toEqual([])
    const next = await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT, 'new')))
    expect(next?.sourceCustomer?.id).toBe('new')
  })

  it('does not cache a value whose read began before an invalidation that landed during the cache lookup', async () => {
    // Scenario: the host cache's get is held; the invalidation arrives meanwhile.
    const gate = deferred<string | null>()
    const host = { ...mapCache(), get: () => gate.promise }
    const sets: string[] = []
    host.set = (key) => {
      sets.push(key)
      return Promise.resolve()
    }
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const reading = cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    await flush()
    await cache.invalidate(ACCOUNT)
    gate.resolve(null)
    await reading
    expect(sets).toEqual([])
  })

  it('still caches a value loaded while another account was invalidated', async () => {
    // Scenario: the invalidation names a different account.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const held = deferred<SubscriptionSnapshot | null>()
    const reading = cache.read(ACCOUNT, () => held.promise)
    await flush()
    await cache.invalidate({ accountId: 'acc-2' })
    held.resolve(snapshotOf(ACCOUNT))
    await reading
    expect(host.sets).toHaveLength(1)
  })

  it('marks every read in flight for the account when it is invalidated', async () => {
    // Scenario: two reads of one account are held; one invalidation keeps both out of the cache.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const first = deferred<SubscriptionSnapshot | null>()
    const second = deferred<SubscriptionSnapshot | null>()
    const reads = [
      cache.read(ACCOUNT, () => first.promise),
      cache.read(ACCOUNT, () => second.promise)
    ]
    await flush()
    expect(cache.pendingLoads).toBe(2)
    expect(cache.pendingAccounts).toBe(1)
    await cache.invalidate(ACCOUNT)
    first.resolve(snapshotOf(ACCOUNT))
    second.resolve(snapshotOf(ACCOUNT))
    await Promise.all(reads)
    expect(host.sets).toEqual([])
    expect(cache.pendingLoads).toBe(0)
    expect(cache.pendingAccounts).toBe(0)
  })

  it('keeps tracking an account while a second read of it is still in flight', async () => {
    // Scenario: the first of two reads finishes; an invalidation then still reaches the second.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    const first = deferred<SubscriptionSnapshot | null>()
    const second = deferred<SubscriptionSnapshot | null>()
    const firstRead = cache.read(ACCOUNT, () => first.promise)
    const secondRead = cache.read(ACCOUNT, () => second.promise)
    await flush()
    first.resolve(snapshotOf(ACCOUNT, 'first'))
    await firstRead
    expect(cache.pendingAccounts).toBe(1)
    expect(cache.pendingLoads).toBe(1)
    await cache.invalidate(ACCOUNT)
    second.resolve(snapshotOf(ACCOUNT, 'second'))
    await secondRead
    expect(host.sets).toHaveLength(1)
    expect(JSON.parse(host.sets[0]?.value ?? '{}').sourceCustomer.id).toBe('first')
  })

  it('keeps no record of a read once it has finished, however it finished', async () => {
    // Scenario: a hit, a fill and a failing load leave nothing behind.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    await cache.read(ACCOUNT, () => Promise.reject(new Error('x'))).catch(() => undefined)
    expect(cache.pendingLoads).toBe(0)
    expect(cache.pendingAccounts).toBe(0)
  })

  it('refuses a blank account identifier as invalid input', async () => {
    // Scenario: the key cannot be built, so neither method touches the host cache.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
    await expect(cache.read({ accountId: ' ' }, () => Promise.resolve(null))).rejects.toMatchObject(
      {
        code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
      }
    )
    await expect(cache.invalidate({ accountId: ' ' })).rejects.toMatchObject({
      code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT
    })
    expect(host.sets).toEqual([])
    expect(host.deletes).toEqual([])
  })
})
