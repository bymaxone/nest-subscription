/**
 * @fileoverview The webhook processor: the one implementation of the receiver, which takes the raw
 * bytes and headers of a request and returns an outcome. The adapter verifies the request over the
 * bytes; this class never parses them. A verified notification is only a trigger: the state that
 * is stored is always read from the source, and nothing in the payload is applied, stored or
 * logged. The controller is a thin HTTP adapter over this class.
 * @layer core
 */
import { Inject, Injectable } from '@nestjs/common'

import {
  SUBSCRIPTION_CLOCK,
  SUBSCRIPTION_OPTIONS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_STORE,
  SubscriptionError,
  type AccountReference,
  type Clock,
  type SubscriptionSource,
  type SubscriptionStore,
  type WebhookRequest
} from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

import { WEBHOOK_WAIT, withDeadline, type DeadlineWait } from './deadline'
import { UnreleasedEvents } from './unreleased-events'
import type { WebhookOutcome } from './webhook-outcome'
import { errorCodeOf, logEvent } from '../logging/subscription-logger'
import { ObserverBridge } from '../observer/observer-bridge'
import type { ResolvedSubscriptionOptions } from '../options/subscription-options.types'
import { SnapshotRefresher } from '../refresh/snapshot-refresher'
import { hasTenant } from '../tenant'

/** Where a request comes from, as the host's own routing knows it. */
export interface WebhookContext {
  /**
   * The tenant the host's authenticated route belongs to. It is required when the host is
   * multi-tenant, and it must come from the host's routing, never from the request body. Every
   * account the notification names is read under it.
   */
  readonly tenantId?: string | undefined
}

/**
 * What became of the work after verification. A failed event also carries the removal of its
 * identifier, already started and settling to whether the store removed it; it never rejects.
 */
interface Settled {
  readonly outcome: WebhookOutcome
  readonly removal?: Promise<boolean>
}

/** Whether a value is a non-empty string that is not blank. */
function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** What the receiver uses of a verified notification: nothing of its payload but these two. */
interface Trigger {
  /** The identifier of the event, which the retries of one delivery share. */
  readonly eventId: string
  /** The accounts to read, as the host names them. */
  readonly accountIds: readonly string[]
}

/**
 * The trigger a verification result carries, or `null` when the result is a refusal or does not
 * have the shape of an acceptance. An adapter is code the host may have written, so its answer is
 * checked like any input.
 */
function acceptedTrigger(result: unknown): Trigger | null {
  const verification: Record<string, unknown> = Object(result)
  if (verification['accepted'] !== true) return null
  const notification: Record<string, unknown> = Object(verification['notification'])
  const { eventId, accountIds } = notification
  if (!isFilled(eventId) || !Array.isArray(accountIds)) return null
  const names: unknown[] = accountIds
  return names.every(isFilled) ? { eventId, accountIds: names } : null
}

/**
 * Verifies, de-duplicates and processes webhook notifications. Every request ends in one of five
 * outcomes, and every outcome is reported to the observer.
 *
 * The identifier of an event is recorded when its processing starts and removed when it ends as
 * a failure, so the source's retry is processed (D16). The removal is started before the failed
 * answer is returned and is never awaited, so a store that is slow or down cannot hold the answer
 * past the deadline, and the observer hears of a failed event when its removal settles.
 *
 * An event is never processed while the removal of its identifier is unsettled. The processor
 * remembers in memory the failed events whose removal is in flight or failed, up to
 * `UNRELEASED_EVENTS_BOUND` of them, oldest first out. A delivery of an event whose removal is in
 * flight is answered as a failure at once, with no store call and no read, and the source
 * retries later. A delivery of an event whose last removal failed starts the removal again and
 * is answered as a failure. Once a removal succeeded the event is forgotten, so the next delivery
 * is recorded and processed. The processor never records an identifier again. When the store
 * cannot remove an identifier the outcome is still a failure and the observer and the log are
 * told. The memory belongs to one process and is bounded: a retry that lands on another instance
 * of the host while the removal is in flight or failed, or after the oldest entry was dropped,
 * may find the identifier recorded and be answered as already seen until the retention purges it.
 * An event that names no account is answered as ignored and records nothing.
 */
@Injectable()
export class WebhookProcessor {
  /** The failed events whose removal is in flight or failed. */
  readonly #unreleased = new UnreleasedEvents()

  constructor(
    @Inject(SUBSCRIPTION_SOURCE) private readonly source: SubscriptionSource,
    @Inject(SUBSCRIPTION_STORE) private readonly store: SubscriptionStore,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: Clock,
    @Inject(SUBSCRIPTION_OPTIONS) private readonly options: ResolvedSubscriptionOptions,
    @Inject(SnapshotRefresher) private readonly refresher: SnapshotRefresher,
    @Inject(ObserverBridge) private readonly observer: ObserverBridge,
    @Inject(WEBHOOK_WAIT) private readonly wait: DeadlineWait
  ) {}

