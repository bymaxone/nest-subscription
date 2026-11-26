/**
 * @fileoverview The service a host calls: it answers what an account's state is and whether it has
 * an entitlement from the store, and refreshes an account from the source when asked. A read never
 * waits for the source.
 * @layer core
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OPTIONS,
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
  createEmptySnapshot,
  type SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { SnapshotCache } from './cache/snapshot-cache'
import { entitlementHeld } from './entitlement-held'
import { logEvent } from './logging/subscription-logger'
import type { StopRenewalOutcome, SubscriptionCapabilities } from './management/management.types'
import { describeCapabilities, type ManagementContext } from './management/perform-operation'
import { stopRenewal } from './management/stop-renewal'
import { ObserverBridge } from './observer/observer-bridge'
import type { ResolvedSubscriptionOptions } from './options/subscription-options.types'
import {
  Reconciler,
  type ReconcileOptions,
  type ReconcileResult
} from './reconciliation/reconciler'
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { ageOf, isStale } from './refresh/staleness'
import { isSnapshotFor } from './snapshot-fit'
import { toSnapshotView, type AgedSnapshot } from './snapshot-view'
import { hasTenant } from './tenant'

/**
 * The reads and the on-demand refresh of the library. Every method takes the account as the
 * caller's argument: the tenant and the account identifier are never taken from a payload.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(SUBSCRIPTION_SOURCE) private readonly source: SubscriptionSource,
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock,
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: ResolvedSubscriptionOptions,
    @Inject(SnapshotRefresher) private readonly refresher: SnapshotRefresher,
    @Inject(SnapshotCache) private readonly cache: SnapshotCache | null,
    @Inject(Reconciler) private readonly reconciler: Reconciler,
    @Inject(ObserverBridge) private readonly observer: ObserverBridge
  ) {}

  /**
   * The stored snapshot of an account, frozen and carrying its age. An account with nothing stored
   * reads as an account with no entitlements and no subscriptions. The source is not waited for:
   * a snapshot older than the maximum age is returned as stored and a refresh of it starts in the
   * background, whose failure is logged and reported to the observer and never reaches the caller.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier,
   * or for a missing tenant when the host is multi-tenant.
   */
  async getSnapshot(account: AccountReference): Promise<AgedSnapshot> {
    const key = this.#keyOf(account)
    const stored = await this.#stored(account, key)
    const now = this.clock.now()
    if (stored === undefined) return this.#view(this.#emptyFor(account), now)
    if (isStale(stored, now, this.options.maxSnapshotAgeMs)) this.#refreshInBackground(account)
    return this.#view(stored, now)
  }

  /**
   * Whether the account has the named entitlement now: its active flag, which the source's access
   * flag gave it, is true and its `until` is `null` (no end) or later than now by the injected
   * clock. An entitlement the account lacks is `false`; so is any entitlement of a snapshot that is
   * unreadable, which is read as no snapshot. The source is not waited for.
   *
   * @throws {SubscriptionError} as {@link SubscriptionService.getSnapshot} does.
   */
  async hasEntitlement(account: AccountReference, entitlement: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(account)
    const now = this.clock.now().getTime()
    return snapshot.entitlements.some(
      (held) => held.name === entitlement && entitlementHeld(held, now)
    )
  }

  /**
   * Reads the account from the source now and returns the snapshot the store holds afterwards.
   * Concurrent refreshes of one account share one source call. When the host set a change hook and
   * the refresh stored changes, the call returns after the hook has returned or failed; a failing
   * hook never fails the refresh.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the source cannot be
   * read, with the stored snapshot untouched; with `SUBSCRIPTION_INVALID_INPUT` as
   * {@link SubscriptionService.getSnapshot} does.
   */
  async refresh(account: AccountReference): Promise<AgedSnapshot> {
    this.#keyOf(account)
    const { current, delivery } = await this.refresher.refresh(account)
    await delivery
    return this.#view(current, this.clock.now())
  }

  /**
   * Refreshes the accounts whose snapshot was fetched before a threshold, up to a batch bound and
   * under a rate, for the host to call from its own scheduler. The library starts no timer: the
   * host decides when to call and, with `wait`, how a run waits for its rate. One account's
   * failure does not end the run. The cursor of the result says where to go on; it is `null` only
   * when the listing is exhausted. The rate is kept per run, not across runs: run one at a time,
   * because concurrent runs add their rates together.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for an option out of range.
   */
  reconcile(options: ReconcileOptions = {}): Promise<ReconcileResult> {
    return this.reconciler.run(options)
  }

  /**
   * What can be done with one subscription or non-renewing purchase of the account, for each
   * management operation. The record is found in the account's own stored snapshot, and the answer
   * comes from the adapter each time and depends on the origin.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_ACCOUNT_UNKNOWN` for a reference the account
   * does not hold (no source is reached), with `SUBSCRIPTION_INVALID_INPUT` as
   * {@link SubscriptionService.getSnapshot} does, and with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when
   * the adapter fails.
   */
  async getCapabilities(
    account: AccountReference,
    recordRef: string
  ): Promise<SubscriptionCapabilities> {
    this.#keyOf(account)
    return describeCapabilities(this.#management(), account, recordRef)
  }

  /**
   * Where the person manages one record of the account, or `null` when the source provides no
   * place.
   *
   * @throws {SubscriptionError} as {@link SubscriptionService.getCapabilities} does.
   */
  async getManagementReference(
    account: AccountReference,
    recordRef: string
  ): Promise<string | null> {
    return (await this.getCapabilities(account, recordRef)).managementReference
  }

  /**
   * Asks the source to stop the renewal of a subscription of the account, then refreshes. The
   * result is the snapshot read back: `stopped` when it shows a subscription that will not renew,
   * `not_stopped` when the source accepted and the read-back still shows otherwise. Where a server
   * cannot do it the result is `person_must_act` with the management reference, and nothing was
   * asked of the source. The source is called at most once and never retried.
   *
   * @throws {SubscriptionError} as {@link SubscriptionService.getCapabilities} does; the stored
   * snapshot is untouched when the source fails.
   */
  async stopRenewal(account: AccountReference, recordRef: string): Promise<StopRenewalOutcome> {
    this.#keyOf(account)
    return stopRenewal(this.#management(), account, recordRef)
  }

  /** What the management operations need from this service. */
  #management(): ManagementContext {
    return {
      source: this.source,
      store: this.store,
      refresher: this.refresher,
      view: (snapshot) => this.#view(snapshot, this.clock.now())
    }
  }

  /** The stored snapshot, through the cache when the host configured one; `undefined` when none. */
  async #stored(account: AccountReference, key: string): Promise<SubscriptionSnapshot | undefined> {
    const load = async (): Promise<SubscriptionSnapshot | null> =>
      this.#fitting((await this.store.getSnapshot(key))?.snapshot, account)
    const snapshot = this.cache === null ? await load() : await this.cache.read(account, load)
    return snapshot ?? undefined
  }

  /** The snapshot when it fits the account asked for, and `null` for none or one that does not. */
  #fitting(
    snapshot: SubscriptionSnapshot | undefined,
    account: AccountReference
  ): SubscriptionSnapshot | null {
    return isSnapshotFor(snapshot, account) ? snapshot : null
  }

  /** The key of an account, after the tenant rule of this configuration is applied. */
  #keyOf(account: AccountReference): string {
    if (this.options.multiTenant && !hasTenant(account.tenantId)) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
    return encodeAccountKey(account)
  }

  /** The snapshot of an account nothing is stored for. */
  #emptyFor(account: AccountReference): SubscriptionSnapshot {
    return createEmptySnapshot({
      accountId: account.accountId,
      ...(account.tenantId === undefined ? {} : { tenantId: account.tenantId }),
      source: this.source.name,
      fetchedAt: this.clock.now().toISOString()
    })
  }

  /** The frozen copy of a snapshot with its age at `now`. */
  #view(snapshot: SubscriptionSnapshot, now: Date): AgedSnapshot {
    return toSnapshotView(snapshot, ageOf(snapshot, now))
  }

  /** Starts a refresh without waiting for it; whatever it ends with is handled here. */
  #refreshInBackground(account: AccountReference): void {
    const key = encodeAccountKey(account)
    this.refresher.refresh(account).catch((error: unknown) => this.#reportFailure(error, key))
  }

  /**
   * Logs a failed background refresh by its code and a short hash of the account, and tells the
   * observer by its code alone. Neither the account nor the error's text is passed on, and neither a broken logger nor a broken observer can raise.
   */
  #reportFailure(error: unknown, key: string): void {
    const code = error instanceof SubscriptionError ? error.code : null
    logEvent(this.options.logger, 'background_refresh_failed', code, key)
    this.observer.backgroundRefreshFailure(code)
  }
}
