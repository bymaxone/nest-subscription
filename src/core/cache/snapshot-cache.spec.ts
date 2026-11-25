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

/** A held call of the controlled host cache. */
interface Hold {
  /** Applies the held write to the entries without settling the call. */
  apply: () => void
  /** Settles the held call successfully, applying the write first when it was not applied. */
  land: () => void
  fail: () => void
  answer: (value: string | null) => void
}

/** A host cache that applies a write when its held `set` is released, and can hold or fail calls. */
class ControlledCache implements SubscriptionCache {
  readonly entries = new Map<string, string>()
  readonly #setHolds: Hold[] = []
  readonly #getHolds: Hold[] = []
  readonly #deleteHolds: Hold[] = []
  #gets = 0
  #deleting = true
  #deleted = 0

  /** The number of deletes asked of the cache. */
  deletes(): number {
    return this.#deleted
  }

  /** Holds the next `set`; `land` writes it and settles it, `fail` rejects it. */
  holdNextSet(): Hold {
    return this.#hold(this.#setHolds)
  }

  /** Holds the next `get`; `answer` settles it with the given text. */
  holdNextGet(): Hold {
    return this.#hold(this.#getHolds)
  }

  /** Holds the next `delete`; `land` removes the entry and settles it. */
  holdNextDelete(): Hold {
    return this.#hold(this.#deleteHolds)
  }

  /** The number of lookups asked of the cache. */
  gets(): number {
    return this.#gets
  }

  /** Makes every later `delete` reject. */
  failDeletes(): void {
    this.#deleting = false
  }

  get(key: string): Promise<string | null> {
    this.#gets += 1
    const hold = this.#getHolds.shift()
    if (hold === undefined) return Promise.resolve(this.entries.get(key) ?? null)
    return new Promise<string | null>((resolve) => {
      hold.answer = resolve
    })
  }

  set(key: string, value: string): Promise<void> {
    const hold = this.#setHolds.shift()
    if (hold === undefined) {
      this.entries.set(key, value)
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      hold.apply = () => this.entries.set(key, value)
      hold.land = () => {
        hold.apply()
        resolve()
      }
      hold.fail = () => reject(new Error('cache set failed'))
    })
  }

  delete(key: string): Promise<void> {
    this.#deleted += 1
    if (!this.#deleting) return Promise.reject(new Error('cache delete failed'))
    const hold = this.#deleteHolds.shift()
    if (hold === undefined) {
      this.entries.delete(key)
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      hold.land = () => {
        this.entries.delete(key)
        resolve()
      }
    })
  }

  #hold(queue: Hold[]): Hold {
    const hold: Hold = {
      apply: () => undefined,
      land: () => undefined,
      fail: () => undefined,
      answer: () => undefined
    }
    queue.push(hold)
    return hold
  }
}

