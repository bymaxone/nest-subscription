/**
 * @fileoverview The optional observer a host passes to receive counters, timings and failures.
 * Every payload is a closed record of enumerated outcomes, counts and durations: none has a field
 * that can hold an account identifier, a tenant identifier or any content of a payload, and none
 * has a free-form field where one could end up. Types only.
 * @layer core
 */
import type { SubscriptionErrorCode } from '@bymax-one/nest-subscription/shared'

/** How a refresh that read the source ended. */
export type RefreshOutcome = 'written' | 'superseded'

/** One refresh that read the source. */
export interface RefreshEvent {
  /** `written` when the store took the snapshot, `superseded` when a newer one was kept. */
  readonly outcome: RefreshOutcome
  /** The name of the source that was read. */
  readonly source: string
  /** Milliseconds from the start of the refresh to its end, by the injected clock. */
  readonly durationMs: number
  /** How many changes the refresh stored; `0` when it stored none. */
  readonly changeCount: number
}

/** One read of the source that failed. */
export interface SourceErrorEvent {
  /** The name of the source that was read. */
  readonly source: string
  /** Milliseconds the failed read took, by the injected clock. */
  readonly durationMs: number
}

/** Whether a read found the snapshot in the host's cache. */
export type CacheOutcome = 'hit' | 'miss'

/** One lookup in the host's cache. */
export interface CacheEvent {
  /** `hit` when the cache answered, `miss` when the store did. */
  readonly outcome: CacheOutcome
}

/** What the guard decided. */
export type GuardOutcome = 'allowed' | 'refused'

/** One decision of the guard. */
export interface GuardDecisionEvent {
  /** Whether the request was allowed. */
  readonly outcome: GuardOutcome
  /** The catalogue code of the refusal; `null` when the request was allowed. */
  readonly code: SubscriptionErrorCode | null
}

/** How a call of the host's change hook ended. */
export type ChangeDeliveryOutcome = 'delivered' | 'failed'

/** One call of the host's change hook. */
export interface ChangeDeliveryEvent {
  /** `delivered` when the hook returned, `failed` when it threw or rejected. */
  readonly outcome: ChangeDeliveryOutcome
  /** Whether the call repeated changes the host was already offered. */
  readonly redelivery: boolean
  /** How many changes the call carried. */
  readonly changeCount: number
  /** Milliseconds the hook took, by the injected clock. */
  readonly durationMs: number
  /** The catalogue code of the error the hook raised; `null` when it raised none of the library's. */
  readonly code: SubscriptionErrorCode | null
}

/** How the receiver handled one webhook request. */
export type WebhookOutcomeKind = 'processed' | 'duplicate' | 'ignored' | 'refused' | 'failed'

/** One webhook request handled by the receiver. */
export interface WebhookEvent {
  /** What became of the request. */
  readonly outcome: WebhookOutcomeKind
  /** Milliseconds from receipt to the answer, by the injected clock. */
  readonly durationMs: number
  /**
   * Whether the identifier of a failed event stayed recorded because the store could not forget
   * it. A retry that reaches the same process is still processed, because the processor remembers
   * the event; one that reaches another instance of the host is answered as already seen until
   * the retention purges the identifier. Always `false` for an outcome other than `failed`. The removal is started before a failed answer is returned and is
   * not waited for, so the event of a failed outcome is reported when the removal settles, after
   * the answer; its `durationMs` is still the time to the answer.
   */
  readonly retained: boolean
}

/** What the observer is told when a background refresh of a stale snapshot fails. */
export interface BackgroundRefreshFailure {
  /**
   * The code of the library error that ended the refresh, or `null` when the refresh ended with
   * an error that is not the library's, such as one a host's store raised. It never names the
   * account, and the error's text is not passed on.
   */
  readonly code: SubscriptionErrorCode | null
}

/**
 * The observer. Every method is optional and gets one small payload; a host implements the ones
 * it wants. A method may return a promise: the library does not wait for it, and whatever a
 * method throws or rejects with is contained, so an observer never affects the operation it
 * observes. With no observer configured none of this code runs and no payload is built.
 */
export interface SubscriptionObserver {
  /** A refresh that read the source ended. */
  readonly onRefresh?: (event: RefreshEvent) => void | Promise<void>
  /** A read of the source failed. */
  readonly onSourceError?: (event: SourceErrorEvent) => void | Promise<void>
  /** A read looked in the host's cache. */
  readonly onCacheLookup?: (event: CacheEvent) => void | Promise<void>
  /** The guard decided on a request. */
  readonly onGuardDecision?: (event: GuardDecisionEvent) => void | Promise<void>
  /** The host's change hook was called and returned or failed. */
  readonly onChangeDelivery?: (event: ChangeDeliveryEvent) => void | Promise<void>
  /** The receiver handled a webhook request. */
  readonly onWebhook?: (event: WebhookEvent) => void | Promise<void>
  /** A refresh started in the background by a read of a stale snapshot failed. */
  readonly onBackgroundRefreshFailure?: (failure: BackgroundRefreshFailure) => void | Promise<void>
}
