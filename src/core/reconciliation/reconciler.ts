/**
 * @fileoverview Reconciliation: delivers the changes still marked as not delivered, then refreshes
 * the accounts whose snapshot is older than a threshold, each in a bounded batch and the second
 * under a rate limit, for the host to call from its own scheduler. It starts no timer and no job;
 * a run does its work when called and returns.
 * @layer core
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_STORE,
  SubscriptionError,
  decodeAccountKey,
  type AccountReference,
  type Clock,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { RateLimiter, type Wait } from './rate-limiter'
import { ChangeDispatcher } from '../notifications/change-dispatcher'
import type { ResolvedSubscriptionOptions } from '../options/subscription-options.types'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { hasTenant } from '../tenant'

/** The most keys one listing asks for while accounts are being refreshed. */
const PAGE_SIZE = 100
/** The most accounts a run attempts when the caller does not say. */
const DEFAULT_BATCH_SIZE = 100
/** The most source reads a run starts in one second when the caller does not say. */
const DEFAULT_MAX_CALLS_PER_SECOND = 10
/** The length of the window the rate is measured in. */
const RATE_WINDOW_MS = 1000

/** What a caller may set for one run. */
export interface ReconcileOptions {
  /**
   * An account is refreshed when its snapshot was fetched more than this many milliseconds ago.
   * Defaults to the maximum snapshot age of the module.
   */
  readonly olderThanMs?: number
  /**
   * The most accounts one run attempts, a positive whole number. Defaults to 100. It bounds the
   * accounts whose pending changes are delivered again and, separately, the accounts refreshed.
   */
  readonly batchSize?: number
  /**
   * The most source reads one run starts in any second, a positive whole number. Defaults to 10.
   */
  readonly maxCallsPerSecond?: number
  /** Where the previous run stopped: the `cursor` of its result. Absent starts from the first. */
  readonly cursor?: string | null
  /**
   * Where the previous run stopped delivering pending changes again: the `pendingCursor` of its
   * result. Absent starts from the first account. Pass it so that accounts whose hook keeps
   * failing, which stay pending, do not keep later accounts from being reached.
   */
  readonly pendingCursor?: string | null
  /**
   * Waits for the given number of milliseconds when the rate is spent. Without it a run that
   * spends its rate ends there and returns the cursor to go on from; the library starts no timer.
   */
  readonly wait?: Wait
}

/** What one run did. It names no account. */
export interface ReconcileResult {
  /** Accounts read from the source and left up to date, whether or not their snapshot changed. */
  readonly refreshed: number
  /** Accounts whose refresh failed, or whose key the library could not use. */
  readonly failed: number
  /**
   * Pass this as `cursor` to the next run to go on after the last account this run attempted. It
   * is `null` only when the listing is exhausted: nothing further was left at this run's threshold.
   * A run that ends at its batch bound or its rate always returns a cursor to go on from, and the
   * host decides from the cursor alone whether to call again.
   */
  readonly cursor: string | null
  /**
   * Pass this as `pendingCursor` to the next run to go on after the last account whose pending
   * changes this run delivered again. It is `null` only when the listing of accounts with pending
   * changes is exhausted, or when the host set no change hook. A run that ends at its batch bound
   * returns a cursor to go on from. It is independent of `cursor`, which belongs to the refresh of
   * stale snapshots.
   */
  readonly pendingCursor: string | null
}

/** The settings of a run, with defaults applied and every value checked. */
interface RunConfig {
  /** The instant before which a snapshot must have been fetched to be reconciled. */
  readonly olderThan: string
  readonly batchSize: number
  readonly cursor: string | null
  readonly pendingCursor: string | null
  /** The rate of source reads, built here so an invalid rate is refused with every other option. */
  readonly limiter: RateLimiter
}

/** How many accounts were refreshed and how many failed so far in one run. */
interface Tally {
  refreshed: number
  failed: number
}

/** Reconciles stale snapshots through the refresher, so each account keeps one source read at a time. */
@Injectable()
export class Reconciler {
  constructor(
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock,
    @Inject(SnapshotRefresher) private readonly refresher: SnapshotRefresher,
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: ResolvedSubscriptionOptions,
    @Inject(ChangeDispatcher) private readonly dispatcher: ChangeDispatcher | null
  ) {}

