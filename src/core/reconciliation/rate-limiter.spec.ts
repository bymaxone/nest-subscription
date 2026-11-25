/**
 * @fileoverview Pins the rate limiter: at most N slots in any window, measured on a manual clock,
 * and a wait that is the caller's function, so no case waits on a timer.
 * @layer core
 */
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'
import { ManualClock } from '@bymax-one/nest-subscription/testing'

import { RateLimiter } from './rate-limiter'

describe('RateLimiter', () => {
  it('hands out as many slots as the limit in one window and then says how long to wait', () => {
    // Scenario: three slots per second; the fourth call at the same instant must wait a second.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 3, 1000)
    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([0, 0, 0])
    expect(limiter.tryAcquire()).toBe(1000)
  })

  it('says how long until the oldest slot leaves the window', () => {
    // Scenario: slots taken at 0 and 300 ms of a two-slot, one-second window.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 2, 1000)
    limiter.tryAcquire()
    clock.advance(300)
    limiter.tryAcquire()
    clock.advance(200)
    expect(limiter.tryAcquire()).toBe(500)
  })

  it('frees a slot exactly one window after it was taken, and not a millisecond earlier', () => {
    // Scenario: the boundary of the half-open window.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 1, 1000)
    expect(limiter.tryAcquire()).toBe(0)
    clock.advance(999)
    expect(limiter.tryAcquire()).toBe(1)
    clock.advance(1)
    expect(limiter.tryAcquire()).toBe(0)
  })

  it('does not take a slot when it answers with a wait', () => {
    // Scenario: refused calls leave the window as it was, so the wait stays the same.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 1, 1000)
    limiter.tryAcquire()
    expect([limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([1000, 1000])
  })

  it('never lets more than the limit start in any window over a long run', async () => {
    // Scenario: forty acquisitions through the caller's wait; any five consecutive starts span at
    // least one window.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 4, 1000)
    const starts: number[] = []
    const wait = (ms: number): Promise<void> => {
      clock.advance(ms)
      return Promise.resolve()
    }
    for (let call = 0; call < 40; call += 1) {
      expect(await limiter.acquire(wait)).toBe(true)
      starts.push(clock.now().getTime())
    }
    for (let index = 0; index + 4 < starts.length; index += 1) {
      expect((starts[index + 4] ?? 0) - (starts[index] ?? 0)).toBeGreaterThanOrEqual(1000)
    }
  })

  it('waits the time the limiter names, then takes the slot', async () => {
    // Scenario: the second acquisition of a one-slot limiter waits a second through the function.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 1, 1000)
    const waits: number[] = []
    const wait = (ms: number): Promise<void> => {
      waits.push(ms)
      clock.advance(ms)
      return Promise.resolve()
    }
    await limiter.acquire(wait)
    await limiter.acquire(wait)
    expect(waits).toEqual([1000])
  })

  it('answers false instead of waiting when it is given no wait function', async () => {
    // Scenario: the slot is taken and no function can wait for it.
    const limiter = new RateLimiter(new ManualClock(), 1, 1000)
    expect(await limiter.acquire()).toBe(true)
    expect(await limiter.acquire()).toBe(false)
  })

  it('keeps asking after a wait that left a slot still taken', async () => {
    // Scenario: the first wait moves the clock only part of the way; the limiter waits again.
    const clock = new ManualClock()
    const limiter = new RateLimiter(clock, 1, 1000)
    await limiter.acquire()
    const waits: number[] = []
    const wait = (ms: number): Promise<void> => {
      waits.push(ms)
      clock.advance(waits.length === 1 ? 400 : ms)
      return Promise.resolve()
    }
    await limiter.acquire(wait)
    expect(waits).toEqual([1000, 600])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s calls per window as invalid input',
    (limit) => {
      // Scenario: a limit that is not a positive whole number.
      expect(() => new RateLimiter(new ManualClock(), limit, 1000)).toThrow(
        expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
      )
    }
  )

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a window of %s milliseconds as invalid input',
    (window) => {
      // Scenario: a window that is not a positive finite number.
      expect(() => new RateLimiter(new ManualClock(), 1, window)).toThrow(
        expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
      )
    }
  )
})