  /**
   * Handles one request. The adapter verifies it over the bytes exactly as received, so a request
   * that fails any check, or makes the adapter throw, is refused with the one refusal and nothing
   * else is touched. A verified notification that is new causes a read of every account it names,
   * stored through the refresher's ordered write; the host's hook for the changes runs outside
   * this call's deadline and is not awaited. Reads that do not finish inside the deadline end the
   * call as a failure, and are not abandoned: a read that completes later is stored normally.
   *
   * @param request The raw body and headers, untouched.
   * @param context Where the request came from; its tenant is required in a multi-tenant host.
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` when the host is multi-tenant and
   * the context names no tenant. It is thrown before the adapter, the store or the source is
   * called, because it is a mistake of the host's routing and not a property of the request.
   */
  async process(request: WebhookRequest, context: WebhookContext = {}): Promise<WebhookOutcome> {
    const tenantId = this.#tenantOf(context)
    const started = this.observer.mark()
    const trigger = await this.#verify(request)
    const settled: Settled =
      trigger === null ? { outcome: { kind: 'refused' } } : await this.#handle(trigger, tenantId)
    const answered = this.observer.mark()
    const { outcome, removal } = settled
    if (removal === undefined) {
      this.observer.webhook(outcome.kind, started, answered, false)
    } else {
      void removal.then((removed) => this.observer.webhook('failed', started, answered, !removed))
    }
    return outcome
  }

  /** The tenant to read under, or `undefined` when the host is not multi-tenant and gave none. */
  #tenantOf(context: WebhookContext): string | undefined {
    const { tenantId } = context
    if (this.options.multiTenant && !hasTenant(tenantId)) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
    return hasTenant(tenantId) ? tenantId : undefined
  }

  /**
   * Asks the adapter to verify the request. An adapter that throws is a refusal, not a failure:
   * a malformed request must not be able to make the source retry it.
   */
  async #verify(request: WebhookRequest): Promise<Trigger | null> {
    try {
      return acceptedTrigger(await this.source.verifyWebhook(request))
    } catch {
      return null
    }
  }

  /** Records the event, reads the accounts it names and settles the outcome. */
  async #handle(trigger: Trigger, tenantId: string | undefined): Promise<Settled> {
    const accountIds = [...new Set(trigger.accountIds)]
    if (accountIds.length === 0) return { outcome: { kind: 'ignored' } }
    const key = JSON.stringify([this.source.name, trigger.eventId])
    // An event whose removal is unsettled is never processed: its identifier is still recorded,
    // or a removal in flight may erase it. A failed removal is started again.
    const memory = this.#unreleased.memoryOf(key)
    if (memory === 'removing') return { outcome: { kind: 'failed' } }
    if (memory === 'failed') {
      return { outcome: { kind: 'failed' }, removal: this.#release(key, trigger.eventId) }
    }
    const recorded = await this.#record(trigger.eventId)
    if (recorded === 'unavailable') return { outcome: { kind: 'failed' } }
    if (recorded === 'seen') return { outcome: { kind: 'duplicate' } }
    const references = accountIds.map((accountId): AccountReference => ({
      ...(tenantId === undefined ? {} : { tenantId }),
      accountId
    }))
    if (await this.#refreshAll(references)) {
      return { outcome: { kind: 'processed', accounts: references.length } }
    }
    return { outcome: { kind: 'failed' }, removal: this.#release(key, trigger.eventId) }
  }

  /**
   * Records the event identifier. `seen` means it was recorded already, and `unavailable` means the
   * store failed, in which case nothing is known to be recorded and nothing is forgotten.
   */
  async #record(eventId: string): Promise<'new' | 'seen' | 'unavailable'> {
    try {
      const isNew = await this.store.markEventProcessed(
        this.source.name,
        eventId,
        this.clock.now().toISOString()
      )
      return isNew ? 'new' : 'seen'
    } catch {
      return 'unavailable'
    }
  }

  /**
   * Reads every account from the source inside the deadline. Resolves `true` only when every read
   * finished in time and stored or kept its snapshot. A read that is still running at the deadline
   * is left to finish; the host's hook for what it stores is never awaited here.
   */
  async #refreshAll(references: readonly AccountReference[]): Promise<boolean> {
    const reads = Promise.allSettled(
      references.map((reference) => this.refresher.refresh(reference))
    )
    try {
      const result = await withDeadline(reads, this.options.webhookDeadlineMs, this.wait)
      return !result.timedOut && result.value.every((read) => read.status === 'fulfilled')
    } catch {
      return false
    }
  }

  /**
   * Remembers a failed event and starts the removal of its identifier. The store is called before
   * this returns. Settles to whether the store removed the identifier, as soon as it settles, and
   * never rejects.
   */
  #release(key: string, eventId: string): Promise<boolean> {
    const removal = this.#unreleased.begin(key)
    return this.#forget(eventId).then((removed) => {
      this.#unreleased.settled(key, removal, removed)
      return removed
    })
  }

  /**
   * Starts the removal of the identifier of a failed event. The store is called before this
   * returns; the promise settles to `false` when the store could not remove it, and never rejects.
   */
  async #forget(eventId: string): Promise<boolean> {
    try {
      await this.store.forgetEvent(this.source.name, eventId)
      return true
    } catch (error) {
      logEvent(this.options.logger, 'webhook_forget_failed', errorCodeOf(error), null)
      return false
    }
  }
}
