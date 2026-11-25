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

import type { ResolvedSubscriptionOptions } from './options/subscription-options.types'
import { SnapshotRefresher } from './refresh/snapshot-refresher'
import { ageOf } from './refresh/staleness'
import { toSnapshotView, type AgedSnapshot } from './snapshot-view'

/** Whether a tenant identifier names a tenant. */
function hasTenant(tenantId: string | undefined): boolean {
  return tenantId !== undefined && tenantId.trim().length > 0
}

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
    @Inject(SnapshotRefresher) private readonly refresher: SnapshotRefresher
  ) {}

  /**
   * The stored snapshot of an account, frozen and carrying its age. An account with nothing stored
   * reads as an account with no entitlements and no subscriptions. The source is not called.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for a blank account identifier,
   * or for a missing tenant when the host is multi-tenant.
   */
  async getSnapshot(account: AccountReference): Promise<AgedSnapshot> {
    const key = this.#keyOf(account)
    const stored = (await this.store.getSnapshot(key))?.snapshot ?? this.#emptyFor(account)
    return this.#view(stored)
  }

  /**
   * Whether the account has the named entitlement active now, by the active flag the source's
   * access flag gave it. An entitlement the account lacks is `false`. The source is not called.
   *
   * @throws {SubscriptionError} as {@link SubscriptionService.getSnapshot} does.
   */
  async hasEntitlement(account: AccountReference, entitlement: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(account)
    return snapshot.entitlements.some((held) => held.name === entitlement && held.active)
  }

  /**
   * Reads the account from the source now and returns the snapshot the store holds afterwards.
   * Concurrent refreshes of one account share one source call.
   *
   * @throws {SubscriptionError} with `SUBSCRIPTION_SOURCE_UNAVAILABLE` when the source cannot be
   * read, with the stored snapshot untouched; with `SUBSCRIPTION_INVALID_INPUT` as
   * {@link SubscriptionService.getSnapshot} does.
   */
  async refresh(account: AccountReference): Promise<AgedSnapshot> {
    this.#keyOf(account)
    const { current } = await this.refresher.refresh(account)
    return this.#view(current)
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

  /** The frozen copy of a snapshot with its age at this instant. */
  #view(snapshot: SubscriptionSnapshot): AgedSnapshot {
    return toSnapshotView(snapshot, ageOf(snapshot, this.clock.now()))
  }
}
