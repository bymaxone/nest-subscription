/**
 * @fileoverview Pins the HMAC signature check of RevenueCat webhooks (AC02 for RevenueCat): a valid
 * signature is accepted; a wrong secret, a wrong digest, a stale or future timestamp, a malformed
 * header and a body altered after signing are each refused; two secrets are accepted during a
 * rotation; and the comparison is `timingSafeEqual` over equal-length buffers.
 * @layer revenuecat
 */
import nodeCrypto from 'node:crypto'

import { Secret } from '@bymax-one/nest-subscription/internal'

import { SIGNATURE_HEADER, parseSignature, verifySignature } from './verify-signature'

const SECRET = 'sentinel-signing-secret-0a1b'
const PREVIOUS = 'sentinel-previous-signing-secret-77ee'
const T = 1_795_000_000
const NOW_MS = T * 1000
const TOLERANCE = 5_000
const BODY = new TextEncoder().encode('{"api_version":"1.0","event":{"id":"event_PLACEHOLDER_1"}}')

/** The digest RevenueCat documents: HMAC-SHA256 over `<t>.<raw body>`, in hexadecimal. */
function digestOf(secret: string, timestamp: string, body: Uint8Array): string {
  return nodeCrypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), body]))
    .digest('hex')
}

function headers(
  value: string | undefined,
  name = SIGNATURE_HEADER
): Record<string, string | undefined> {
  return { [name]: value }
}

function check(
  header: string | undefined,
  options: { secret?: Secret; body?: Uint8Array; nowMs?: number; name?: string } = {}
): boolean {
  return verifySignature(
    options.secret ?? new Secret(SECRET),
    { rawBody: options.body ?? BODY, headers: headers(header, options.name) },
    options.nowMs ?? NOW_MS,
    TOLERANCE
  )
}

const valid = `t=${String(T)},v1=${digestOf(SECRET, String(T), BODY)}`

