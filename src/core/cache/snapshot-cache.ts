/**
 * @fileoverview The read-through cache in front of the store. It wraps the cache the host
 * provides, holds only snapshots the store returned (which came from a read of the source), and
 * never lets a failure of the host's cache fail a read or a write.
 * @layer core
 */
import { encodeAccountKey, type AccountReference } from '@bymax-one/nest-subscription/internal'
import type { SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

import type { SubscriptionCache } from '../options/subscription-options.types'

/** How long an entry lives when the host does not say otherwise, in milliseconds. */
export const DEFAULT_CACHE_TTL_MS = 30_000

/** The fixed prefix of every key this library writes to the host's cache. */
const KEY_PREFIX = 'subscription:snapshot:'

/** A read in flight, which an invalidation of its account marks as out of date. */
interface Ticket {
  invalidated: boolean
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
    typeof candidate['accountId'] === 'string' &&
    typeof candidate['source'] === 'string' &&
    typeof candidate['fetchedAt'] === 'string' &&
    Array.isArray(candidate['entitlements']) &&
    Array.isArray(candidate['subscriptions'])
  )
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
 * is not a snapshot is a miss, so the store answers instead.
 */
export class SnapshotCache {
  readonly #pending = new Map<string, Set<Ticket>>()
  #reading = 0

  /**
   * @param cache The cache the host provided.
   * @param ttlMs How long an entry lives, in milliseconds.
   */
  constructor(
    private readonly cache: SubscriptionCache,
    private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS
  ) {}

  /** The number of reads that have not finished. */
  get pendingLoads(): number {
    return this.#reading
  }

  /** The number of accounts with a read that has not finished. */
  get pendingAccounts(): number {
    return this.#pending.size
  }

  /**
   * Answers from the cache when it holds the account, and otherwise from `load`, filling the cache
   * with what `load` returned. A value loaded before an invalidation of the same account is
   * returned to its caller but not stored, so the invalidation is never undone. A `load` that
   * rejects rejects the read.
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
    const ticket = this.#open(accountKey)
    try {
      const cached = await this.#get(key)
      if (cached !== null) return cached
      const loaded = await load()
      if (loaded !== null && !ticket.invalidated) await this.#set(key, loaded)
      return loaded
    } finally {
      this.#close(ticket)
    }
  }

  /**
   * Removes the account's entry and marks every read of it in flight, so none fills the cache
   * with what it read before the change. A cache that cannot delete leaves its entry to expire.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier.
   */
  async invalidate(account: AccountReference): Promise<void> {
    const accountKey = encodeAccountKey(account)
    for (const ticket of this.#pending.get(accountKey) ?? []) ticket.invalidated = true
    try {
      await this.cache.delete(`${KEY_PREFIX}${accountKey}`)
    } catch {
      // The entry expires with its lifetime; a failed delete never fails the write behind it.
    }
  }

  /** Registers a read in flight for an account. */
  #open(accountKey: string): Ticket {
    const peers = this.#pending.get(accountKey) ?? new Set<Ticket>()
    const ticket: Ticket = { invalidated: false, accountKey, peers }
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

  /** The cached snapshot, or `null` on a miss, a failing cache or a value that is not one. */
  async #get(key: string): Promise<SubscriptionSnapshot | null> {
    try {
      const text = await this.cache.get(key)
      return text === null ? null : parse(text)
    } catch {
      return null
    }
  }

  /** Stores a snapshot; a cache that cannot store is not an error. */
  async #set(key: string, snapshot: SubscriptionSnapshot): Promise<void> {
    try {
      await this.cache.set(key, JSON.stringify(snapshot), this.ttlMs)
    } catch {
      // The next read loads from the store again.
    }
  }
}
