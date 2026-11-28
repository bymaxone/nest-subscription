/**
 * @fileoverview A store wrapper a test can switch to failing, so a host can test how its own
 * code and the library's guard behave when the store is down. Test support: it is not a store to
 * run in production.
 * @layer testing
 */
import type {
  KeyPage,
  StoredSnapshot,
  SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import type { SubscriptionChange, SubscriptionSnapshot } from '@bymax-one/nest-subscription/shared'

/** The name of a method of the store port. */
export type FailingStoreMethod = keyof SubscriptionStore

/** A store that delegates to another until a test tells it to fail. */
export interface FailingStore extends SubscriptionStore {
  /**
   * Makes the named methods reject, or every method when none is named, until {@link recover}.
   * Naming `putSnapshot` also fails `replaceSnapshot`.
   * A second call replaces the first. The rejection is `error` when given, and otherwise an
   * `Error` whose message is `failing store: <method>` and holds no argument of the call.
   */
  fail(methods?: readonly FailingStoreMethod[], error?: unknown): void
  /** Makes every method delegate again. */
  recover(): void
}

/** Every method of the port: what `fail` names when it is given no names. */
const ALL_METHODS: readonly FailingStoreMethod[] = [
  'getSnapshot',
  'putSnapshot',
  'replaceSnapshot',
  'clearPendingChanges',
  'listKeysWithPendingChanges',
  'markEventProcessed',
  'forgetEvent',
  'deleteEventsOlderThan',
  'listStaleKeys'
]

/** The wrapper: each method checks the failing set, then reaches the wrapped store. */
class Switchable implements FailingStore {
  #failing: ReadonlySet<FailingStoreMethod> = new Set()
  #failure: unknown

  /** Present only when the wrapped store has it, so the wrapper offers what that store offers. */
  replaceSnapshot?: NonNullable<SubscriptionStore['replaceSnapshot']>

  constructor(private readonly store: SubscriptionStore) {
    const replace = store.replaceSnapshot?.bind(store)
    if (replace !== undefined) {
      // A conditional write is a write, so naming `putSnapshot` fails it too.
      this.replaceSnapshot = (...write): Promise<boolean> =>
        this.#through(this.#failing.has('putSnapshot') ? 'putSnapshot' : 'replaceSnapshot', () =>
          replace(...write)
        )
    }
  }

  fail(methods?: readonly FailingStoreMethod[], error?: unknown): void {
    this.#failing = new Set(methods ?? ALL_METHODS)
    this.#failure = error
  }

  recover(): void {
    this.#failing = new Set()
    this.#failure = undefined
  }

  getSnapshot(key: string): Promise<StoredSnapshot | null> {
    return this.#through('getSnapshot', () => this.store.getSnapshot(key))
  }

  putSnapshot(
    key: string,
    snapshot: SubscriptionSnapshot,
    pendingChanges: readonly SubscriptionChange[],
    sourceUpdatedAt: string
  ): Promise<boolean> {
    return this.#through('putSnapshot', () =>
      this.store.putSnapshot(key, snapshot, pendingChanges, sourceUpdatedAt)
    )
  }

  clearPendingChanges(key: string, changeKeys: readonly string[]): Promise<void> {
    return this.#through('clearPendingChanges', () =>
      this.store.clearPendingChanges(key, changeKeys)
    )
  }

  listKeysWithPendingChanges(limit: number, cursor: string | null): Promise<KeyPage> {
    return this.#through('listKeysWithPendingChanges', () =>
      this.store.listKeysWithPendingChanges(limit, cursor)
    )
  }

  markEventProcessed(source: string, eventId: string, receivedAt: string): Promise<boolean> {
    return this.#through('markEventProcessed', () =>
      this.store.markEventProcessed(source, eventId, receivedAt)
    )
  }

  forgetEvent(source: string, eventId: string): Promise<void> {
    return this.#through('forgetEvent', () => this.store.forgetEvent(source, eventId))
  }

  deleteEventsOlderThan(instant: string): Promise<void> {
    return this.#through('deleteEventsOlderThan', () => this.store.deleteEventsOlderThan(instant))
  }

  listStaleKeys(olderThan: string, limit: number, cursor: string | null): Promise<KeyPage> {
    return this.#through('listStaleKeys', () => this.store.listStaleKeys(olderThan, limit, cursor))
  }

  /** Rejects when the method is failing; otherwise calls through, rejecting if the call throws. */
  async #through<T>(method: FailingStoreMethod, call: () => Promise<T>): Promise<T> {
    if (this.#failing.has(method)) throw this.#failure ?? new Error(`failing store: ${method}`)
    return call()
  }
}

/**
 * Wraps a store. Until `fail` is called every method reaches the wrapped store unchanged. Every
 * method returns a promise, also when the wrapped one throws before it returns one.
 */
export function createFailingStore(store: SubscriptionStore): FailingStore {
  return new Switchable(store)
}
