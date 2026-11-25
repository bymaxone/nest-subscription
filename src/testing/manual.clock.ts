/**
 * @fileoverview A clock a test moves by hand. Nothing in it waits: time passes only when the test
 * says so, so a test of staleness, ordering or a rate limit never depends on a timer.
 * @layer testing
 */
import type { Clock } from '@bymax-one/nest-subscription/internal'

/** A `Clock` whose instant changes only when `advance` or `set` is called. */
export class ManualClock implements Clock {
  #millis: number

  /** @param start The first instant, as an ISO 8601 string or a `Date`. Defaults to 2026-01-01. */
  constructor(start: string | Date = '2026-01-01T00:00:00.000Z') {
    this.#millis = new Date(start).getTime()
  }

  /** The current instant. Each call returns a new `Date`, so a caller cannot move the clock. */
  now(): Date {
    return new Date(this.#millis)
  }

  /** Moves the clock forward by `milliseconds`; a negative value moves it back. */
  advance(milliseconds: number): void {
    this.#millis += milliseconds
  }

  /** Sets the clock to an instant. */
  set(instant: string | Date): void {
    this.#millis = new Date(instant).getTime()
  }
}
