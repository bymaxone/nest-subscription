/**
 * @fileoverview The HMAC signature method of RevenueCat webhook verification. RevenueCat sends
 * `X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 with the
 * signing secret over `<t>.<raw body>`. The digest is computed over the bytes received, never over
 * a decoded and re-encoded body; the timestamp must be within the tolerance of the clock, in the
 * past or the future; and the comparison is `timingSafeEqual` over equal-length buffers against
 * every configured secret, so a rotation can accept two. A header that does not parse is a
 * refusal, never an exception.
 * @layer revenuecat
 */
import { timingSafeEqual } from 'node:crypto'

import type { Secret } from '@bymax-one/nest-subscription/internal'

import { webhookDigest } from './sign'
import { headerValue } from './verify-authorization'

/** The name of the header that carries the signature. */
export const SIGNATURE_HEADER = 'x-revenuecat-webhook-signature'

/** A parsed signature header. */
interface ParsedSignature {
  /** The timestamp exactly as it was written, which is what the signed string holds. */
  readonly timestamp: string
  /** The presented digest. */
  readonly digest: Buffer
}

const TIMESTAMP = /^\d{1,15}$/
const DIGEST = /^[0-9a-fA-F]{64}$/

/**
 * Reads `t=<digits>,v1=<64 hex digits>`. Each key must appear once; a key this version does not
 * know is ignored, so a scheme beside `v1` does not break it. Anything else is not a signature.
 */
export function parseSignature(header: string): ParsedSignature | null {
  const values = new Map<string, string>()
  for (const part of header.split(',')) {
    const at = part.indexOf('=')
    if (at < 1) return null
    const key = part.slice(0, at)
    if (values.has(key)) return null
    values.set(key, part.slice(at + 1))
  }
  const timestamp = values.get('t')
  const digest = values.get('v1')
  if (timestamp === undefined || digest === undefined) return null
  if (!TIMESTAMP.test(timestamp) || !DIGEST.test(digest)) return null
  return { timestamp, digest: Buffer.from(digest, 'hex') }
}

/** Whether `seconds` is within `toleranceMs` of `nowMs`, before or after it. */
function isFresh(seconds: string, nowMs: number, toleranceMs: number): boolean {
  return Math.abs(nowMs - Number(seconds) * 1000) <= toleranceMs
}

/**
 * Whether any configured secret signs `<timestamp>.<raw body>` as the presented digest. Every
 * secret is checked, whether or not an earlier one matched.
 */
function signedBy(secret: Secret, parsed: ParsedSignature, rawBody: Uint8Array): boolean {
  let matched = 0
  for (const candidate of secret.candidates()) {
    const expected = webhookDigest(candidate, parsed.timestamp, rawBody)
    // Both buffers are 32 bytes: a SHA-256 digest, and 64 hexadecimal digits decoded.
    matched |= timingSafeEqual(expected, parsed.digest) ? 1 : 0
  }
  return matched === 1
}

/**
 * Whether the request carries a valid, fresh signature of its raw bytes.
 *
 * @param secret The signing secret, or the pair of a rotation.
 * @param request The raw bytes and the headers as received.
 * @param nowMs The current time in milliseconds, from the injected clock.
 * @param toleranceMs How far the timestamp may be from `nowMs`, in milliseconds.
 */
export function verifySignature(
  secret: Secret,
  request: {
    readonly rawBody: Uint8Array
    readonly headers: Readonly<Record<string, string | undefined>>
  },
  nowMs: number,
  toleranceMs: number
): boolean {
  const header = headerValue(request.headers, SIGNATURE_HEADER)
  const parsed = header === undefined ? null : parseSignature(header)
  if (parsed === null) return false
  // Both checks run, so a stale timestamp and a wrong digest take the same time to refuse.
  const fresh = isFresh(parsed.timestamp, nowMs, toleranceMs)
  const signed = signedBy(secret, parsed, request.rawBody)
  return fresh && signed
}
