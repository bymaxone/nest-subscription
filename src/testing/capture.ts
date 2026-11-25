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
      onEventRecordFailure: record('onEventRecordFailure'),
      onBackgroundRefreshFailure: record('onBackgroundRefreshFailure')
    },
    lines,
    payloads
  }
}

/** Whether a value holds the sentinel in a string, a property name, a Map or Set member or a number. */
function holds(value: unknown, sentinel: string, seen: Set<object>): boolean {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value).includes(sentinel)
    case 'object': {
      if (value === null || seen.has(value)) return false
      seen.add(value)
      const parts =
        value instanceof Map
          ? [...value].flat()
          : value instanceof Set
            ? [...value]
            : Object.entries(value).flat()
      return parts.some((part) => holds(part, sentinel, seen))
    }
    default:
      return false
  }
}

/**
 * Fails when any captured log line or observer payload holds a sentinel. A line is compared as
 * text. A payload is walked, so a sentinel in a nested value, a property name, a Map key or value
 * or a Set member is found as it is written, whatever characters it holds, and so is one in the
 * printed form of a number, a BigInt or a boolean. The failure names the sentinel by its position
 * and where it was found, and does not repeat it.
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
  sentinels.forEach((sentinel, position) => {
    const line = capture.lines.findIndex((text) => text.includes(sentinel))
    if (line !== -1) {
      throw new Error(`Sentinel ${String(position)} was found in log line ${String(line)}.`)
    }
    for (const [index, captured] of capture.payloads.entries()) {
      if (holds(captured.payload, sentinel, new Set())) {
        const where = `observer payload ${String(index)} (${captured.method})`
        throw new Error(`Sentinel ${String(position)} was found in ${where}.`)
      }
    }
  })
}
