/**
 * @fileoverview Pins the RevenueCat request builder against the adapter that verifies its output:
 * a request built for each method is accepted, each flaw it can build is refused, and the bytes
 * and headers are what RevenueCat sends.
 * @layer testing
 */
import { revenueCatSource } from '@bymax-one/nest-subscription/revenuecat'

import {
  REVENUECAT_REQUEST_FLAWS,
  buildRevenueCatWebhookRequest,
  type RevenueCatRequestFlaw
} from './revenuecat-requests'

const SIGNING = 'sentinel-signing-secret-0a1b'
const AUTHORIZATION = 'sentinel-authorization-5d2e'
const NOW = new Date('2026-11-25T12:00:00.000Z')
const BODY = {
  api_version: '1.0',
  event: { id: 'event_1', type: 'RENEWAL', app_user_id: 'user_1' }
}

function adapter(): ReturnType<typeof revenueCatSource> {
  return revenueCatSource({
    projectId: 'proj_PLACEHOLDER',
    apiKey: 'sentinel-api-key-7f3a',
    webhookAuthorization: AUTHORIZATION,
    webhookSigningSecret: SIGNING,
    clock: { now: () => NOW }
  })
}

const options = { body: BODY, signingSecret: SIGNING, authorization: AUTHORIZATION, now: NOW }

describe('buildRevenueCatWebhookRequest', () => {
  it('builds a request the adapter accepts when both methods are used', async () => {
    // Scenario: the valid request carries the signature and the authorization value.
    const result = await adapter().verifyWebhook(buildRevenueCatWebhookRequest(options))
    expect(result).toMatchObject({ accepted: true, notification: { eventId: 'event_1' } })
  })

  it('builds a request the adapter accepts when only the signature is used', async () => {
    // Scenario: an adapter configured for the signature alone accepts a request that has only it.
    const alone = revenueCatSource({
      projectId: 'p',
      apiKey: 'sentinel-api-key-7f3a',
      webhookSigningSecret: SIGNING,
      clock: { now: () => NOW }
    })
    const built = buildRevenueCatWebhookRequest({ body: BODY, signingSecret: SIGNING, now: NOW })
    expect(Object.keys(built.headers)).toStrictEqual([
      'content-type',
      'x-revenuecat-webhook-signature'
    ])
    expect(await alone.verifyWebhook(built)).toMatchObject({ accepted: true })
  })

  it('builds a request the adapter accepts when only the authorization is used', async () => {
    // Scenario: an adapter configured for the header alone accepts a request that has only it.
    const alone = revenueCatSource({
      projectId: 'p',
      apiKey: 'sentinel-api-key-7f3a',
      webhookAuthorization: AUTHORIZATION,
      clock: { now: () => NOW }
    })
    const built = buildRevenueCatWebhookRequest({
      body: BODY,
      authorization: AUTHORIZATION,
      now: NOW
    })
    expect(Object.keys(built.headers)).toStrictEqual(['content-type', 'authorization'])
    expect(await alone.verifyWebhook(built)).toMatchObject({ accepted: true })
  })

  it.each(REVENUECAT_REQUEST_FLAWS)(
    'builds a request with the flaw %s that the adapter refuses',
    async (flaw) => {
      // Scenario: each invalid variant is refused, and with the one value every refusal has.
      const result = await adapter().verifyWebhook(
        buildRevenueCatWebhookRequest({ ...options, flaw })
      )
      expect(result).toStrictEqual({ accepted: false })
    }
  )

  it.each(REVENUECAT_REQUEST_FLAWS)(
    'changes only what the flaw %s names',
    (flaw: RevenueCatRequestFlaw) => {
      // Scenario: the other parts of the request stay valid, so a refusal is the flaw's.
      const valid = buildRevenueCatWebhookRequest(options)
      const flawed = buildRevenueCatWebhookRequest({ ...options, flaw })
      const changedHeaders = Object.keys({ ...valid.headers, ...flawed.headers }).filter(
        (name) => valid.headers[name] !== flawed.headers[name]
      )
      const bodyChanged = Buffer.compare(valid.rawBody, flawed.rawBody) !== 0
      const expected: Record<RevenueCatRequestFlaw, { headers: string[]; body: boolean }> = {
        wrong_signature: { headers: ['x-revenuecat-webhook-signature'], body: false },
        malformed_signature: { headers: ['x-revenuecat-webhook-signature'], body: false },
        missing_signature: { headers: ['x-revenuecat-webhook-signature'], body: false },
        stale_timestamp: { headers: ['x-revenuecat-webhook-signature'], body: false },
        future_timestamp: { headers: ['x-revenuecat-webhook-signature'], body: false },
        altered_body: { headers: [], body: true },
        wrong_authorization: { headers: ['authorization'], body: false },
        missing_authorization: { headers: ['authorization'], body: false }
      }
      expect({ headers: changedHeaders, body: bodyChanged }).toStrictEqual(expected[flaw])
    }
  )

  it('signs the timestamp of the clock, and moves it by the skew for a stale or a future one', () => {
    // Scenario: the timestamps of the three signatures.
    const timestampOf = (flaw?: RevenueCatRequestFlaw, skewSeconds?: number): number => {
      const header = buildRevenueCatWebhookRequest({
        ...options,
        ...(flaw === undefined ? {} : { flaw }),
        ...(skewSeconds === undefined ? {} : { skewSeconds })
      }).headers['x-revenuecat-webhook-signature']
      return Number(/^t=(\d+),/.exec(header ?? '')?.[1])
    }
    const seconds = NOW.getTime() / 1000
    expect(timestampOf()).toBe(seconds)
    expect(timestampOf('stale_timestamp')).toBe(seconds - 3600)
    expect(timestampOf('future_timestamp')).toBe(seconds + 3600)
    expect(timestampOf('stale_timestamp', 90)).toBe(seconds - 90)
    expect(timestampOf('future_timestamp', 90)).toBe(seconds + 90)
  })

  it('sends an object as JSON, and text and bytes as they are', () => {
    // Scenario: the three forms of body.
    const text = '{"already":"text"}'
    const bytes = Uint8Array.from([0xff, 0x7b])
    expect(new TextDecoder().decode(buildRevenueCatWebhookRequest(options).rawBody)).toBe(
      JSON.stringify(BODY)
    )
    expect(
      new TextDecoder().decode(buildRevenueCatWebhookRequest({ ...options, body: text }).rawBody)
    ).toBe(text)
    expect(buildRevenueCatWebhookRequest({ ...options, body: bytes }).rawBody).toBe(bytes)
  })

  it('adds only the headers of the methods it was given secrets for', () => {
    // Scenario: no secret, no header; the content type is always there.
    expect(
      Object.keys(buildRevenueCatWebhookRequest({ body: BODY, now: NOW }).headers)
    ).toStrictEqual(['content-type'])
    expect(
      Object.keys(
        buildRevenueCatWebhookRequest({ body: BODY, now: NOW, flaw: 'wrong_signature' }).headers
      )
    ).toStrictEqual(['content-type'])
  })

  it('does not alter the options it was given', () => {
    // Scenario: the builder is pure.
    const given = { ...options, flaw: 'altered_body' as const }
    const before = structuredClone(given)
    buildRevenueCatWebhookRequest(given)
    expect(given).toStrictEqual(before)
  })
})
