/**
 * @fileoverview Pins how a verified webhook body becomes a notification: each recorded event
 * fixture, the event identifier, the time and the environment, and every body that is not the
 * expected shape, which is the unknown kind and never an error.
 * @layer revenuecat
 */
import { createHash } from 'node:crypto'

import { loadFixture } from '../revenuecat.fixture'
import { parseEvent } from './parse-event'

const NOW = new Date('2026-11-25T12:00:00.000Z')
const EVENT_TIME = '2026-11-18T11:06:40.000Z'

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const fixtureBytes = (name: string): Uint8Array => bytes(loadFixture(name))

describe('parseEvent of a recorded event', () => {
  it.each([
    ['webhook-initial-purchase', 'initial_purchase', ['user_PLACEHOLDER_a']],
    ['webhook-renewal', 'renewal', ['user_PLACEHOLDER_a']],
    ['webhook-cancellation', 'cancellation', ['user_PLACEHOLDER_a']],
    ['webhook-refund', 'cancellation', ['user_PLACEHOLDER_a']],
    ['webhook-uncancellation', 'uncancellation', ['user_PLACEHOLDER_a']],
    ['webhook-non-renewing-purchase', 'non_renewing_purchase', ['user_PLACEHOLDER_a']],
    ['webhook-subscription-paused', 'subscription_paused', ['user_PLACEHOLDER_a']],
    ['webhook-expiration', 'expiration', ['user_PLACEHOLDER_a']],
    ['webhook-billing-issue', 'billing_issue', ['user_PLACEHOLDER_a']],
    ['webhook-product-change', 'product_change', ['user_PLACEHOLDER_a']],
    ['webhook-subscriber-alias', 'subscriber_alias', ['user_PLACEHOLDER_a', 'user_PLACEHOLDER_b']],
    ['webhook-with-aliases', 'renewal', ['user_PLACEHOLDER_a', 'user_PLACEHOLDER_b']],
    ['webhook-transfer', 'transfer', ['user_PLACEHOLDER_a', 'user_PLACEHOLDER_b']],
    ['webhook-unknown-kind', 'unknown', ['user_PLACEHOLDER_a']],
    ['webhook-test', 'changes_nothing', []],
    ['webhook-anonymous-only', 'initial_purchase', []]
  ])('turns %s into a %s notification naming %j', (name, kind, accountIds) => {
    // Scenario: the recorded bodies, one per kind the adapter distinguishes.
    const { notification } = parseEvent(fixtureBytes(name), NOW)
    expect(notification).toStrictEqual({
      eventId: `event_PLACEHOLDER_${name.replace('webhook-', '')}`,
      accountIds,
      kind,
      eventTime: EVENT_TIME,
      environment: 'production'
    })
  })

  it('carries a sandbox environment into the notification', () => {
    // Scenario: SANDBOX is carried; the adapter does not drop sandbox events.
    expect(parseEvent(fixtureBytes('webhook-sandbox-purchase'), NOW).notification.environment).toBe(
      'sandbox'
    )
  })

  it('uses the id of the event, not the transaction, as the event identifier', () => {
    // Scenario: retries reuse the id; the transaction id identifies nothing.
    const body = bytes({
      event: { id: 'event_1', transaction_id: 'transaction_1', type: 'RENEWAL', app_user_id: 'a' }
    })
    expect(parseEvent(body, NOW).notification.eventId).toBe('event_1')
  })

  it('reports only an event that names nothing but anonymous identifiers', () => {
    // Scenario: it is flagged for the host and the log, and no account is named.
    expect(parseEvent(fixtureBytes('webhook-anonymous-only'), NOW)).toMatchObject({
      unidentified: true,
      notification: { accountIds: [] }
    })
    expect(parseEvent(fixtureBytes('webhook-with-aliases'), NOW).unidentified).toBe(false)
    expect(parseEvent(fixtureBytes('webhook-initial-purchase'), NOW).unidentified).toBe(false)
  })

  it('does not report a test event that names only an anonymous identifier', () => {
    // Scenario: an event that changes nothing is not a lost purchase.
    const body = bytes({ event: { id: 'e', type: 'TEST', app_user_id: '$RCAnonymousID:x' } })
    expect(parseEvent(body, NOW).unidentified).toBe(false)
  })

  it('takes nothing but the identifier, the accounts, the kind, the time and the environment from the payload', () => {
    // Scenario: SEC01: nothing but identifiers, kind, time and environment leaves the parser.
    const body = bytes({
      event: {
        id: 'e',
        type: 'RENEWAL',
        app_user_id: 'a',
        expiration_at_ms: 9_999_999_999_999,
        entitlement_ids: ['premium'],
        period_type: 'NORMAL'
      }
    })
    expect(Object.keys(parseEvent(body, NOW).notification).sort()).toStrictEqual([
      'accountIds',
      'environment',
      'eventId',
      'eventTime',
      'kind'
    ])
  })
})

