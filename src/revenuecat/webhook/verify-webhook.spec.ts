/**
 * @fileoverview Pins how the configured methods combine: each configured method must pass, none
 * configured passes nothing, a request that is not well formed is refused without throwing, the
 * refusal is one frozen value, and the header-only report is written once.
 * @layer revenuecat
 */
import { createHmac } from 'node:crypto'

import { Secret } from '@bymax-one/nest-subscription/internal'

import { resolveRevenueCatOptions, type ResolvedRevenueCatOptions } from '../revenuecat.options'
import { HEADER_ONLY_WARNING, REFUSED, isAuthentic, reportWeakMethod } from './verify-webhook'

const HEADER = 'sentinel-authorization-5d2e'
const SIGNING = 'sentinel-signing-secret-0a1b'
const T = 1_795_000_000
const BODY = new TextEncoder().encode('{"event":{"id":"event_PLACEHOLDER_1"}}')
const SIGNATURE = `t=${String(T)},v1=${createHmac('sha256', SIGNING)
  .update(`${String(T)}.`)
  .update(BODY)
  .digest('hex')}`

function optionsWith(extra: Record<string, unknown>): ResolvedRevenueCatOptions {
  return resolveRevenueCatOptions({
    projectId: 'project-1',
    apiKey: 'sentinel-api-key-7f3a',
    clock: { now: () => new Date(T * 1000) },
    ...extra
  })
}

const request = (
  headers: Record<string, string | undefined>
): { rawBody: Uint8Array; headers: Record<string, string | undefined> } => ({
  rawBody: BODY,
  headers
})

describe('isAuthentic', () => {
  const both = optionsWith({ webhookAuthorization: HEADER, webhookSigningSecret: SIGNING })

  it.each([
    [
      'header only configured, header right',
      optionsWith({ webhookAuthorization: HEADER }),
      { authorization: HEADER },
      true
    ],
    [
      'header only configured, header wrong',
      optionsWith({ webhookAuthorization: HEADER }),
      { authorization: 'x' },
      false
    ],
    [
      'header only configured, signature right and header missing',
      optionsWith({ webhookAuthorization: HEADER }),
      { 'x-revenuecat-webhook-signature': SIGNATURE },
      false
    ],
    [
      'signature only configured, signature right',
      optionsWith({ webhookSigningSecret: SIGNING }),
      { 'x-revenuecat-webhook-signature': SIGNATURE },
      true
    ],
    [
      'signature only configured, signature missing',
      optionsWith({ webhookSigningSecret: SIGNING }),
      { authorization: HEADER },
      false
    ],
    [
      'both configured, both right',
      both,
      { authorization: HEADER, 'x-revenuecat-webhook-signature': SIGNATURE },
      true
    ],
    [
      'both configured, header wrong',
      both,
      { authorization: 'x', 'x-revenuecat-webhook-signature': SIGNATURE },
      false
    ],
    [
      'both configured, signature wrong',
      both,
      {
        authorization: HEADER,
        'x-revenuecat-webhook-signature': `t=${String(T)},v1=${'0'.repeat(64)}`
      },
      false
    ],
    ['both configured, only the header sent', both, { authorization: HEADER }, false],
    [
      'neither configured, both sent right',
      optionsWith({}),
      { authorization: HEADER, 'x-revenuecat-webhook-signature': SIGNATURE },
      false
    ]
  ])('with %s the request is authentic: %s', (_label, options, headers, expected) => {
    // Scenario: every configured method must pass, and with no method configured nothing does.
    expect(isAuthentic(options, request(headers))).toBe(expected)
  })

  it('uses the injected clock and the configured tolerance for the signature', () => {
    // Scenario: the same signature is fresh at one time and stale at another, by the tolerance set.
    const at = (nowMs: number, tolerance: number): boolean =>
      isAuthentic(
        optionsWith({
          webhookSigningSecret: SIGNING,
          signatureToleranceMs: tolerance,
          clock: { now: () => new Date(nowMs) }
        }),
        request({ 'x-revenuecat-webhook-signature': SIGNATURE })
      )
    expect(at(T * 1000 + 60_000, 60_000)).toBe(true)
    expect(at(T * 1000 + 60_001, 60_000)).toBe(false)
    expect(at(T * 1000 + 60_001, 120_000)).toBe(true)
  })

  it.each([
    ['a body that is a string', { rawBody: 'text', headers: { authorization: HEADER } }],
    ['a body that is undefined', { rawBody: undefined, headers: { authorization: HEADER } }],
    ['headers that are null', { rawBody: BODY, headers: null }],
    ['headers that are undefined', { rawBody: BODY, headers: undefined }]
  ])('refuses a request with %s without throwing', (_label, malformed) => {
    // Scenario: the port promises well-formed requests; a host that breaks the promise gets a refusal.
    const options = optionsWith({ webhookAuthorization: HEADER })
    expect(() => isAuthentic(options, malformed)).not.toThrow()
    expect(isAuthentic(options, malformed)).toBe(false)
  })

  it.each([
    null,
    undefined,
    'text',
    5,
    { rawBody: 'text', headers: {} },
    { rawBody: BODY, headers: null },
    { rawBody: BODY, headers: 'text' },
    { rawBody: BODY }
  ])('refuses the malformed request %j before it reads the clock', (value) => {
    // Scenario: the shape is checked first, so a malformed request costs no check at all.
    const clock = jest.fn(() => new Date(T * 1000))
    const options = optionsWith({ webhookSigningSecret: SIGNING, clock: { now: clock } })
    expect(isAuthentic(options, value)).toBe(false)
    expect(clock).toHaveBeenCalledTimes(0)
  })

  it.each([null, undefined, 'text', 5])('refuses the value %j given as a request', (value) => {
    // Scenario: something that is not an object at all is not a request.
    const options = optionsWith({ webhookAuthorization: HEADER })
    expect(isAuthentic(options, value)).toBe(false)
  })

  it('refuses, and does not throw, when a check itself fails', () => {
    // Scenario: the clock throws; the request is refused.
    const options = optionsWith({
      webhookSigningSecret: SIGNING,
      clock: {
        now: () => {
          throw new Error('clock failed')
        }
      }
    })
    expect(isAuthentic(options, request({ 'x-revenuecat-webhook-signature': SIGNATURE }))).toBe(
      false
    )
  })

  it('checks both configured methods even when the first fails', () => {
    // Scenario: a wrong header does not skip the signature check.
    const clock = jest.fn(() => new Date(T * 1000))
    const options = optionsWith({
      webhookAuthorization: HEADER,
      webhookSigningSecret: SIGNING,
      clock: { now: clock }
    })
    expect(
      isAuthentic(
        options,
        request({ authorization: 'x', 'x-revenuecat-webhook-signature': SIGNATURE })
      )
    ).toBe(false)
    expect(clock).toHaveBeenCalledTimes(1)
  })
})

