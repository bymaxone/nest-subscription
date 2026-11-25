/**
 * @fileoverview A capturing logger and observer for tests, and the assertion that nothing they
 * captured holds an identifier. A test passes `capture.logger` and `capture.observer` to the
 * module, runs its scenario, and calls `assertNoSentinel` with the account, tenant and payload
 * values it chose as sentinels: a line or a payload that holds one fails the test.
 * @layer testing
 */
import type { SubscriptionLogger, SubscriptionObserver } from '@bymax-one/nest-subscription'

/** One payload the observer received, with the name of the method that received it. */
export interface CapturedPayload {
  /** The observer method, such as `onRefresh`. */
  readonly method: string
  /** The payload exactly as the library passed it. */
  readonly payload: unknown
}

/** A logger and an observer that record everything they are given. */
export interface Capture {
  /** Pass this as the module's `logger`. */
  readonly logger: SubscriptionLogger
  /** Pass this as the module's `observer`. It implements every method. */
  readonly observer: SubscriptionObserver
  /** Every line the logger received, in order. */
  readonly lines: readonly string[]
  /** Every payload the observer received, in order. */
  readonly payloads: readonly CapturedPayload[]
}

/** Creates a capture with nothing recorded yet. */
export function createCapture(): Capture {
  const lines: string[] = []
  const payloads: CapturedPayload[] = []
  const record =
    (method: string) =>
    (payload: unknown): void => {
      payloads.push({ method, payload })
    }
  return {
    logger: { warn: (message) => void lines.push(message) },
    observer: {
      onRefresh: record('onRefresh'),
      onSourceError: record('onSourceError'),
      onCacheLookup: record('onCacheLookup'),
      onGuardDecision: record('onGuardDecision'),
      onChangeDelivery: record('onChangeDelivery'),
      onWebhook: record('onWebhook'),
      onBackgroundRefreshFailure: record('onBackgroundRefreshFailure')
    },
    lines,
    payloads
  }
}

/**
 * Fails when any captured log line or observer payload holds a sentinel. A payload is searched
 * as JSON, so a sentinel in a field name or a nested value is found too. The failure names the
 * sentinel by its position and where it was found, and does not repeat it.
 *
 * @param capture What a scenario captured.
 * @param sentinels The strings that must not appear; none may be empty, since an empty string is
 * found everywhere.
 * @throws {Error} when a sentinel is found, when no sentinel is given or when one is empty.
 */
export function assertNoSentinel(capture: Capture, sentinels: readonly string[]): void {
  if (sentinels.length === 0 || sentinels.some((sentinel) => sentinel.length === 0)) {
    throw new Error('assertNoSentinel needs at least one sentinel and none may be empty.')
  }
  const places = [
    ...capture.lines.map((line, index) => ({ where: `log line ${String(index)}`, text: line })),
    ...capture.payloads.map(({ method, payload }, index) => ({
      where: `observer payload ${String(index)} (${method})`,
      text: String(JSON.stringify(payload))
    }))
  ]
  sentinels.forEach((sentinel, position) => {
    const found = places.find((place) => place.text.includes(sentinel))
    if (found !== undefined) {
      throw new Error(`Sentinel ${String(position)} was found in ${found.where}.`)
    }
  })
}
