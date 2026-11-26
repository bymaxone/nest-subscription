/**
 * @fileoverview Pins how one parsed subscription becomes a record: the instants, the environment,
 * the access-until rule and the refund reading, at the boundaries each rule has.
 * @layer revenuecat
 */
import { environmentOf, mapSubscription, toInstant } from './map-subscription'
import type { ParsedSubscription } from './parse-customer'

const NOW = '2026-11-25T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const DAY = 86_400_000

function parsed(overrides: Partial<ParsedSubscription> = {}): ParsedSubscription {
  return {
    id: 's1',
    status: 'active',
    givesAccess: true,
    autoRenewalStatus: 'will_renew',
    store: 'app_store',
    environment: 'production',
    productId: 'product_1',
    startsAt: NOW_MS - 10 * DAY,
    currentPeriodStartsAt: NOW_MS - DAY,
    currentPeriodEndsAt: NOW_MS + DAY,
    endsAt: null,
    managementUrl: null,
    entitlements: [],
    entitlementsIncomplete: false,
    ...overrides
  }
}

describe('toInstant', () => {
  it.each([
    [0, '1970-01-01T00:00:00.000Z'],
    [NOW_MS, NOW]
  ])('turns %s milliseconds into %s', (millis, expected) => {
    // Scenario: the API gives milliseconds since the epoch; the model holds ISO instants.
    expect(toInstant(millis)).toBe(expected)
  })

  it.each([null, 8.64e15 + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'gives null for %s, which is no date',
    (millis) => {
      // Scenario: a count a Date cannot hold is no instant, and no exception.
      expect(toInstant(millis)).toBeNull()
    }
  )
})

describe('environmentOf', () => {
  it.each([
    ['production', 'production'],
    ['sandbox', 'sandbox'],
    [null, 'sandbox'],
    ['', 'sandbox'],
    ['PRODUCTION', 'sandbox'],
    ['staging', 'sandbox']
  ])('reads %j as %s', (value, expected) => {
    // Scenario: only the exact value `production` is production (SEC07).
    expect(environmentOf(value)).toBe(expected)
  })
})

describe('mapSubscription access-until', () => {
  it('is the period end while the period has not ended, with or without access', () => {
    // Scenario: the plain case; the access flag does not change the date.
    const end = new Date(NOW_MS + DAY).toISOString()
    expect(mapSubscription(parsed(), NOW).accessUntil).toBe(end)
    expect(mapSubscription(parsed({ givesAccess: false }), NOW).accessUntil).toBe(end)
  })

  it('is null at the very instant the period ends while access is given', () => {
    // Scenario: boundary; an end that is now is already past, so the source's flag stands.
    expect(mapSubscription(parsed({ currentPeriodEndsAt: NOW_MS }), NOW).accessUntil).toBeNull()
  })

  it('is the period end one millisecond after now while access is given', () => {
    // Scenario: boundary on the other side.
    expect(mapSubscription(parsed({ currentPeriodEndsAt: NOW_MS + 1 }), NOW).accessUntil).toBe(
      new Date(NOW_MS + 1).toISOString()
    )
  })

  it('is the period end that has passed when no access is given', () => {
    // Scenario: without access the date is the end, not null.
    const end = NOW_MS - DAY
    expect(
      mapSubscription(parsed({ givesAccess: false, currentPeriodEndsAt: end }), NOW).accessUntil
    ).toBe(new Date(end).toISOString())
  })

  it('is the period end that has passed when the access flag is absent', () => {
    // Scenario: no flag means no access, so a past end stays a date.
    const end = NOW_MS - DAY
    expect(
      mapSubscription(parsed({ givesAccess: null, currentPeriodEndsAt: end }), NOW).accessUntil
    ).toBe(new Date(end).toISOString())
  })

  it('falls back to the end of the subscription when there is no period end', () => {
    // Scenario: only `ends_at` is given.
    expect(
      mapSubscription(parsed({ currentPeriodEndsAt: null, endsAt: NOW_MS + 2 * DAY }), NOW)
        .accessUntil
    ).toBe(new Date(NOW_MS + 2 * DAY).toISOString())
  })

  it('is null when access is given and no end of any kind is given', () => {
    // Scenario: an open-ended grant, as a lifetime promotional one.
    expect(
      mapSubscription(parsed({ currentPeriodEndsAt: null, endsAt: null }), NOW).accessUntil
    ).toBeNull()
  })

  it('is null without access and without an end', () => {
    // Scenario: a paused subscription with no end date.
    expect(
      mapSubscription(parsed({ givesAccess: false, currentPeriodEndsAt: null, endsAt: null }), NOW)
        .accessUntil
    ).toBeNull()
  })
})

describe('mapSubscription refund', () => {
  const ended = {
    givesAccess: false,
    status: 'expired',
    currentPeriodEndsAt: NOW_MS + DAY
  } as const

  it('reads a subscription that ended before its paid period as refunded at that end', () => {
    // Scenario: no access, expired, and `ends_at` earlier than the period end (see the facts file).
    const record = mapSubscription(parsed({ ...ended, endsAt: NOW_MS - DAY }), NOW)
    expect(record.refundedAt).toBe(new Date(NOW_MS - DAY).toISOString())
    expect(record.accessUntil).toBe(new Date(NOW_MS - DAY).toISOString())
  })

  it.each([
    ['ends exactly at the period end', { endsAt: NOW_MS + DAY }],
    ['ends after the period end', { endsAt: NOW_MS + 2 * DAY }],
    ['has no end', { endsAt: null }],
    ['has no period end', { endsAt: NOW_MS - DAY, currentPeriodEndsAt: null }],
    ['still gives access', { endsAt: NOW_MS - DAY, givesAccess: true }],
    ['has no access flag', { endsAt: NOW_MS - DAY, givesAccess: null }],
    ['is not expired', { endsAt: NOW_MS - DAY, status: 'paused' }],
    ['has no status', { endsAt: NOW_MS - DAY, status: null }]
  ])('does not read a subscription that %s as refunded', (_label, overrides) => {
    // Scenario: each condition of the reading, taken away alone, leaves no refund.
    expect(mapSubscription(parsed({ ...ended, ...overrides }), NOW).refundedAt).toBeNull()
  })
})

describe('mapSubscription fields', () => {
  it('maps the identifiers, the tables and the management address as the source gave them', () => {
    // Scenario: every field that is read straight from the source.
    expect(
      mapSubscription(
        parsed({
          store: 'play_store',
          autoRenewalStatus: 'will_not_renew',
          managementUrl: 'https://m.example'
        }),
        NOW
      )
    ).toMatchObject({
      subscriptionReference: 's1',
      status: 'active',
      givesAccess: true,
      willRenew: 'no',
      origin: 'play_store',
      environment: 'production',
      productReference: 'product_1',
      billingInterval: '',
      billingIssueSince: null,
      cancelledAt: null,
      managementReference: 'https://m.example'
    })
  })

  it('gives access only when the flag is exactly true', () => {
    // Scenario: absent or false flags give no access (SEC01, FR14).
    expect(mapSubscription(parsed({ givesAccess: null }), NOW).givesAccess).toBe(false)
    expect(mapSubscription(parsed({ givesAccess: false }), NOW).givesAccess).toBe(false)
  })

  it('names no product when the source has none', () => {
    // Scenario: a promotional grant has no product.
    expect(mapSubscription(parsed({ productId: null }), NOW).productReference).toBe('')
  })

  it('takes the period start from the period, then the subscription, then the read', () => {
    // Scenario: each fallback in turn.
    expect(mapSubscription(parsed(), NOW).currentPeriodStart).toBe(
      new Date(NOW_MS - DAY).toISOString()
    )
    expect(mapSubscription(parsed({ currentPeriodStartsAt: null }), NOW).currentPeriodStart).toBe(
      new Date(NOW_MS - 10 * DAY).toISOString()
    )
    expect(
      mapSubscription(parsed({ currentPeriodStartsAt: null, startsAt: null }), NOW)
        .currentPeriodStart
    ).toBe(NOW)
  })

  it('takes the period end from the period, then the subscription, then the period start', () => {
    // Scenario: each fallback in turn.
    expect(mapSubscription(parsed(), NOW).currentPeriodEnd).toBe(
      new Date(NOW_MS + DAY).toISOString()
    )
    expect(
      mapSubscription(parsed({ currentPeriodEndsAt: null, endsAt: NOW_MS + 5 }), NOW)
        .currentPeriodEnd
    ).toBe(new Date(NOW_MS + 5).toISOString())
    expect(mapSubscription(parsed({ currentPeriodEndsAt: null }), NOW).currentPeriodEnd).toBe(
      new Date(NOW_MS - DAY).toISOString()
    )
  })
})
