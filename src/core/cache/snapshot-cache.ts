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

import type { SubscriptionCache } from '../options/subscription-options.types'

/** The fixed prefix of every key this library writes to the host's cache. */
const KEY_PREFIX = 'subscription:snapshot:'

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

/** Whether a parsed value has the fields the library reads from a snapshot. */
function isSnapshot(value: unknown): value is SubscriptionSnapshot {
  // `Object` wraps a primitive and turns `null` into an empty object, so a value that is not an
  // object has none of the fields below and is refused with them.
  const candidate: Record<string, unknown> = Object(value)
  return (
    typeof candidate['source'] === 'string' &&
    typeof candidate['fetchedAt'] === 'string' &&
    Array.isArray(candidate['entitlements']) &&
    Array.isArray(candidate['subscriptions'])
  )
}

/** Whether a snapshot belongs to the account: the same identifier and the same tenant, or none. */
function namesAccount(snapshot: SubscriptionSnapshot, account: AccountReference): boolean {
  return snapshot.accountId === account.accountId && snapshot.tenantId === account.tenantId
}

/** The snapshot a cached string holds, or `null` when it holds anything else. */
function parse(text: string): SubscriptionSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return isSnapshot(parsed) ? parsed : null
  } catch {
    return null
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
   */
  constructor(
    private readonly cache: SubscriptionCache,
    private readonly ttlMs: number,
    private readonly clock: Clock
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
   * with what `load` returned. A value loaded before an invalidation of the same account is
   * returned to its caller but not stored, so the invalidation is never undone. A `load` that
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
      if (cached !== null) return cached
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
   * The cached snapshot, or `null` on a miss, a failing cache, a value that is not a snapshot, or
   * a snapshot of another account or tenant than the one asked for.
   */
  async #get(key: string, account: AccountReference): Promise<SubscriptionSnapshot | null> {
    try {
      const text = await this.cache.get(key)
      const snapshot = text === null ? null : parse(text)
      return snapshot !== null && namesAccount(snapshot, account) ? snapshot : null
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
   * Removes an account's entry. A delete that fails keeps the account off the cache for one entry
   * lifetime from now, since the entry cannot outlive that; a delete that succeeds ends it.
   */
  async #delete(accountKey: string): Promise<void> {
    try {
      await this.cache.delete(`${KEY_PREFIX}${accountKey}`)
      this.#blocked.delete(accountKey)
    } catch {
      const now = this.clock.now().getTime()
      for (const [other, until] of this.#blocked) if (until <= now) this.#blocked.delete(other)
      this.#blocked.set(accountKey, now + this.ttlMs)
    }
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
