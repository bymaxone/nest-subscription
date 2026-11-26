/**
 * @fileoverview Maps one RevenueCat subscription into a `SubscriptionRecord`. Access is the
 * source's `gives_access` flag and nothing else: no status name, no date and no renewal status
 * ever decides it. A field the source did not send leaves the record `unknown` or empty, never
 * invented.
 * @layer revenuecat
 */
import type {
  SubscriptionEnvironment,
  SubscriptionRecord
} from '@bymax-one/nest-subscription/shared'

import type { ParsedSubscription } from './parse-customer'
import { mapOrigin } from '../mapping/origin'
import { mapWillRenew } from '../mapping/renewal'
import { mapStatus } from '../mapping/status'

/** The instant of a millisecond count, or `null` when the count is not a date a `Date` holds. */
export function toInstant(millis: number | null): string | null {
  if (millis === null) return null
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The environment of a subscription. Only the exact value `production` is production: a value the
 * source did not send, or one this library does not know, is read as sandbox, so a purchase of
 * unknown origin never grants access by default (SEC07).
 */
export function environmentOf(value: string | null): SubscriptionEnvironment {
  return value === 'production' ? 'production' : 'sandbox'
}

/**
 * The instant a subscription was refunded, when the API shows it. Version 2 has no refund marker
 * on a subscription; a subscription that gives no access, is expired and ended before its paid
 * period did is read as refunded at that earlier end.
 */
function refundedAtOf(parsed: ParsedSubscription): string | null {
  const { endsAt, currentPeriodEndsAt } = parsed
  const refunded =
    parsed.givesAccess === false &&
    parsed.status === 'expired' &&
    endsAt !== null &&
    currentPeriodEndsAt !== null &&
    endsAt < currentPeriodEndsAt
  return refunded ? toInstant(endsAt) : null
}

/**
 * When access ends: the refund instant of a refunded subscription, otherwise the end of the
 * current period, or the end of the subscription when no period end is given. While the source
 * says access is given, an end that has already passed (a grace period, whose own end the API does
 * not state) is not an end: the access-until is `null`, and the next read of the source decides.
 */
function accessUntilOf(
  parsed: ParsedSubscription,
  refundedAt: string | null,
  now: number
): string | null {
  if (refundedAt !== null) return refundedAt
  const end = parsed.currentPeriodEndsAt ?? parsed.endsAt
  if (parsed.givesAccess === true && end !== null && end <= now) return null
  return toInstant(end)
}

/**
 * Builds the record of one subscription.
 *
 * @param parsed The subscription as narrowed from the response.
 * @param fetchedAt The instant of the read, which stands in for a period instant the source did
 *   not send.
 */
export function mapSubscription(parsed: ParsedSubscription, fetchedAt: string): SubscriptionRecord {
  const periodStart =
    toInstant(parsed.currentPeriodStartsAt) ?? toInstant(parsed.startsAt) ?? fetchedAt
  const refundedAt = refundedAtOf(parsed)
  return {
    subscriptionReference: parsed.id,
    status: mapStatus(parsed.status, parsed.givesAccess),
    givesAccess: parsed.givesAccess === true,
    willRenew: mapWillRenew(parsed.autoRenewalStatus),
    origin: mapOrigin(parsed.store),
    environment: environmentOf(parsed.environment),
    productReference: parsed.productId ?? '',
    billingInterval: '',
    currentPeriodStart: periodStart,
    currentPeriodEnd: toInstant(parsed.currentPeriodEndsAt ?? parsed.endsAt) ?? periodStart,
    accessUntil: accessUntilOf(parsed, refundedAt, Date.parse(fetchedAt)),
    billingIssueSince: null,
    cancelledAt: null,
    refundedAt,
    managementReference: parsed.managementUrl
  }
}
