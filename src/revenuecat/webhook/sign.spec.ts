/**
 * @fileoverview Pins the one signing construction: HMAC-SHA256 over `<timestamp>.<raw body>`, the
 * header text `t=<timestamp>,v1=<hex>`, and that the verifier accepts what it signs.
 * @layer revenuecat
 */
import { createHmac } from 'node:crypto'

import { Secret } from '@bymax-one/nest-subscription/internal'

import { signRevenueCatWebhook, webhookDigest } from './sign'
import { verifySignature } from './verify-signature'

const SECRET = 'sentinel-signing-secret-0a1b'
const BODY = new TextEncoder().encode('{"event":{"id":"event_PLACEHOLDER_1"}}')

describe('webhookDigest', () => {
  it('is HMAC-SHA256 of the timestamp, a dot and the raw bytes, computed independently', () => {
    // Scenario: the documented construction written out in the test.
    const expected = createHmac('sha256', SECRET)
      .update(Buffer.concat([Buffer.from('1795000000.'), BODY]))
      .digest()
    expect(webhookDigest(SECRET, '1795000000', BODY).equals(expected)).toBe(true)
  })

  it('hashes bytes that are not UTF-8 as they are', () => {
    // Scenario: a body that a decode and encode would change gives its own digest.
    const odd = Uint8Array.from([0xff, 0xfe])
    const expected = createHmac('sha256', SECRET)
      .update(Buffer.concat([Buffer.from('1.'), odd]))
      .digest()
    expect(webhookDigest(SECRET, '1', odd).equals(expected)).toBe(true)
  })

  it('writes the timestamp as given, so a leading zero is signed as it is sent', () => {
    // Scenario: the header's own text is what is signed.
    expect(webhookDigest(SECRET, '01', BODY).equals(webhookDigest(SECRET, '1', BODY))).toBe(false)
  })
})

describe('signRevenueCatWebhook', () => {
  it('writes the header RevenueCat sends: the timestamp and the hexadecimal digest', () => {
    // Scenario: the exact text of the header value.
    expect(signRevenueCatWebhook(SECRET, 1795000000, BODY)).toBe(
      `t=1795000000,v1=${webhookDigest(SECRET, '1795000000', BODY).toString('hex')}`
    )
  })

  it('is accepted by the verifier, and refused once the body or the secret changes', () => {
    // Scenario: the signer and the verifier share one construction.
    const header = signRevenueCatWebhook(SECRET, 1795000000, BODY)
    const request = { rawBody: BODY, headers: { 'x-revenuecat-webhook-signature': header } }
    expect(verifySignature(new Secret(SECRET), request, 1795000000_000, 1000)).toBe(true)
    expect(verifySignature(new Secret('other'), request, 1795000000_000, 1000)).toBe(false)
    expect(
      verifySignature(
        new Secret(SECRET),
        { ...request, rawBody: Uint8Array.from([...BODY, 1]) },
        1795000000_000,
        1000
      )
    ).toBe(false)
  })
})