describe('SnapshotCache', () => {
  it('loads on a miss, fills the cache and answers the second read without loading', async () => {
    // Scenario: two reads of one account; the load runs once.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
    const load = jest.fn(() => Promise.resolve(snapshotOf(ACCOUNT)))
    expect(await cache.read(ACCOUNT, load)).toEqual(snapshotOf(ACCOUNT))
    expect(await cache.read(ACCOUNT, load)).toEqual(snapshotOf(ACCOUNT))
    expect(load).toHaveBeenCalledTimes(1)
    expect(host.sets).toHaveLength(1)
  })

  it('stores the snapshot as JSON under a fixed prefix and the account key, for the lifetime it was given', async () => {
    // Scenario: the key is the prefix and the encoded account key, nothing built by hand.
    const host = mapCache()
    await new SnapshotCache(host, TTL_MS).read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    expect(host.sets[0]).toEqual({
      key: `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`,
      value: JSON.stringify(snapshotOf(ACCOUNT)),
      ttlMs: TTL_MS
    })
  })

  it('stores for the lifetime it was given', async () => {
    // Scenario: a cache built with its own lifetime.
    const host = mapCache()
    await new SnapshotCache(host, 1234).read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    expect(host.sets[0]?.ttlMs).toBe(1234)
  })

  it('does not cache an account with nothing to load', async () => {
    // Scenario: the load finds no snapshot; nothing is stored and the next read loads again.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
    const load = jest.fn(() => Promise.resolve(null))
    expect(await cache.read(ACCOUNT, load)).toBeNull()
    await cache.read(ACCOUNT, load)
    expect(host.sets).toEqual([])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('loads again after the account is invalidated and deletes the key it filled', async () => {
    // Scenario: a hit, an invalidation, then a read that loads the new value.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT, 'old')))
    await cache.invalidate(ACCOUNT)
    expect(host.deletes).toEqual([`subscription:snapshot:${encodeAccountKey(ACCOUNT)}`])
    const fresh = await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT, 'new')))
    expect(fresh?.sourceCustomer?.id).toBe('new')
  })

  it('keeps two tenants of one account identifier apart', async () => {
    // Scenario: the same account identifier under two tenants fills two entries.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const result = await new SnapshotCache(host, TTL_MS).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(result).toEqual(snapshotOf(ACCOUNT))
  })

  it('answers when set throws', async () => {
    // Scenario: the host cache cannot be written.
    const host = { ...mapCache(), set: () => Promise.reject(new Error('cache full')) }
    const result = await new SnapshotCache(host, TTL_MS).read(ACCOUNT, () =>
      Promise.resolve(snapshotOf(ACCOUNT))
    )
    expect(result).toEqual(snapshotOf(ACCOUNT))
  })

  it('does not throw when delete throws', async () => {
    // Scenario: the host cache cannot delete.
    const host = { ...mapCache(), delete: () => Promise.reject(new Error('cache down')) }
    await expect(new SnapshotCache(host, TTL_MS).invalidate(ACCOUNT)).resolves.toBeUndefined()
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
    const result = await new SnapshotCache(host, TTL_MS).read(ACCOUNT, load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(result?.sourceCustomer?.id).toBe('loaded')
  })

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
      const result = await new SnapshotCache(host, TTL_MS).read(ACCOUNT, load)
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
      await new SnapshotCache(host, TTL_MS).read(asked, load)
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
    const result = await new SnapshotCache(host, TTL_MS).read(asked, load)
    expect(result?.sourceCustomer?.id).toBe('cached')
    expect(load).not.toHaveBeenCalled()
  })

  it('lets a failing load reject the read, since nothing else can answer it', async () => {
    // Scenario: the store behind the load fails; the cache does not hide it, and leaves no entry.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
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
    const cache = new SnapshotCache(host, TTL_MS)
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    await cache.read(ACCOUNT, () => Promise.resolve(snapshotOf(ACCOUNT)))
    await cache.read(ACCOUNT, () => Promise.reject(new Error('x'))).catch(() => undefined)
    expect(cache.pendingLoads).toBe(0)
    expect(cache.pendingAccounts).toBe(0)
  })

  it('refuses a blank account identifier as invalid input', async () => {
    // Scenario: the key cannot be built, so neither method touches the host cache.
    const host = mapCache()
    const cache = new SnapshotCache(host, TTL_MS)
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

  describe('with a host cache whose calls settle when the test says', () => {
    const controlled = (): ControlledCache => new ControlledCache()

    const KEY = `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`
    const OLD = (): SubscriptionSnapshot => snapshotOf(ACCOUNT, 'old')
    const NEW = (): SubscriptionSnapshot => snapshotOf(ACCOUNT, 'new')

    it('does not leave a fill in the cache that was still being written when its account was invalidated', async () => {
      // Scenario: the read misses and loads the old value; its set is held by the host cache; the
      // account is invalidated and the invalidation completes; the held set then lands.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      set.land()
      await flush()
      await reading
      expect(host.entries.get(KEY)).toBeUndefined()
      const next = await cache.read(ACCOUNT, () => Promise.resolve(NEW()))
      expect(next?.sourceCustomer?.id).toBe('new')
    })

    it('reaches the store, not the cache, while an overtaken fill is written and cleaned up', async () => {
      // Scenario: the fill's set is held; the account is invalidated; the host applies the write
      // before the set resolves, and its cleanup delete is held too. Every read in that interval
      // goes to the store and returns the new snapshot, with no lookup and no new fill; afterwards
      // the cache is used again.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      const cleanup = host.holdNextDelete()
      set.apply()
      expect(host.entries.get(KEY)).toContain('"old"')
      const lookups = host.gets()
      const load = jest.fn(() => Promise.resolve(NEW()))
      expect((await cache.read(ACCOUNT, load))?.sourceCustomer?.id).toBe('new')
      set.land()
      await flush()
      expect((await cache.read(ACCOUNT, load))?.sourceCustomer?.id).toBe('new')
      expect(load).toHaveBeenCalledTimes(2)
      expect(host.gets()).toBe(lookups)
      cleanup.land()
      await flush()
      await reading
      expect(host.entries.size).toBe(0)
      await cache.read(ACCOUNT, load)
      await flush()
      await cache.read(ACCOUNT, load)
      expect(load).toHaveBeenCalledTimes(3)
    })

    it('still looks in the cache while a fill is in flight that no invalidation overtook, and while an overtaken read has not started filling', async () => {
      // Scenario: a fill is held with no invalidation; a second read looks in the cache. Then a
      // read still loading is invalidated; a read after it also looks in the cache.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      host.holdNextSet()
      await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      const before = host.gets()
      await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      expect(host.gets()).toBe(before + 1)
      const other: AccountReference = { accountId: 'acc-3' }
      let finish!: (value: SubscriptionSnapshot | null) => void
      const loading = cache.read(
        other,
        () => new Promise<SubscriptionSnapshot | null>((resolve) => (finish = resolve))
      )
      await flush()
      await cache.invalidate(other)
      const lookups = host.gets()
      await cache.read(other, () => Promise.resolve(null))
      expect(host.gets()).toBe(lookups + 1)
      finish(null)
      await loading
    })

    it('answers a read that is not behind an overtaken fill from the cache as usual', async () => {
      // Scenario: a fill of one account is overtaken; a read of another account is served from its
      // own entry.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const other: AccountReference = { accountId: 'acc-2' }
      await cache.read(other, () => Promise.resolve(snapshotOf(other, 'two')))
      await flush()
      host.holdNextSet()
      void cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      const load = jest.fn(() => Promise.resolve(null))
      expect((await cache.read(other, load))?.sourceCustomer?.id).toBe('two')
      expect(load).not.toHaveBeenCalled()
    })

    it('answers the read at once and does not wait for a set that never settles', async () => {
      // Scenario: the host cache's set is held and never released; the read and an invalidation
      // both resolve.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      host.holdNextSet()
      const result = await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      expect(result?.sourceCustomer?.id).toBe('old')
      await expect(cache.invalidate(ACCOUNT)).resolves.toBeUndefined()
    })

    it('leaves nothing and fails nothing when the set that was in flight at an invalidation rejects', async () => {
      // Scenario: the held set fails after the account was invalidated.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      set.fail()
      await flush()
      await expect(reading).resolves.toBeDefined()
      expect(host.entries.size).toBe(0)
      expect(cache.pendingLoads).toBe(0)
    })

    it('tries to remove a late write even when the invalidation itself could not delete, and fails nothing', async () => {
      // Scenario: every delete rejects; the held set lands after the invalidation; the fill's own
      // delete is tried (two deletes in all) and no call fails.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      host.failDeletes()
      await expect(cache.invalidate(ACCOUNT)).resolves.toBeUndefined()
      set.land()
      await flush()
      await expect(reading).resolves.toBeDefined()
      expect(host.deletes()).toBe(2)
    })

    it('does not serve the old value when an older fill lands after a newer fill did', async () => {
      // Scenario: fill A (old) is held; the account is invalidated; read B fills the new value;
      // A lands last. The next read answers the new value.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const first = host.holdNextSet()
      const readA = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      await cache.read(ACCOUNT, () => Promise.resolve(NEW()))
      first.land()
      await flush()
      await readA
      const after = await cache.read(ACCOUNT, () => Promise.resolve(NEW()))
      expect(after?.sourceCustomer?.id).toBe('new')
    })

    it('cleans up after every fill that was in flight at an invalidation', async () => {
      // Scenario: two fills of one account are held; one invalidation; both land.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const first = host.holdNextSet()
      const second = host.holdNextSet()
      const readA = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      const readB = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate(ACCOUNT)
      first.land()
      second.land()
      await flush()
      await Promise.all([readA, readB])
      expect(host.entries.size).toBe(0)
      expect(cache.pendingLoads).toBe(0)
    })

    it('answers a read whose cache lookup began before an invalidation without filling the cache with it', async () => {
      // Scenario: the lookup is held and returns the old entry after the invalidation.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const lookup = host.holdNextGet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(NEW()))
      await flush()
      await cache.invalidate(ACCOUNT)
      lookup.answer(JSON.stringify(OLD()))
      await reading
      expect(host.entries.size).toBe(0)
      const next = await cache.read(ACCOUNT, () => Promise.resolve(NEW()))
      expect(next?.sourceCustomer?.id).toBe('new')
    })

    it('keeps the fill of an account it was not asked to invalidate', async () => {
      // Scenario: a held fill of one account lands after another account was invalidated.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      await flush()
      await cache.invalidate({ accountId: 'acc-2' })
      set.land()
      await flush()
      await reading
      expect(host.entries.has(KEY)).toBe(true)
    })

    it('keeps the account tracked while a fill is still being written, and forgets it when it settles', async () => {
      // Scenario: the read has answered; its set is held; then it lands.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS)
      const set = host.holdNextSet()
      await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      expect(cache.pendingAccounts).toBe(1)
      set.land()
      await flush()
      expect(cache.pendingAccounts).toBe(0)
      expect(cache.pendingLoads).toBe(0)
    })
  })
})
