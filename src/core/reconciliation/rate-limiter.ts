/**
 * @fileoverview The rate limiter of a reconciliation run: at most a stated number of slots in any
 * window of time, read from the injected clock. It starts no timer; the caller's own function does
 * the waiting, so a test advances time by hand.
 * @layer core
 */
import { SubscriptionError, type Clock } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

/** Waits for the given number of milliseconds. The host decides how. */
export type Wait = (milliseconds: number) => Promise<void>

/** A sliding window: of any window of `windowMs`, at most `limit` slots start in it. */
export class RateLimiter {
  /** The instants at which the slots still inside the window were taken, oldest first. */
  #taken: number[] = []

  /**
   * @param clock The time source.
   * @param limit How many slots a window holds; a positive whole number.
   * @param windowMs The length of a window in milliseconds; positive and finite.
   * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` for any other value.
   */
  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number
  ) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
    }
  }

  /**
   * Takes a slot when one is free and returns `0`; otherwise takes none and returns how many
   * milliseconds until the oldest slot leaves the window. A slot taken at `t` is free again at
   * `t + windowMs`.
   */
  tryAcquire(): number {
    const now = this.clock.now().getTime()
    this.#taken = this.#taken.filter((at) => at + this.windowMs > now)
    if (this.#taken.length < this.limit) {
      this.#taken.push(now)
      return 0
    }
    return Math.min(...this.#taken) + this.windowMs - now
  }

  /**
   * Takes a slot, calling `wait` for as long as the limiter says to. Returns `false` without
   * waiting when no slot is free and there is no `wait`. A `wait` that returns without letting
   * time pass on the injected clock makes this call ask again until it does.
   */
  async acquire(wait?: Wait): Promise<boolean> {
    for (;;) {
      const missing = this.tryAcquire()
      if (missing === 0) return true
      if (wait === undefined) return false
      await wait(missing)
    }
  }
}