describe('parseEvent of a body that is not the expected shape', () => {
  const digest = (raw: Uint8Array): string =>
    `sha256:${createHash('sha256').update(raw).digest('hex')}`
  const empty = (raw: Uint8Array): unknown => ({
    eventId: digest(raw),
    accountIds: [],
    kind: 'unknown',
    eventTime: NOW.toISOString(),
    environment: 'sandbox'
  })

  it.each([
    ['bytes that are not UTF-8', Uint8Array.from([0xff, 0xfe, 0x7b])],
    ['text that is not JSON', new TextEncoder().encode('not json')],
    ['an empty body', new Uint8Array(0)],
    ['JSON that is not an object', bytes([1, 2])],
    ['JSON null', bytes(null)],
    ['an object with no event', bytes({ api_version: '1.0' })],
    ['an event that is not an object', bytes({ event: 'x' })],
    ['an event with no fields', bytes({ event: {} })]
  ])('yields the unknown kind, no account and a digest for the id, for %s', (_label, raw) => {
    // Scenario: verification passed, the shape did not; no error, and a stable id for the retries.
    expect(parseEvent(raw, NOW)).toStrictEqual({ notification: empty(raw), unidentified: false })
  })

  it('does not repair invalid UTF-8 inside otherwise valid JSON into an identifier', () => {
    // Scenario: a byte that is not UTF-8 would decode to a replacement character and name a
    // mangled account; the body is refused as not readable instead.
    const head = new TextEncoder().encode('{"event":{"id":"e","type":"RENEWAL","app_user_id":"a')
    const tail = new TextEncoder().encode('"}}')
    const raw = Uint8Array.from([...head, 0xff, ...tail])
    expect(parseEvent(raw, NOW)).toStrictEqual({ notification: empty(raw), unidentified: false })
  })

  it('reads whatever fields are usable and falls back for the rest', () => {
    // Scenario: a type that is not a string, an id that is a number and a time that is text.
    const raw = bytes({
      event: {
        id: 5,
        type: 7,
        app_user_id: 'a',
        event_timestamp_ms: 'soon',
        environment: 'PRODUCTION'
      }
    })
    expect(parseEvent(raw, NOW).notification).toStrictEqual({
      eventId: digest(raw),
      accountIds: ['a'],
      kind: 'unknown',
      eventTime: NOW.toISOString(),
      environment: 'production'
    })
  })

  it.each([undefined, null, '', 'production', 'Production', 'STAGING', 7])(
    'reads the environment %j as sandbox',
    (environment) => {
      // Scenario: only the exact value PRODUCTION is production.
      const raw = bytes({ event: { id: 'e', type: 'RENEWAL', app_user_id: 'a', environment } })
      expect(parseEvent(raw, NOW).notification.environment).toBe('sandbox')
    }
  )

  it('gives the same identifier to the same bytes and a different one to different bytes', () => {
    // Scenario: a retry of a body with no id is recognised; another body is not mistaken for it.
    const a = new TextEncoder().encode('{"x":1}')
    const b = new TextEncoder().encode('{"x":2}')
    expect(parseEvent(a, NOW).notification.eventId).toBe(parseEvent(a, NOW).notification.eventId)
    expect(parseEvent(a, NOW).notification.eventId).not.toBe(
      parseEvent(b, NOW).notification.eventId
    )
  })
})
