/**
 * @fileoverview Applies the verification methods the host configured to one webhook request. Each
 * configured method must pass: the static authorization header, the HMAC signature, or both. A
 * request passes no check when no method is configured, because a receiver that verifies nothing
 * would let anyone name an account to refresh. Every refusal is the same frozen value, so the
 * caller cannot tell which check failed (SEC03).
 * @layer revenuecat
 */
import type { WebhookRequest, WebhookVerification } from '@bymax-one/nest-subscription/internal'

import type { ResolvedRevenueCatOptions } from '../revenuecat.options'
import { verifyAuthorization } from './verify-authorization'
import { verifySignature } from './verify-signature'

/** The one answer to a request that fails any check. */
export const REFUSED: WebhookVerification = Object.freeze({ accepted: false })

/** The line written once at boot when the static header is the only method configured. */
export const HEADER_ONLY_WARNING =
  'RevenueCat webhooks are verified by the static authorization header only; configure the signing secret to verify the HMAC signature as well.'

/**
 * Whether a value is a `WebhookRequest`: raw bytes and a headers object. The port promises both,
 * but a host that calls the adapter itself may not keep the promise.
 */
function isWebhookRequest(request: unknown): request is WebhookRequest {
  if (typeof request !== 'object' || request === null) return false
  const headers: unknown = Reflect.get(request, 'headers')
  return (
    Reflect.get(request, 'rawBody') instanceof Uint8Array &&
    typeof headers === 'object' &&
    headers !== null
  )
}

/**
 * Whether the request passes every configured method. Never throws: a request that cannot be
 * checked fails.
 *
 * @param options The resolved options of the adapter.
 * @param request The raw bytes and the headers as received; anything else is not authentic.
 */
export function isAuthentic(options: ResolvedRevenueCatOptions, request: unknown): boolean {
  const { webhookAuthorization, webhookSigningSecret } = options
  if (webhookAuthorization === null && webhookSigningSecret === null) return false
  try {
    if (!isWebhookRequest(request)) return false
    const header =
      webhookAuthorization === null || verifyAuthorization(webhookAuthorization, request.headers)
    const signature =
      webhookSigningSecret === null ||
      verifySignature(
        webhookSigningSecret,
        request,
        options.clock.now().getTime(),
        options.signatureToleranceMs
      )
    return header && signature
  } catch {
    return false
  }
}

/**
 * Tells the host, once, that the static header is the only check in force. The weaker method is
 * allowed (FR12); it is reported, not refused.
 *
 * @param options The resolved options of the adapter.
 */
export function reportWeakMethod(options: ResolvedRevenueCatOptions): void {
  if (options.webhookAuthorization === null || options.webhookSigningSecret !== null) return
  try {
    options.logger?.warn(HEADER_ONLY_WARNING)
  } catch {
    // A logger that fails must not stop the adapter from starting.
  }
}
