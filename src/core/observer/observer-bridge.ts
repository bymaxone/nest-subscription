/**
 * @fileoverview The bridge between the library's code paths and the host's optional observer. It
 * takes primitives, never payload objects, and builds a payload only when an observer that wants
 * it exists, so a host with no observer costs a null check per event and no allocation. Whatever
 * an observer throws or rejects with stays here.
 * @layer core
 */
import type { Clock } from '@bymax-one/nest-subscription/internal'
import type { SubscriptionErrorCode } from '@bymax-one/nest-subscription/shared'

import type {
  CacheOutcome,
  ChangeDeliveryOutcome,
  GuardOutcome,
  RefreshOutcome,
  SubscriptionObserver,
  WebhookOutcome
} from './observer.types'

/** Reads one method of an observer. Declared once, so reporting an event allocates no closure. */
const PICK = {
  onRefresh: (observer: SubscriptionObserver) => observer.onRefresh,
  onSourceError: (observer: SubscriptionObserver) => observer.onSourceError,
  onCacheLookup: (observer: SubscriptionObserver) => observer.onCacheLookup,
  onGuardDecision: (observer: SubscriptionObserver) => observer.onGuardDecision,
  onChangeDelivery: (observer: SubscriptionObserver) => observer.onChangeDelivery,
  onWebhook: (observer: SubscriptionObserver) => observer.onWebhook,
  onBackgroundRefreshFailure: (observer: SubscriptionObserver) =>
    observer.onBackgroundRefreshFailure
} as const

/**
 * Calls the observer's methods safely. A call site reads {@link ObserverBridge.mark} when it
 * starts, and passes that reading when it reports, so a duration is measured on the injected
 * clock and only when an observer is there to receive it.
 */
export class ObserverBridge {
  /**
   * @param observer The host's observer, or `null` when it set none.
   * @param clock The clock durations are measured on.
   */
  constructor(
    private readonly observer: SubscriptionObserver | null,
    private readonly clock: Clock
  ) {}

  /** The clock reading to measure a duration from; `0`, with the clock untouched, with no observer. */
  mark(): number {
    return this.observer === null ? 0 : this.clock.now().getTime()
  }

  /** Reports a refresh that read the source and ended. */
  refresh(outcome: RefreshOutcome, source: string, startedAt: number, changeCount: number): void {
    const hook = this.#hook(PICK.onRefresh)
    if (hook !== undefined) {
      this.#run(hook, { outcome, source, durationMs: this.#since(startedAt), changeCount })
    }
  }

  /** Reports a read of the source that failed. */
  sourceError(source: string, startedAt: number): void {
    const hook = this.#hook(PICK.onSourceError)
    if (hook !== undefined) this.#run(hook, { source, durationMs: this.#since(startedAt) })
  }

  /** Reports a lookup in the host's cache. */
  cacheLookup(outcome: CacheOutcome): void {
    const hook = this.#hook(PICK.onCacheLookup)
    if (hook !== undefined) this.#run(hook, { outcome })
  }

  /** Reports a decision of the guard. */
  guardDecision(outcome: GuardOutcome, code: SubscriptionErrorCode | null): void {
    const hook = this.#hook(PICK.onGuardDecision)
    if (hook !== undefined) this.#run(hook, { outcome, code })
  }

  /** Reports a call of the host's change hook. */
  changeDelivery(
    outcome: ChangeDeliveryOutcome,
    redelivery: boolean,
    changeCount: number,
    startedAt: number,
    code: SubscriptionErrorCode | null
  ): void {
    const hook = this.#hook(PICK.onChangeDelivery)
    if (hook !== undefined) {
      this.#run(hook, {
        outcome,
        redelivery,
        changeCount,
        durationMs: this.#since(startedAt),
        code
      })
    }
  }

  /** Reports a webhook request the receiver handled. */
  webhook(outcome: WebhookOutcome, startedAt: number): void {
    const hook = this.#hook(PICK.onWebhook)
    if (hook !== undefined) this.#run(hook, { outcome, durationMs: this.#since(startedAt) })
  }

  /** Reports a background refresh of a stale snapshot that failed. */
  backgroundRefreshFailure(code: SubscriptionErrorCode | null): void {
    const hook = this.#hook(PICK.onBackgroundRefreshFailure)
    if (hook !== undefined) this.#run(hook, { code })
  }

  /**
   * What `pick` reads from the observer, or `undefined` when there is no observer, it lacks the
   * method, or reading the property throws.
   */
  #hook<M>(pick: (observer: SubscriptionObserver) => M): M | undefined {
    try {
      return this.observer === null ? undefined : pick(this.observer)
    } catch {
      return undefined
    }
  }

  /** Milliseconds since a reading of {@link ObserverBridge.mark}, never negative. */
  #since(startedAt: number): number {
    return Math.max(0, this.clock.now().getTime() - startedAt)
  }

  /**
   * Calls one observer method with its payload and does not wait for it. A throw and a rejection
   * are both dropped, so an observer cannot affect the operation it observes.
   */
  #run<P>(hook: (payload: P) => void | Promise<void>, payload: P): void {
    try {
      // `Promise.resolve` adopts a returned promise or thenable, so its rejection is handled here.
      void Promise.resolve(Reflect.apply(hook, this.observer, [payload])).catch(() => undefined)
    } catch {
      // An observer that throws must not affect the operation it observes.
    }
  }
}
