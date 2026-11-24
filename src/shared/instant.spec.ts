/**
 * @fileoverview Pins which strings the instant parser accepts and which it refuses, over a table.
 * @layer shared
 */
import { parseInstant } from './instant'
import { SubscriptionError } from './subscription.error'

/** An accepted string and the instant it denotes, in milliseconds. */
const ACCEPTED: ReadonlyArray<readonly [string, string, number]> = [
  ['UTC with a Z', '2026-01-01T00:00:00Z', Date.UTC(2026, 0, 1)],
  ['milliseconds', '2026-01-01T00:00:00.000Z', Date.UTC(2026, 0, 1)],
  ['a one-digit fraction', '2026-01-01T00:00:00.5Z', Date.UTC(2026, 0, 1, 0, 0, 0, 500)],
  ['a nine-digit fraction', '2026-01-01T00:00:00.123456789Z', Date.UTC(2026, 0, 1, 0, 0, 0, 123)],
  ['a positive offset', '2026-01-01T02:30:00+02:30', Date.UTC(2026, 0, 1)],
  ['a negative offset', '2025-12-31T21:00:00-03:00', Date.UTC(2026, 0, 1)],
  ['a zero offset', '2026-01-01T00:00:00+00:00', Date.UTC(2026, 0, 1)],
  ['the last second of a day', '2026-01-01T23:59:59Z', Date.UTC(2026, 0, 1, 23, 59, 59)],
  ['a leap day of a leap year', '2028-02-29T12:00:00Z', Date.UTC(2028, 1, 29, 12)],
  ['the last day of a 31-day month', '2026-01-31T00:00:00Z', Date.UTC(2026, 0, 31)],
  ['the last day of a 30-day month', '2026-04-30T00:00:00Z', Date.UTC(2026, 3, 30)],
  ['the last day of the year', '2026-12-31T00:00:00Z', Date.UTC(2026, 11, 31)],
  ['the largest offset', '2026-01-01T23:59:00+23:59', Date.UTC(2026, 0, 1)]
]

/** A refused string and why it is not an ISO 8601 instant with a zone. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['a day-first date', '01/02/2026'],
  ['a bare number', '1'],
  ['a month name', 'Feb 1 2026'],
  ['a date without a time', '2026-01-01'],
  ['a time without a zone', '2026-01-01T00:00:00'],
  ['an empty string', ''],
  ['no seconds', '2026-01-01T00:00Z'],
  ['a space for the T', '2026-01-01 00:00:00Z'],
  ['a lowercase t', '2026-01-01t00:00:00Z'],
  ['a lowercase z', '2026-01-01T00:00:00z'],
  ['a month 13', '2026-13-01T00:00:00Z'],
  ['a month 00', '2026-00-01T00:00:00Z'],
  ['a day 00', '2026-01-00T00:00:00Z'],
  ['a day 32', '2026-01-32T00:00:00Z'],
  ['the 30th of February', '2026-02-30T00:00:00Z'],
  ['the 29th of February of a common year', '2026-02-29T00:00:00Z'],
  ['the 29th of February of a century that is not a leap year', '2100-02-29T00:00:00Z'],
  ['the 31st of a 30-day month', '2026-04-31T00:00:00Z'],
  ['hour 24', '2026-01-01T24:00:00Z'],
  ['minute 60', '2026-01-01T00:60:00Z'],
  ['second 60', '2026-01-01T00:00:60Z'],
  ['a fraction with no digit', '2026-01-01T00:00:00.Z'],
  ['a fraction of ten digits', '2026-01-01T00:00:00.1234567890Z'],
  ['an offset hour 24', '2026-01-01T00:00:00+24:00'],
  ['an offset minute 60', '2026-01-01T00:00:00+01:60'],
  ['an offset without a colon', '2026-01-01T00:00:00+0100'],
  ['an offset with only hours', '2026-01-01T00:00:00+01'],
  ['a three-digit year', '202-01-01T00:00:00Z'],
  ['a five-digit year', '12026-01-01T00:00:00Z'],
  ['a one-digit month', '2026-1-01T00:00:00Z'],
  ['a one-digit day', '2026-01-1T00:00:00Z'],
  ['a one-digit hour', '2026-01-01T0:00:00Z'],
  ['a one-digit minute', '2026-01-01T00:0:00Z'],
  ['a one-digit second', '2026-01-01T00:00:0Z'],
  ['text before the instant', ' 2026-01-01T00:00:00Z'],
  ['text after the instant', '2026-01-01T00:00:00Z '],
  ['a second instant after the first', '2026-01-01T00:00:00Z2026-01-01T00:00:00Z'],
  ['a line break inside', '2026-01-01T00:00:00Z\n'],
  ['a letter in a digit place', '2026-0a-01T00:00:00Z']
]

describe('parseInstant', () => {
  it.each(ACCEPTED)('accepts %s', (_form, value, milliseconds) => {
    // Scenario: an ISO 8601 instant with a zone is read to the milliseconds it denotes.
    expect(parseInstant(value)).toBe(milliseconds)
  })

  it.each(REFUSED)('refuses %s', (_form, value) => {
    // Scenario: anything that is not a complete ISO 8601 instant with a zone, or that names a
    // date or a time that does not exist, is a caller error with the catalogue code.
    let failure: unknown
    try {
      parseInstant(value)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(SubscriptionError)
    expect(failure).toMatchObject({ code: 'SUBSCRIPTION_INVALID_INPUT' })
  })
})