describe('REFUSED', () => {
  it('is one frozen value that says refused and nothing else', () => {
    // Scenario: SEC03: every refusal returned by the adapter is this value, which holds no reason.
    expect(REFUSED).toStrictEqual({ accepted: false })
    expect(Object.isFrozen(REFUSED)).toBe(true)
  })
})

describe('reportWeakMethod', () => {
  it.each([
    ['only the header is configured', { webhookAuthorization: HEADER }, 1],
    [
      'both methods are configured',
      { webhookAuthorization: HEADER, webhookSigningSecret: SIGNING },
      0
    ],
    ['only the signature is configured', { webhookSigningSecret: SIGNING }, 0],
    ['neither is configured', {}, 0]
  ])('writes the report %s times when %s', (_label, extra, expected) => {
    // Scenario: FR12: the weaker method is allowed and reported, once, through the injected logger.
    const warn = jest.fn()
    reportWeakMethod(optionsWith({ ...extra, logger: { warn } }))
    expect(warn).toHaveBeenCalledTimes(expected)
    if (expected > 0) expect(warn).toHaveBeenCalledWith(HEADER_ONLY_WARNING)
  })

  it('writes nothing, and does not fail, without a logger', () => {
    // Scenario: no logger was given.
    expect(() => reportWeakMethod(optionsWith({ webhookAuthorization: HEADER }))).not.toThrow()
  })

  it('does not fail when the logger does', () => {
    // Scenario: a logger that throws must not stop the adapter from starting.
    const logger = {
      warn: () => {
        throw new Error('logger failed')
      }
    }
    expect(() =>
      reportWeakMethod(optionsWith({ webhookAuthorization: HEADER, logger }))
    ).not.toThrow()
  })

  it('writes a line that holds no secret', () => {
    // Scenario: the line is fixed text.
    expect(HEADER_ONLY_WARNING).not.toContain(HEADER)
    expect(new Secret(HEADER).matches(HEADER_ONLY_WARNING)).toBe(false)
  })
})
