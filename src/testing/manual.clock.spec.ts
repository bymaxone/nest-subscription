/**
 * @fileoverview Pins the manual clock: it holds an instant, moves only when told and hands out
 * copies, so a test controls time without a timer.
 * @layer testing
 */
import { ManualClock } from './manual.clock'

describe('ManualClock', () => {
  it('starts at the given instant and at 2026-01-01 when none is given', () => {
    // Scenario: one clock built with a start and one without.
    expect(new ManualClock('2026-03-04T05:06:07.000Z').now().toISOString()).toBe(
      '2026-03-04T05:06:07.000Z'
    )
    expect(new ManualClock(new Date('2027-01-01T00:00:00.000Z')).now().toISOString()).toBe(
      '2027-01-01T00:00:00.000Z'
    )
    expect(new ManualClock().now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('does not move until told, and then by exactly the amount', () => {
    // Scenario: two reads without a call between them agree; an advance moves both ways.
    const clock = new ManualClock()
    expect(clock.now().getTime()).toBe(clock.now().getTime())
    clock.advance(1500)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z')
    clock.advance(-500)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z')
  })

  it('jumps to an instant it is set to', () => {
    // Scenario: set from a string and from a Date.
    const clock = new ManualClock()
    clock.set('2026-06-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-06-01T00:00:00.000Z')
    clock.set(new Date('2026-07-01T00:00:00.000Z'))
    expect(clock.now().toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('hands out a copy, so a caller cannot move the clock through its result', () => {
    // Scenario: the returned date is changed; the next read is unaffected.
    const clock = new ManualClock()
    clock.now().setUTCFullYear(1999)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})
