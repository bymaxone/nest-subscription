/**
 * @fileoverview Request builders for tests of a host that receives RevenueCat webhooks: a request
 * the adapter accepts, signed or carrying the authorization header, and each way a request can be
 * wrong on purpose. It signs through the adapter's own function, so a builder and the verifier
 * cannot disagree about the construction.
 * @layer testing
 */
import type { WebhookRequest } from '@bymax-one/nest-subscription'
import { signRevenueCatWebhook } from '@bymax-one/nest-subscription/revenuecat'

/** The ways a built request can be made invalid on purpose. */
export const REVENUECAT_REQUEST_FLAWS = Object.freeze([
  'wrong_signature',
  'malformed_signature',
  'missing_signature',
  'stale_timestamp',
  'future_timestamp',
  'altered_body',
  'wrong_authorization',
  'missing_authorization'
] as const)

/** One of the values of {@link REVENUECAT_REQUEST_FLAWS}. */
export type RevenueCatRequestFlaw = (typeof REVENUECAT_REQUEST_FLAWS)[number]

/** What to build. */
export interface RevenueCatRequestOptions {
  /** The webhook body: an object that is sent as JSON, or the bytes or the text to send as they are. */
  readonly body: unknown
  /** The signing secret. Setting it adds the signature header. */
  readonly signingSecret?: string
  /** The authorization value RevenueCat is configured to send. Setting it adds the header. */
  readonly authorization?: string
  /** The instant the request is made at, which the timestamp of the signature is taken from. */
  readonly now: Date
  /** How far a stale or future timestamp is from `now`, in seconds. Defaults to 3 600. */
  readonly skewSeconds?: number
  /** Makes the request invalid in one way; the others stay valid. */
  readonly flaw?: RevenueCatRequestFlaw
}

/** The raw bytes of a body: bytes and text as they are, anything else as JSON. */
function bytesOf(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body
  return new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body))
}

/** The same bytes with one more space at the end, which a signature over the original refuses. */
function altered(rawBody: Uint8Array): Uint8Array {
  return Uint8Array.from([...rawBody, 0x20])
}

/** The signature header value, valid or flawed as the options say; `undefined` when it is absent. */
function signatureOf(options: RevenueCatRequestOptions, rawBody: Uint8Array): string | undefined {
  const { signingSecret, flaw } = options
  if (signingSecret === undefined || flaw === 'missing_signature') return undefined
  const seconds = Math.floor(options.now.getTime() / 1000)
  const skew = options.skewSeconds ?? 3600
  if (flaw === 'malformed_signature') return `t=${String(seconds)}`
  if (flaw === 'wrong_signature') {
    return signRevenueCatWebhook(`${signingSecret}-wrong`, seconds, rawBody)
  }
  if (flaw === 'stale_timestamp')
    return signRevenueCatWebhook(signingSecret, seconds - skew, rawBody)
  if (flaw === 'future_timestamp')
    return signRevenueCatWebhook(signingSecret, seconds + skew, rawBody)
  return signRevenueCatWebhook(signingSecret, seconds, rawBody)
}

/** The authorization header value, valid or flawed as the options say; `undefined` when absent. */
function authorizationOf(options: RevenueCatRequestOptions): string | undefined {
  const { authorization, flaw } = options
  if (flaw === 'missing_authorization') return undefined
  return flaw === 'wrong_authorization' && authorization !== undefined
    ? `${authorization}-wrong`
    : authorization
}

/**
 * Builds a webhook request as RevenueCat sends it: the raw bytes of the body and the headers. The
 * signature is computed over the bytes before a flaw changes them, so `altered_body` is a body
 * changed after signing. Nothing is sent and nothing is read from the environment.
 *
 * @param options The body, the secrets to sign with, the time and, optionally, one flaw.
 */
export function buildRevenueCatWebhookRequest(options: RevenueCatRequestOptions): WebhookRequest {
  const signed = bytesOf(options.body)
  const signature = signatureOf(options, signed)
  const authorization = authorizationOf(options)
  return {
    rawBody: options.flaw === 'altered_body' ? altered(signed) : signed,
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'x-revenuecat-webhook-signature': signature }),
      ...(authorization === undefined ? {} : { authorization })
    }
  }
}
