/**
 * @fileoverview Delivers stored changes to the host's hook. The pending mark in the store is the
 * only delivery state: a change is cleared after the hook returned for it and never before, so a
 * crash, a failing hook or a failing clear leaves it pending for the next reconciliation run.
 * Delivery is at least once. The library keeps no queue, no timer and no retry loop of its own.
 * @layer core
 */
import {
  SubscriptionError,
  type AccountReference,
  type SubscriptionStore
} from '@bymax-one/nest-subscription/internal'
import type {
  SubscriptionChange,
  SubscriptionErrorCode,
  SubscriptionSnapshot
} from '@bymax-one/nest-subscription/shared'

import { logEvent, type SubscriptionLogger } from '../logging/subscription-logger'
import type { ObserverBridge } from '../observer/observer-bridge'
import type {
  SubscriptionChangeHook,
  SubscriptionChangeNotification
} from '../options/subscription-options.types'
import { isSnapshotFor } from '../snapshot-fit'

/** The catalogue code of an error, or `null` for one that is not the library's. */
function codeOf(error: unknown): SubscriptionErrorCode | null {
  return error instanceof SubscriptionError ? error.code : null
}

/**
 * Calls the host's hook for stored changes and clears what the hook returned for. It exists only
 * when the host configured a hook, so a host without one pays nothing.
 */
export class ChangeDispatcher {
  /**
   * @param hook The host's change hook.
   * @param store The store that holds the pending changes.
   * @param logger Where a failure is logged, by its error code alone.
   * @param observer Tells the host's observer how a call ended; a no-op when it set none.
   */
  constructor(
    private readonly hook: SubscriptionChangeHook,
    private readonly store: SubscriptionStore,
    private readonly logger: SubscriptionLogger,
    private readonly observer: ObserverBridge
  ) {}

  /**
   * Delivers the changes of a write that has succeeded: the hook gets the previous snapshot, the
   * new one and the changes, and the changes are cleared once it returns. It starts the call at
   * once, so call it only after the store write resolved. It never rejects; a caller that does
   * not want to wait for the host's reaction, such as a webhook answer, simply does not await it.
   *
   * @param key The account key the snapshot was written under.
   * @param previous The snapshot stored before the write, or `null` when there was none.
   * @param current The snapshot that was written.
   * @param changes What changed. An empty list calls nothing.
   */
  async deliver(
    key: string,
    previous: SubscriptionSnapshot | null,
    current: SubscriptionSnapshot,
    changes: readonly SubscriptionChange[]
  ): Promise<void> {
    if (changes.length === 0) return
    await this.#call(key, { previous, current, changes, redelivery: false })
  }

  /**
   * Delivers again the changes still pending for an account, as a redelivery: the hook gets the
   * stored snapshot and the pending changes with the same keys as before, and no previous
   * snapshot. A key whose hook call did not return stays pending. It never rejects.
   *
   * @param key The account key.
   * @param account The account the key names.
   */
  async redeliver(key: string, account: AccountReference): Promise<void> {
    let stored
    try {
      stored = await this.store.getSnapshot(key)
    } catch (error) {
      logEvent(this.logger, 'change_read_failed', codeOf(error), key)
      return
    }
    if (stored === null || stored.pendingChanges.length === 0) return
    if (!isSnapshotFor(stored.snapshot, account)) return
    await this.#call(key, {
      previous: null,
      current: stored.snapshot,
      changes: stored.pendingChanges,
      redelivery: true
    })
  }

  /** Calls the hook, and clears the changes when it returned. */
  async #call(key: string, notification: SubscriptionChangeNotification): Promise<void> {
    const { redelivery, changes } = notification
    const started = this.observer.mark()
    try {
      await this.hook(notification)
    } catch (error) {
      this.observer.changeDelivery('failed', redelivery, changes.length, started, codeOf(error))
      logEvent(this.logger, 'change_hook_failed', codeOf(error), key)
      return
    }
    this.observer.changeDelivery('delivered', redelivery, changes.length, started, null)
    try {
      await this.store.clearPendingChanges(
        key,
        changes.map((change) => change.key)
      )
    } catch (error) {
      logEvent(this.logger, 'change_clear_failed', codeOf(error), key)
    }
  }
}
