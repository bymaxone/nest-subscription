/**
 * @fileoverview Pins the default clock: it reads the system time and is not replaceable by mutation.
 * @layer core
 */
import { systemClock } from './system-clock'

describe('systemClock', () => {
  it('returns the current instant as a Date', () => {
    // Scenario: the instant read lies between two reads of the system time.
    const before = Date.now()
    const now = systemClock.now()
    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('is frozen', () => {
    // Scenario: the shared instance cannot be reassigned by a caller.
    expect(Object.isFrozen(systemClock)).toBe(true)
  })
})