  /**
   * Runs one reconciliation. First it delivers again, up to the batch bound, the changes that are
   * still marked as not delivered, as redeliveries with the same keys and no previous snapshot; a
   * change whose hook call fails stays marked for the next run, and the run goes on. Then it lists
   * the accounts fetched before the threshold, refreshes them in order up to the batch bound and
   * the rate, and reports what it did. One account's failure does
   * not end the run. The threshold is fixed when the run starts, so an account refreshed during it
   * is not met again.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for an option out of range,
   * before anything is listed or read. A failure of the store's listing, of pending changes or of
   * stale snapshots, rejects the run.
   */
  async run(input: ReconcileOptions): Promise<ReconcileResult> {
    const config = this.#configure(input)
    const pendingCursor = await this.#deliverPending(config.batchSize, config.pendingCursor)
    const { limiter } = config
    const tally: Tally = { refreshed: 0, failed: 0 }
    const { olderThan } = config
    let budget = config.batchSize
    let cursor = config.cursor
    for (;;) {
      // Without a wait function a page never holds more keys than the slots free now, so the run
      // ends between pages and the cursor it returns is exactly where it stopped.
      const slots = input.wait === undefined ? limiter.available() : budget
      const limit = Math.min(PAGE_SIZE, budget, slots)
      if (limit === 0) return { ...tally, cursor, pendingCursor }
      const page = await this.store.listStaleKeys(olderThan, limit, cursor)
      await this.#work(page.keys, limiter, input.wait, tally)
      budget -= page.keys.length
      cursor = page.nextCursor
      if (cursor === null) return { ...tally, cursor, pendingCursor }
    }
  }

  /**
   * Delivers again the pending changes of up to `batchSize` accounts, a page at a time, from the
   * cursor. An account whose hook call fails stays pending and is not met again in this run, and
   * one whose key the library cannot use is skipped. Returns where to go on, or `null` when the
   * listing is exhausted or there is no hook.
   */
  async #deliverPending(batchSize: number, from: string | null): Promise<string | null> {
    if (this.dispatcher === null) return null
    let budget = batchSize
    let cursor = from
    while (budget > 0) {
      const page = await this.store.listKeysWithPendingChanges(Math.min(PAGE_SIZE, budget), cursor)
      for (const key of page.keys) {
        const account = this.#accountOf(key)
        if (account !== null) await this.dispatcher.redeliver(key, account)
      }
      budget -= page.keys.length
      cursor = page.nextCursor
      if (cursor === null) return null
    }
    return cursor
  }

  /** Applies the defaults and refuses a value out of range. */
  #configure(input: ReconcileOptions): RunConfig {
    const olderThanMs = input.olderThanMs ?? this.options.maxSnapshotAgeMs
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE
    const threshold = new Date(this.clock.now().getTime() - olderThanMs)
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      !(olderThanMs >= 0) ||
      Number.isNaN(threshold.getTime())
    ) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
    return {
      olderThan: threshold.toISOString(),
      batchSize,
      cursor: input.cursor ?? null,
      pendingCursor: input.pendingCursor ?? null,
      limiter: new RateLimiter(
        this.clock,
        input.maxCallsPerSecond ?? DEFAULT_MAX_CALLS_PER_SECOND,
        RATE_WINDOW_MS
      )
    }
  }

  /**
   * Refreshes the accounts of one page in order, taking a slot of the rate for each. A key the
   * library cannot use is counted as failed and takes none.
   */
  async #work(
    keys: readonly string[],
    limiter: RateLimiter,
    wait: Wait | undefined,
    tally: Tally
  ): Promise<void> {
    for (const key of keys) {
      const account = this.#accountOf(key)
      if (account === null) {
        tally.failed += 1
      } else {
        if (wait === undefined) limiter.tryAcquire()
        else await limiter.acquire(wait)
        await this.#refreshOne(account, tally)
      }
    }
  }

  /** Refreshes one account and counts the outcome; a failure is counted and goes no further. */
  async #refreshOne(account: AccountReference, tally: Tally): Promise<void> {
    try {
      const { delivery } = await this.refresher.refresh(account)
      // The run is done with an account when the host has heard of its changes, so a run never
      // leaves a hook call running after it returns.
      await delivery
      tally.refreshed += 1
    } catch {
      tally.failed += 1
    }
  }

  /** The account a stored key names, or `null` for a key that is not usable in this configuration. */
  #accountOf(key: string): AccountReference | null {
    const account = decodeAccountKey(key)
    return account !== null && this.options.multiTenant && !hasTenant(account.tenantId)
      ? null
      : account
  }
}
