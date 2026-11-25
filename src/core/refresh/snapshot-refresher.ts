/**
 * @fileoverview The refresher: the one component that reads an account from the source and stores
 * the result. Concurrent refreshes of one account become one source call, and an older snapshot
 * never replaces a newer one. A read of the source is the only way a snapshot enters the store.
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
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { SingleFlight } from './single-flight'
import { SnapshotCache } from '../cache/snapshot-cache'

/** What one refresh did. */
export interface RefreshResult {
  /** The snapshot stored before the refresh; `null` when none was stored. */
  readonly previous: SubscriptionSnapshot | null
  /** The snapshot stored after the refresh: the one just read, or the newer one that was kept. */
  readonly current: SubscriptionSnapshot
  /** Whether the store took the snapshot just read. `false` means a newer one was kept. */
  readonly written: boolean
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
  readonly #flights = new SingleFlight<RefreshResult>()

  constructor(
    @Inject(SUBSCRIPTION_SOURCE) private readonly source: SubscriptionSource,
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock,
    @Inject(SnapshotCache) private readonly cache: SnapshotCache | null
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
    return this.#flights.run(key, () => this.#refreshOnce(key, account))
  }

  /** One read of the source and the ordered write of its result. */
  async #refreshOnce(key: string, account: AccountReference): Promise<RefreshResult> {
    const read = await this.#read(account)
    const snapshot: SubscriptionSnapshot = { ...read, fetchedAt: this.clock.now().toISOString() }
    const orderedAt = orderInstant(snapshot)
    const previous = (await this.store.getSnapshot(key))?.snapshot ?? null
    if (previous !== null && parseInstant(orderedAt) < parseInstant(orderInstant(previous))) {
      return { previous, current: previous, written: false }
    }
    if (await this.store.putSnapshot(key, snapshot, [], orderedAt)) {
      await this.cache?.invalidate(account)
      return { previous, current: snapshot, written: true }
    }
    const kept = (await this.store.getSnapshot(key))?.snapshot ?? snapshot
    return { previous, current: kept, written: false }
  }

  /** Reads the source; any failure becomes one error that carries the original as its cause. */
  async #read(account: AccountReference): Promise<SubscriptionSnapshot> {
    try {
      return await this.source.readAccount(account)
    } catch (cause) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE, { cause })
    }
  }
}
