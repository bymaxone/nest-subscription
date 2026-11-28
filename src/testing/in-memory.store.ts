/**
 * @fileoverview An in-memory implementation of the store port for tests and development. It is not
 * for production: nothing is persisted, and a second process sees nothing of the first.
 * @layer testing
 */
import {
  SubscriptionError,
  type KeyPage,
  type StoredSnapshot,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  parseInstant,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

/** Options of {@link InMemorySubscriptionStore}. */
export interface InMemoryStoreOptions {
  /**
   * Receives the one warning the store gives at construction, that it is not for production.
   * Defaults to a process warning; pass a function to keep a test run quiet or to capture it.
   */
  readonly logger?: (message: string) => void
}

/** What is held for one key. */
interface Entry {
  readonly snapshot: SubscriptionSnapshot
  /** The instant the source says the state is as of, in milliseconds. */
  readonly orderedAt: number
  /** The changes not yet cleared, oldest first. */
  readonly pending: readonly SubscriptionChange[]
}

/** An independent copy of a stored value. Values are plain data, so a JSON round trip copies them. */
function copy<T>(value: T): T {
  const duplicate: T = JSON.parse(JSON.stringify(value))
  return duplicate
}

/** The message of the construction warning. */
const NOT_FOR_PRODUCTION =
  'InMemorySubscriptionStore is for tests and development only and is not for production: it ' +
  'persists nothing and shares nothing between processes.'

/** A page limit is a positive integer. */
function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
}

/** The keys after `cursor`, in key order, at most `limit` of them, with the cursor to go on. */
function pageOf(sortedKeys: readonly string[], limit: number, cursor: string | null): KeyPage {
  checkLimit(limit)
  const rest = cursor === null ? sortedKeys : sortedKeys.filter((key) => key > cursor)
  const keys = rest.slice(0, limit)
  const last = rest.length > limit ? keys.slice(-1)[0] : undefined
  return { keys, nextCursor: last ?? null }
}

/**
 * A `Map`-backed store. Every method runs to completion before another starts, so each write is
 * atomic and concurrent calls are ordered as the port requires. Values are copied on the way in
 * and out, so a caller that changes an object it passed or received changes nothing stored.
 */
export class InMemorySubscriptionStore implements SubscriptionStore {
  readonly #entries = new Map<string, Entry>()
  readonly #events = new Map<string, Map<string, number>>()

  /** Warns once, through the logger, that the store is not for production. */
  constructor(options: InMemoryStoreOptions = {}) {
    const logger =
      options.logger ??
      ((message: string): void => process.emitWarning(message, 'SubscriptionWarning'))
    logger(NOT_FOR_PRODUCTION)
  }

  async getSnapshot(key: string): Promise<StoredSnapshot | null> {
    const entry = this.#entries.get(key)
    return entry === undefined
      ? null
      : copy({ snapshot: entry.snapshot, pendingChanges: entry.pending })
  }

  async putSnapshot(
    key: string,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean> {
    const orderedAt = parseInstant(sourceUpdatedAt)
    // A snapshot whose fetch instant cannot be read would make every later stale listing fail.
    parseInstant(snapshot.fetchedAt)
    const existing = this.#entries.get(key)
    if (existing !== undefined && orderedAt < existing.orderedAt) {
      return false
    }
    const pending = [...(existing?.pending ?? [])]
    for (const change of pendingChanges) {
      if (!pending.some((held) => held.key === change.key)) pending.push(copy(change))
    }
    this.#entries.set(key, { snapshot: copy(snapshot), orderedAt, pending })
    return true
  }

  async replaceSnapshot(
    key: string,
    expectedFetchedAt: string | null,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean> {
    const stored = this.#entries.get(key)?.snapshot.fetchedAt
    const unchanged =
      expectedFetchedAt === null
        ? stored === undefined
        : stored !== undefined && parseInstant(stored) === parseInstant(expectedFetchedAt)
    // Nothing runs between the check and the write: the write starts before the first await.
    return unchanged && this.putSnapshot(key, snapshot, pendingChanges, sourceUpdatedAt)
  }

  async clearPendingChanges(key: string, changeKeys: readonly string[]): Promise<void> {
    const entry = this.#entries.get(key)
    if (entry !== undefined) {
      const cleared = new Set(changeKeys)
      this.#entries.set(key, {
        ...entry,
        pending: entry.pending.filter((change) => !cleared.has(change.key))
      })
    }
  }

  async listKeysWithPendingChanges(limit: number, cursor: string | null): Promise<KeyPage> {
    const keys = [...this.#entries]
      .filter(([, entry]) => entry.pending.length > 0)
      .map(([key]) => key)
      .sort()
    return pageOf(keys, limit, cursor)
  }

  async markEventProcessed(source: string, eventId: string, receivedAt: string): Promise<boolean> {
    const received = parseInstant(receivedAt)
    const events = this.#events.get(source) ?? new Map<string, number>()
    this.#events.set(source, events)
    if (events.has(eventId)) {
      return false
    }
    events.set(eventId, received)
    return true
  }

  async forgetEvent(source: string, eventId: string): Promise<void> {
    this.#events.get(source)?.delete(eventId)
  }

  async deleteEventsOlderThan(instant: string): Promise<void> {
    const threshold = parseInstant(instant)
    for (const events of this.#events.values()) {
      for (const [eventId, received] of events) {
        if (received < threshold) events.delete(eventId)
      }
    }
  }

  async listStaleKeys(olderThan: string, limit: number, cursor: string | null): Promise<KeyPage> {
    const threshold = parseInstant(olderThan)
    const keys = [...this.#entries]
      .filter(([, entry]) => parseInstant(entry.snapshot.fetchedAt) < threshold)
      .map(([key]) => key)
      .sort()
    return pageOf(keys, limit, cursor)
  }
}