describe('verifySignature', () => {
  it('accepts the signature RevenueCat documents, computed over the raw bytes', () => {
    // Scenario: a header built independently with the documented construction passes.
    expect(check(valid)).toBe(true)
  })

  it('accepts the header under any capitalisation of its name', () => {
    // Scenario: frameworks hand header names over in different cases.
    expect(check(valid, { name: 'X-RevenueCat-Webhook-Signature' })).toBe(true)
  })

  it('accepts an upper-case digest and a key it does not know', () => {
    // Scenario: hexadecimal is case-insensitive and a key beside v1 is ignored.
    const digest = digestOf(SECRET, String(T), BODY).toUpperCase()
    expect(check(`t=${String(T)},v1=${digest},v0=anything`)).toBe(true)
  })

  it('verifies a body that is not valid UTF-8 over its bytes', () => {
    // Scenario: decoding and re-encoding would change these bytes; the signature covers them as received.
    const body = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d])
    const header = `t=${String(T)},v1=${digestOf(SECRET, String(T), body)}`
    expect(check(header, { body })).toBe(true)
    expect(check(header, { body: new TextEncoder().encode(new TextDecoder().decode(body)) })).toBe(
      false
    )
  })

  it.each([
    ['a wrong secret', valid, { secret: new Secret('another-secret') }],
    [
      'a digest with one digit changed',
      `t=${String(T)},v1=${digestOf(SECRET, String(T), BODY).replace(/.$/, (c) => (c === '0' ? '1' : '0'))}`,
      {}
    ],
    [
      'a body altered after signing',
      valid,
      {
        body: new TextEncoder().encode('{"api_version":"1.0","event":{"id":"event_PLACEHOLDER_2"}}')
      }
    ],
    ['a body with one byte appended', valid, { body: Uint8Array.from([...BODY, 0x20]) }],
    [
      'a timestamp that was not signed',
      `t=${String(T + 1)},v1=${digestOf(SECRET, String(T), BODY)}`,
      { nowMs: NOW_MS + 1000 }
    ],
    ['no header at all', undefined, {}]
  ])('refuses %s', (_label, header, options) => {
    // Scenario: each way a signature can be wrong yields a refusal and no exception.
    expect(check(header, options)).toBe(false)
  })

  describe('the timestamp', () => {
    it.each([
      ['exactly at the tolerance in the past', NOW_MS + TOLERANCE, true],
      ['one millisecond past the tolerance in the past', NOW_MS + TOLERANCE + 1, false],
      ['exactly at the tolerance in the future', NOW_MS - TOLERANCE, true],
      ['one millisecond past the tolerance in the future', NOW_MS - TOLERANCE - 1, false],
      ['at the instant of the signature', NOW_MS, true],
      ['the full retry window of about 80 minutes later', NOW_MS + 80 * 60_000, false]
    ])('with the clock %s the signature is accepted: %s', (_label, nowMs, accepted) => {
      // Scenario: the tolerance is symmetric and inclusive, and a replay long after is refused.
      expect(check(valid, { nowMs })).toBe(accepted)
    })
  })

  describe('a header that does not parse', () => {
    const digest = digestOf(SECRET, String(T), BODY)
    it.each([
      ['an empty header', ''],
      ['a header with no equals sign', 'garbage'],
      ['a header with only a timestamp', `t=${String(T)}`],
      ['a header with only a digest', `v1=${digest}`],
      ['a timestamp that is not digits', `t=abc,v1=${digest}`],
      ['a timestamp with a fraction', `t=${String(T)}.5,v1=${digest}`],
      ['a negative timestamp', `t=-1,v1=${digest}`],
      ['a timestamp of sixteen digits', `t=1234567890123456,v1=${digest}`],
      ['a digest that is too short', `t=${String(T)},v1=${digest.slice(1)}`],
      ['a digest that is too long', `t=${String(T)},v1=${digest}0`],
      ['a digest that is not hexadecimal', `t=${String(T)},v1=${'z'.repeat(64)}`],
      ['a repeated timestamp', `t=${String(T)},t=${String(T)},v1=${digest}`],
      ['a repeated digest', `t=${String(T)},v1=${digest},v1=${digest}`],
      ['a trailing comma', `t=${String(T)},v1=${digest},`],
      ['a part with no key', `=x,t=${String(T)},v1=${digest}`],
      ['a key with a space', `t=${String(T)}, v1=${digest}`]
    ])('refuses %s without throwing', (_label, header) => {
      // Scenario: AC02: a malformed header is a refusal, never an exception.
      expect(() => check(header)).not.toThrow()
      expect(check(header)).toBe(false)
    })
  })

  describe('rotation', () => {
    const pair = new Secret(SECRET, PREVIOUS)

    it.each([
      ['the current secret', SECRET, true],
      ['the previous secret', PREVIOUS, true],
      ['a secret that is neither', 'a-third-secret', false]
    ])(
      'with two secrets configured, a signature by %s is accepted: %s',
      (_label, signer, accepted) => {
        // Scenario: SEC09: during a rotation either configured secret signs a valid request.
        const header = `t=${String(T)},v1=${digestOf(signer, String(T), BODY)}`
        expect(check(header, { secret: pair })).toBe(accepted)
      }
    )
  })

  describe('the comparison', () => {
    it('is timingSafeEqual over equal-length buffers, once for each configured secret', () => {
      // Scenario: constant-time by construction: the primitive is called for every secret, whether
      // or not the first matched, with buffers of the digest length on both sides.
      const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual')
      const header = `t=${String(T)},v1=${digestOf(SECRET, String(T), BODY)}`
      expect(check(header, { secret: new Secret(SECRET, PREVIOUS) })).toBe(true)
      expect(spy).toHaveBeenCalledTimes(2)
      for (const [left, right] of spy.mock.calls) {
        expect(left).toHaveProperty('byteLength', 32)
        expect(right).toHaveProperty('byteLength', 32)
      }
    })

    it('still compares the digest when the timestamp is stale, so the two refusals look alike', () => {
      // Scenario: a stale request does not skip the comparison.
      const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual')
      expect(check(valid, { nowMs: NOW_MS + 10 * TOLERANCE })).toBe(false)
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('does not compare when the header cannot be parsed', () => {
      // Scenario: nothing to compare, so the primitive is not reached.
      const spy = jest.spyOn(nodeCrypto, 'timingSafeEqual')
      expect(check('garbage')).toBe(false)
      expect(spy).toHaveBeenCalledTimes(0)
    })
  })
})

describe('parseSignature', () => {
  it('keeps the timestamp as written and decodes the digest to 32 bytes', () => {
    // Scenario: the signed string holds the header's own text for the timestamp.
    const digest = digestOf(SECRET, '0001795000000', BODY)
    const parsed = parseSignature(`t=0001795000000,v1=${digest}`)
    expect(parsed?.timestamp).toBe('0001795000000')
    expect(parsed?.digest.toString('hex')).toBe(digest)
  })
})
