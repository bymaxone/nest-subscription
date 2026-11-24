/**
 * @fileoverview The one parser of an instant the library accepts from a caller or a store. It
 * takes an ISO 8601 instant with a zone and nothing else, so no host locale or engine fallback
 * ever decides what a string means.
 * @layer shared
 */
import { SUBSCRIPTION_ERROR_CODES } from './error-codes'
import { SubscriptionError } from './subscription.error'

/**
 * A date, a `T`, a time with seconds, an optional fraction and a zone that is `Z` or a numeric
 * offset with a colon. The offset groups are absent for `Z`.
 */
const INSTANT =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,9})?(?:Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/

/**
 * Whether the year, month and day name a day of the calendar. A day past the end of its month, or
 * before its start, or a month outside 1 to 12, rolls the probe into another month.
 */
function isCalendarDay(year: number, month: number, day: number): boolean {
  const probe = new Date(0)
  probe.setUTCFullYear(year, month - 1, day)
  return probe.getUTCMonth() === month - 1
}

/** Whether the matched groups hold a day of the calendar and a time of day within its ranges. */
function isReal(groups: Readonly<Record<string, string | undefined>>): boolean {
  const { year, month, day, hour, minute, second, offsetHour, offsetMinute } = groups
  // An absent offset group is NaN, which no `>` comparison counts as out of range.
  return (
    isCalendarDay(Number(year), Number(month), Number(day)) &&
    !(Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) &&
    !(Number(offsetHour) > 23 || Number(offsetMinute) > 59)
  )
}

/**
 * Reads an ISO 8601 instant, in milliseconds since the epoch. The string needs a date, a `T`, a
 * time with seconds, an optional fraction and `Z` or an offset such as `+02:00`. A string of any
 * other shape, or one that names a day or a time that does not exist (month 13, the 30th of
 * February, hour 24, second 60), is refused.
 *
 * @throws {SubscriptionError} with the invalid-input code when the string is not such an instant.
 */
export function parseInstant(value: string): number {
  const groups = INSTANT.exec(value)?.groups
  if (groups === undefined || !isReal(groups)) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
  return Date.parse(value)
}
