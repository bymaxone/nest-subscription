/**
 * @fileoverview Pins the age of a snapshot: the time since it was fetched, never negative, read
 * from the instant the caller passes and from no clock of its own.
 * @layer core
 */
import { SUBSCRIPTION_ERROR_CODES, createEmptySnapshot } from '@bymax-one/nest-subscription/shared'

import { ageOf, isStale } from './staleness'

const FETCHED = '2026-01-01T00:00:00.000Z'

/** A snapshot fetched at the given instant. */
function fetchedAt(instant: string): ReturnType<typeof createEmptySnapshot> {
  return createEmptySnapshot({ accountId: 'a', source: 's', fetchedAt: instant })
}

describe('ageOf', () => {
  it('is the milliseconds between the fetch instant and now', () => {
    // Scenario: a snapshot fetched ninety seconds and a half before now.
    expect(ageOf(fetchedAt(FETCHED), new Date('2026-01-01T00:01:30.500Z'))).toBe(90_500)
  })

  it('is zero when now is the fetch instant', () => {
    // Scenario: a snapshot read the moment it was fetched.
    expect(ageOf(fetchedAt(FETCHED), new Date(FETCHED))).toBe(0)
  })

  it('is zero, not negative, when the fetch instant is ahead of now', () => {
    // Scenario: a store written by a host whose clock runs ahead of this one.
    expect(ageOf(fetchedAt('2026-01-01T00:00:10.000Z'), new Date(FETCHED))).toBe(0)
  })

  it('reads an instant that carries an offset', () => {
    // Scenario: the same instant written as +02:00 gives the same age.
    expect(
      ageOf(fetchedAt('2026-01-01T02:00:00.000+02:00'), new Date('2026-01-01T00:00:05.000Z'))
    ).toBe(5000)
  })

  it('refuses a fetch instant that is not an ISO 8601 instant', () => {
    // Scenario: a stored snapshot whose fetch instant is garbled raises the invalid-input code.
    expect(() => ageOf(fetchedAt('yesterday'), new Date(FETCHED))).toThrow(
      expect.objectContaining({ code: SUBSCRIPTION_ERROR_CODES.INVALID_INPUT })
    )
  })
})

describe('isStale', () => {
  it('is stale when now is not a readable instant', () => {
    // Scenario: a clock that returns an invalid date cannot show any snapshot current.
    expect(isStale(fetchedAt(FETCHED), new Date(Number.NaN), 60_000)).toBe(true)
  })

  const MAX = 60_000

  it('is false when the snapshot is younger than the maximum age', () => {
    // Scenario: one millisecond under the limit.
    expect(isStale(fetchedAt(FETCHED), new Date('2026-01-01T00:00:59.999Z'), MAX)).toBe(false)
  })

  it('is false when the snapshot is exactly as old as the maximum age', () => {
    // Scenario: the boundary; only a snapshot older than the maximum is stale.
    expect(isStale(fetchedAt(FETCHED), new Date('2026-01-01T00:01:00.000Z'), MAX)).toBe(false)
  })

  it('is true when the snapshot is one millisecond older than the maximum age', () => {
    // Scenario: just past the boundary.
    expect(isStale(fetchedAt(FETCHED), new Date('2026-01-01T00:01:00.001Z'), MAX)).toBe(true)
  })

  it('is false for a fetch instant ahead of now', () => {
    // Scenario: a negative raw age counts as zero, so it is never stale, even with a zero limit.
    expect(isStale(fetchedAt('2026-01-01T00:00:10.000Z'), new Date(FETCHED), 0)).toBe(false)
  })
})
