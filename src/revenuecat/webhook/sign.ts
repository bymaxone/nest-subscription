/**
 * @fileoverview The one construction of a RevenueCat webhook signature: HMAC-SHA256, keyed with the
 * signing secret, over `<timestamp>.<raw body>`. The adapter verifies with it and the request
 * builder of the testing subpath signs with it, so the two cannot diverge. The body is hashed as
 * the bytes it is, never decoded and encoded again.
 * @layer revenuecat
 */
import { createHmac } from 'node:crypto'

/**
 * The digest of a webhook: HMAC-SHA256 of `<timestamp>.<raw body>` keyed with the signing secret.
 *
 * @param secret The signing secret.
 * @param timestamp The timestamp exactly as it is written in the signature header.
 * @param rawBody The request body as bytes.
 */
export function webhookDigest(secret: string, timestamp: string, rawBody: Uint8Array): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest()
}

/**
 * The value of the `X-RevenueCat-Webhook-Signature` header for a body: `t=<timestamp>,v1=<hex>`.
 * It is what RevenueCat sends, which makes it what a test of a receiver needs to send.
 *
 * @param secret The signing secret.
 * @param timestamp The Unix timestamp in seconds the signature carries.
 * @param rawBody The request body as bytes.
 */
export function signRevenueCatWebhook(
  secret: string,
  timestamp: number,
  rawBody: Uint8Array
): string {
  const written = String(timestamp)
  return `t=${written},v1=${webhookDigest(secret, written, rawBody).toString('hex')}`
}
