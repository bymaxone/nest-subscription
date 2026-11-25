/**
 * @fileoverview Pins the order-dependent behaviour of the snapshot cache: fills, invalidations,
 * lookups and deletes of one account that settle in every order a host cache allows, and the
 * bypass that follows a fill an invalidation overtook or a delete that failed. A host cache the
 * test controls call by call stands in for the host's; time moves only on a manual clock.
 * @layer core
 */
import { encodeAccountKey, type AccountReference } from '@bymax-one/nest-subscription/internal'
import { createEmptySnapshot, type SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'
import { ManualClock } from '@bymax-one/nest-subscription/testing'

import type { SubscriptionCache } from '../options/subscription-options.types'
import { SnapshotCache } from './snapshot-cache'

const ACCOUNT: AccountReference = { accountId: 'acc-1' }
const TTL_MS = 30_000

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

  /** Makes every later `delete` reject, or succeed again with `false`. */
  failDeletes(failing = true): void {
    this.#deleting = !failing
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

describe('SnapshotCache interleavings', () => {
  describe('with a host cache whose calls settle when the test says', () => {
    const controlled = (): ControlledCache => new ControlledCache()

    const KEY = `subscription:snapshot:${encodeAccountKey(ACCOUNT)}`
    const OLD = (): SubscriptionSnapshot => snapshotOf(ACCOUNT, 'old')
    const NEW = (): SubscriptionSnapshot => snapshotOf(ACCOUNT, 'new')

    it('does not leave a fill in the cache that was still being written when its account was invalidated', async () => {
      // Scenario: the read misses and loads the old value; its set is held by the host cache; the
      // account is invalidated and the invalidation completes; the held set then lands.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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

    describe('after a delete that failed', () => {
      /** A cache over the controlled host with a clock the test moves. */
      function setup(): { host: ControlledCache; cache: SnapshotCache; clock: ManualClock } {
        const host = controlled()
        const clock = new ManualClock()
        return { host, cache: new SnapshotCache(host, TTL_MS, clock), clock }
      }

      /** Reads with a store that answers the new snapshot; returns the id it answered. */
      async function readNew(cache: SnapshotCache): Promise<string | undefined> {
        return (await cache.read(ACCOUNT, () => Promise.resolve(NEW())))?.sourceCustomer?.id
      }

      it('reads the store, with no lookup and no fill, until the entry lifetime has passed on the clock', async () => {
        // Scenario: an entry is cached; the invalidation's delete rejects, so the old entry stays.
        const { host, cache, clock } = setup()
        await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
        await flush()
        host.failDeletes()
        await cache.invalidate(ACCOUNT)
        expect(host.entries.get(KEY)).toContain('"old"')
        const lookups = host.gets()
        expect(await readNew(cache)).toBe('new')
        clock.advance(TTL_MS - 1)
        expect(await readNew(cache)).toBe('new')
        expect(host.gets()).toBe(lookups)
        expect(host.entries.get(KEY)).toContain('"old"')
        clock.advance(1)
        await readNew(cache)
        expect(host.gets()).toBe(lookups + 1)
      })

      it('does the same when the cleanup delete of an overtaken fill is the one that fails', async () => {
        // Scenario: the fill's set is held; the invalidation succeeds; the write lands; the cleanup
        // delete rejects, so the old entry stays.
        const { host, cache, clock } = setup()
        const set = host.holdNextSet()
        const reading = cache.read(ACCOUNT, () => Promise.resolve(OLD()))
        await flush()
        await cache.invalidate(ACCOUNT)
        host.failDeletes()
        set.land()
        await flush()
        await reading
        expect(host.entries.get(KEY)).toContain('"old"')
        const lookups = host.gets()
        expect(await readNew(cache)).toBe('new')
        clock.advance(TTL_MS - 1)
        expect(await readNew(cache)).toBe('new')
        expect(host.gets()).toBe(lookups)
        clock.advance(1)
        await readNew(cache)
        expect(host.gets()).toBe(lookups + 1)
      })

      it('uses the cache again at once when a later delete of the account succeeds', async () => {
        // Scenario: the first invalidation's delete rejects; the second succeeds.
        const { host, cache } = setup()
        await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
        await flush()
        host.failDeletes()
        await cache.invalidate(ACCOUNT)
        host.failDeletes(false)
        await cache.invalidate(ACCOUNT)
        const lookups = host.gets()
        await readNew(cache)
        expect(host.gets()).toBe(lookups + 1)
      })

      it('keeps another account on the cache', async () => {
        // Scenario: a failed delete of one account does not stop reads of another from looking up.
        const { host, cache } = setup()
        host.failDeletes()
        await cache.invalidate(ACCOUNT)
        const lookups = host.gets()
        await cache.read({ accountId: 'acc-2' }, () => Promise.resolve(null))
        expect(host.gets()).toBe(lookups + 1)
      })

      it('drops a mark whose lifetime has passed when it is next looked at, and prunes old marks on the next failed delete', async () => {
        // Scenario: three accounts fail a delete; after the lifetime a read of one drops its mark and
        // a new failed delete drops the rest.
        const { host, cache, clock } = setup()
        host.failDeletes()
        for (const id of ['a', 'b', 'c']) await cache.invalidate({ accountId: id })
        expect(cache.blockedAccounts).toBe(3)
        clock.advance(TTL_MS)
        await cache.read({ accountId: 'a' }, () => Promise.resolve(null))
        expect(cache.blockedAccounts).toBe(2)
        await cache.invalidate({ accountId: 'd' })
        expect(cache.blockedAccounts).toBe(1)
      })
    })

    it('answers the read at once and does not wait for a set that never settles', async () => {
      // Scenario: the host cache's set is held and never released; the read and an invalidation
      // both resolve.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
      host.holdNextSet()
      const result = await cache.read(ACCOUNT, () => Promise.resolve(OLD()))
      expect(result?.sourceCustomer?.id).toBe('old')
      await expect(cache.invalidate(ACCOUNT)).resolves.toBeUndefined()
    })

    it('leaves nothing and fails nothing when the set that was in flight at an invalidation rejects', async () => {
      // Scenario: the held set fails after the account was invalidated.
      const host = controlled()
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
      const cache = new SnapshotCache(host, TTL_MS, new ManualClock())
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
