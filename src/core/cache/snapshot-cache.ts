/**
 * @fileoverview The read-through cache in front of the store. It wraps the cache the host
 * provides, holds only snapshots the store returned, and never lets a failure of the host's cache
 * fail a read or a write.
 * @layer core
 */
import {
  encodeAccountKey,
  type AccountReference,
  type Clock
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import type { ObserverBridge } from '../observer/observer-bridge'
import type { SubscriptionCache } from '../options/subscription-options.types'
import { isSnapshotFor } from '../snapshot-fit'
import { timerWait, withDeadline } from '../webhook/deadline'

/** The fixed prefix of every key this library writes to the host's cache. */
const KEY_PREFIX = 'subscription:snapshot:'

/** How long a lookup or a delete of the host's cache is waited for, in milliseconds. */
export const CACHE_CALL_TIMEOUT_MS = 1000

/** The answer of one call to the host's cache; it rejects when the call has not answered in time. */
async function bounded<T>(call: Promise<T>): Promise<T> {
  const result = await withDeadline(Promise.resolve(call), CACHE_CALL_TIMEOUT_MS, timerWait)
  if (result.timedOut) throw new Error('the cache did not answer in time')
  return result.value
}

/** A read in flight, which an invalidation of its account marks as out of date. */
interface Ticket {
  invalidated: boolean
  /** Whether this read has started writing its value to the cache. */
  filling: boolean
  /** The key of the account the read is for. */
  readonly accountKey: string
  /** Every read in flight for that account, this one included. */
  readonly peers: Set<Ticket>
}

/** The text a cache holds parsed, or `undefined` when it is not JSON. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A read-through cache of snapshots. A cache that is down, full or answering with something that
 * is not a snapshot is a miss, so the store answers instead. While this process holds a fill that
 * an invalidation overtook, reads of that account go to the store until the fill has removed its
 * entry, and so do reads of an account after a delete of its entry failed, for one entry lifetime
 * on the injected clock; another process can see an entry for as long as its removal takes.
 */
export class SnapshotCache {
  readonly #pending = new Map<string, Set<Ticket>>()
  /** Accounts whose entry may still be in the host cache after a failed delete, and until when. */
  readonly #blocked = new Map<string, number>()
  #reading = 0

  /**
   * @param cache The cache the host provided.
   * @param ttlMs How long an entry lives, in milliseconds.
   * @param clock The time source that measures how long a failed delete keeps an account off the cache.
   * @param observer Told whether a lookup hit or missed; a no-op when the host set no observer.
   */
  constructor(
    private readonly cache: SubscriptionCache,
    private readonly ttlMs: number,
    private readonly clock: Clock,
    private readonly observer: ObserverBridge
  ) {}

  /** The number of reads that have not finished. */
  get pendingLoads(): number {
    return this.#reading
  }

  /** The number of accounts kept off the cache after a failed delete. */
  get blockedAccounts(): number {
    return this.#blocked.size
  }

  /** The number of accounts with a read that has not finished. */
  get pendingAccounts(): number {
    return this.#pending.size
  }

  /**
   * Answers from the cache when it holds the account, and otherwise from `load`, filling the cache
   * with what `load` returned. A lookup that overlapped an invalidation of the account counts as
   * a miss, and a value loaded before one is returned but not stored, so it is never undone. A `load` that
   * rejects rejects the read. The fill is written after the read has answered and the read does
   * not wait for it, so a host cache that is slow or never answers delays nothing.
   *
   * @param account The account, as the caller named it.
   * @param load Reads the snapshot from the store; `null` when none is stored.
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier.
   */
  async read(
    account: AccountReference,
    load: () => Promise<SubscriptionSnapshot | null>
  ): Promise<SubscriptionSnapshot | null> {
    const accountKey = encodeAccountKey(account)
    const key = `${KEY_PREFIX}${accountKey}`
    if (this.#overtaken(accountKey) || this.#blockedNow(accountKey)) return load()
    const ticket = this.#open(accountKey)
    try {
      const cached = await this.#get(key, account)
      if (cached !== null && !ticket.invalidated) {
        this.observer.cacheLookup('hit')
        return cached
      }
      this.observer.cacheLookup('miss')
      const loaded = await load()
      if (loaded !== null && !ticket.invalidated) {
        ticket.filling = true
        void this.#fill(key, loaded, ticket)
      }
      return loaded
    } finally {
      if (!ticket.filling) this.#close(ticket)
    }
  }

  /**
   * Removes the account's entry and marks every read of it in flight, so none fills the cache
   * with what it read before the change. A fill whose write was already started is not waited
   * for: it removes its own entry when its write settles, so an invalidation is never undone by a
   * write that lands after it, and reads in this process bypass the cache until it has. A delete
   * that fails keeps the account off the cache until the entry's lifetime has passed.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier.
   */
  async invalidate(account: AccountReference): Promise<void> {
    const accountKey = encodeAccountKey(account)
    for (const ticket of this.#pending.get(accountKey) ?? []) ticket.invalidated = true
    await this.#delete(accountKey)
  }

  /**
   * Whether this process holds a fill of the account that an invalidation overtook and whose
   * cleanup has not settled. Until then the entry may hold a value from before the invalidation.
   */
  #overtaken(accountKey: string): boolean {
    return [...(this.#pending.get(accountKey) ?? [])].some(
      (ticket) => ticket.filling && ticket.invalidated
    )
  }

  /** Registers a read in flight for an account. */
  #open(accountKey: string): Ticket {
    const peers = this.#pending.get(accountKey) ?? new Set<Ticket>()
    const ticket: Ticket = { invalidated: false, filling: false, accountKey, peers }
    peers.add(ticket)
    this.#reading += 1
    this.#pending.set(accountKey, peers)
    return ticket
  }

  /** Forgets a read, and the account's set once it holds none. */
  #close(ticket: Ticket): void {
    ticket.peers.delete(ticket)
    this.#reading -= 1
    if (ticket.peers.size === 0) this.#pending.delete(ticket.accountKey)
  }

  /**
   * The cached snapshot, or `null` on a miss, a failing or silent cache, a value that is not a
   * snapshot, or a snapshot of another account or tenant than the one asked for.
   */
  async #get(key: string, account: AccountReference): Promise<SubscriptionSnapshot | null> {
    try {
      const text = await bounded(this.cache.get(key))
      const parsed = text === null ? undefined : parse(text)
      return isSnapshotFor(parsed, account) ? parsed : null
    } catch {
      return null
    }
  }

  /**
   * Writes a snapshot and then forgets the read it belongs to. When the account was invalidated
   * while the write was in flight, the entry the write left is removed. It never rejects.
   */
  async #fill(key: string, snapshot: SubscriptionSnapshot, ticket: Ticket): Promise<void> {
    try {
      await this.cache.set(key, JSON.stringify(snapshot), this.ttlMs)
    } catch {
      // The next read loads from the store again.
    }
    if (ticket.invalidated) await this.#delete(ticket.accountKey)
    this.#close(ticket)
  }

  /**
   * Removes an account's entry. A delete that fails, or has not answered in time, keeps the account off the cache for one entry
   * lifetime from now, since the entry cannot outlive that; a delete that succeeds ends it. Every
   * delete drops the marks that have run out.
   */
  async #delete(accountKey: string): Promise<void> {
    let failed = false
    try {
      await bounded(this.cache.delete(`${KEY_PREFIX}${accountKey}`))
    } catch {
      failed = true
    }
    const now = this.clock.now().getTime()
    for (const [other, until] of this.#blocked) if (until <= now) this.#blocked.delete(other)
    if (failed) this.#blocked.set(accountKey, now + this.ttlMs)
    else this.#blocked.delete(accountKey)
  }

  /** Whether a failed delete still keeps the account off the cache; a mark that ran out is dropped. */
  #blockedNow(accountKey: string): boolean {
    const until = this.#blocked.get(accountKey)
    if (until === undefined) return false
    if (until > this.clock.now().getTime()) return true
    this.#blocked.delete(accountKey)
    return false
  }
}
