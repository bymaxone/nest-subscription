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

  /** How many slots are free now. */
  available(): number {
    this.#release()
    return this.limit - this.#taken.length
  }

  /** Forgets the slots whose window has ended, and returns the current instant in milliseconds. */
  #release(): number {
    const now = this.clock.now().getTime()
    this.#taken = this.#taken.filter((at) => at + this.windowMs > now)
    return now
  }

  /**
   * Takes a slot when one is free and returns `0`; otherwise takes none and returns how many
   * milliseconds until the oldest slot leaves the window. A slot taken at `t` is free again at
   * `t + windowMs`.
   */
  tryAcquire(): number {
    // Fewer entries than the limit means fewer live slots than the limit, whatever has expired,
    // so the common case costs no scan.
    if (this.#taken.length < this.limit) return this.#take(this.clock.now().getTime())
    const now = this.#release()
    if (this.#taken.length < this.limit) return this.#take(now)
    return this.#taken.reduce((oldest, at) => Math.min(oldest, at)) + this.windowMs - now
  }

  /** Records a slot taken at `now`. */
  #take(now: number): number {
    this.#taken.push(now)
    return 0
  }

  /**
   * Takes a slot, calling `wait` for as long as the limiter says to. A `wait` that returns without
   * letting time pass on the injected clock makes this call ask again until it does.
   */
  async acquire(wait: Wait): Promise<void> {
    for (let missing = this.tryAcquire(); missing > 0; missing = this.tryAcquire()) {
      await wait(missing)
    }
  }
}
