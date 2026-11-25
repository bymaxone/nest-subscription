/**
 * @fileoverview The refresher: the one component that reads an account from the source and stores
 * the result. Concurrent refreshes of one account become one source call, and an older snapshot
 * never replaces a newer one.
 * @layer core
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE,
  SubscriptionError,
  encodeAccountKey,
  type AccountReference,
  type Clock,
  type SubscriptionSource,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import {
  SUBSCRIPTION_ERROR_CODES,
  parseInstant,
  type SubscriptionChange,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { SingleFlight } from './single-flight'
import { SnapshotCache } from '../cache/snapshot-cache'
import { ChangeDispatcher } from '../notifications/change-dispatcher'
import { diffSnapshots } from '../notifications/diff-snapshots'
import { ObserverBridge } from '../observer/observer-bridge'
import { isSnapshotFor } from '../snapshot-fit'

/** The changes of a refresh that stored nothing, and of one with no hook to tell. */
const NO_CHANGES: readonly SubscriptionChange[] = Object.freeze([])

/** What one refresh did. */
export interface RefreshResult {
  /** The snapshot stored before the refresh; `null` when none was stored. */
  readonly previous: SubscriptionSnapshot | null
  /** The snapshot stored after the refresh: the one just read, or the newer one that was kept. */
  readonly current: SubscriptionSnapshot
  /** Whether the store took the snapshot just read. `false` means a newer one was kept. */
  readonly written: boolean
  /**
   * The changes the write stored with the snapshot, each still pending until the host's hook
   * returned for it; empty when nothing was written or the host set no hook.
   */
  readonly changes: readonly SubscriptionChange[]
  /**
   * Settles when the host's hook has been called for those changes and they were cleared, or the
   * call failed. It never rejects, and it is already running when the refresh resolves: a caller
   * that does not want to wait for the host's reaction, such as a webhook answer, ignores it.
   */
  readonly delivery: Promise<void>
}

/**
 * What one flight of a refresh yields: what the observer needs, and `finish`, which builds the
 * result with its delivery. The delivery does not start inside the flight, because a hook that
 * awaits a refresh of its own account would join the flight it is called from and wait for itself.
 */
interface Flight extends Pick<RefreshResult, 'written' | 'changes'> {
  /** Builds the result and starts its delivery on the first call; every later call gives the same. */
  readonly finish: () => RefreshResult
}

/** The instant a snapshot is ordered by: what the source says, or else when it was read. */
function orderInstant(snapshot: SubscriptionSnapshot): string {
  return snapshot.sourceUpdatedAt ?? snapshot.fetchedAt
}

/**
 * Reads accounts from the source and stores what it reads. A refresh of an account that is
 * already being refreshed joins that refresh, so a burst of calls costs the source one read.
 */
@Injectable()
export class SnapshotRefresher {
  readonly #flights = new SingleFlight<Flight>()

  constructor(
    @Inject(SUBSCRIPTION_SOURCE) private readonly source: SubscriptionSource,
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock,
    @Inject(SnapshotCache) private readonly cache: SnapshotCache | null,
    @Inject(ChangeDispatcher) private readonly dispatcher: ChangeDispatcher | null,
    @Inject(ObserverBridge) private readonly observer: ObserverBridge
  ) {}

  /** The number of accounts being refreshed now. */
  get inFlight(): number {
    return this.#flights.size
  }

  /**
   * Reads the account from the source and stores the snapshot unless the store holds a newer one.
   * The tenant and the account identifier come from the caller's argument and nowhere else.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier,
   * and with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the source cannot be read; the stored snapshot
   * is untouched in that case and the source's own error is the `cause`.
   */
  async refresh(account: AccountReference): Promise<RefreshResult> {
    const key = encodeAccountKey(account)
    const flight = await this.#flights.run(key, () => this.#refreshOnce(key, account))
    // The flight has been released here, so a hook that refreshes this account starts a flight of
    // its own. Every caller that shared the flight gets the one result, and its delivery is
    // started once.
    return flight.finish()
  }

  /** One read of the source and the ordered write of its result, reported to the observer. */
  async #refreshOnce(key: string, account: AccountReference): Promise<Flight> {
    const started = this.observer.mark()
    let read: SubscriptionSnapshot
    try {
      read = await this.#read(account)
    } catch (error) {
      this.observer.sourceError(this.source.name, started)
      throw error
    }
    const result = await this.#store(key, account, read)
    this.observer.refresh(
      result.written ? 'written' : 'superseded',
      this.source.name,
      started,
      result.changes.length
    )
    return result
  }

  /** Stores what was read, unless the store holds a newer snapshot; `finish()` starts delivery. */
  async #store(
    key: string,
    account: AccountReference,
    read: SubscriptionSnapshot
  ): Promise<Flight> {
    const snapshot: SubscriptionSnapshot = { ...read, fetchedAt: this.clock.now().toISOString() }
    const orderedAt = orderInstant(snapshot)
    const previous = await this.#stored(key, account)
    if (previous !== null && parseInstant(orderedAt) < parseInstant(orderInstant(previous))) {
      return this.#kept(previous, previous)
    }
    // The changes are computed from the two snapshots before the write and stored with the
    // snapshot in that one write, so a crash after it cannot lose them.
    const changes = this.dispatcher === null ? NO_CHANGES : diffSnapshots(previous, snapshot)
    if (await this.store.putSnapshot(key, snapshot, changes, orderedAt)) {
      await this.cache?.invalidate(account)
      // The hook is called only once the write has succeeded and the cache no longer holds the old
      // snapshot, and only after the flight is released.
      let result: RefreshResult | undefined
      const finish = (): RefreshResult =>
        (result ??= {
          previous,
          current: snapshot,
          written: true,
          changes,
          delivery: this.dispatcher?.deliver(key, previous, snapshot, changes) ?? Promise.resolve()
        })
      return { written: true, changes, finish }
    }
    return this.#kept(previous, (await this.#stored(key, account)) ?? snapshot)
  }

  /** The result of a refresh whose snapshot was not stored because a newer one is. */
  #kept(previous: SubscriptionSnapshot | null, current: SubscriptionSnapshot): Flight {
    const result: RefreshResult = {
      previous,
      current,
      written: false,
      changes: NO_CHANGES,
      delivery: Promise.resolve()
    }
    return { written: false, changes: NO_CHANGES, finish: () => result }
  }

  /** The snapshot the store holds for the account, or `null` when none or one that does not fit. */
  async #stored(key: string, account: AccountReference): Promise<SubscriptionSnapshot | null> {
    const snapshot = (await this.store.getSnapshot(key))?.snapshot
    return isSnapshotFor(snapshot, account) ? snapshot : null
  }

  /**
   * Reads the source. A failure becomes one error that carries the original as its cause, and a
   * snapshot that does not name the account asked for or holds an unreadable instant becomes the
   * same error with none.
   */
  async #read(account: AccountReference): Promise<SubscriptionSnapshot> {
    let read: SubscriptionSnapshot
    try {
      read = await this.source.readAccount(account)
    } catch (cause) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, { cause })
    }
    if (!isSnapshotFor(read, account)) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE)
    }
    return read
  }
}
