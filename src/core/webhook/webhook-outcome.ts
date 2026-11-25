/**
 * @fileoverview The five outcomes of handling one webhook request and the one function that turns
 * an outcome into the HTTP answer the source's contract expects. An outcome holds a kind and a
 * count at most, and an answer body is a literal of the catalogue or a kind name, so neither can
 * hold a payload value, a header value or an account identifier.
 * @layer core
 */
import { SubscriptionError } from '@bymax-one/nest-subscription/internal'
import { SUBSCRIPTION_ERROR_CODES } from '@bymax-one/nest-subscription/shared'

/**
 * What became of one webhook request. The union is closed: a verified notification was processed,
 * had been seen already, or concerned nothing; a request that failed any check was refused; and a
 * notification whose state could not be read was a failure the source should retry.
 */
export type WebhookOutcome =
  | {
      /** The notification was new and every account it names was read from the source. */
      readonly kind: 'processed'
      /** How many distinct accounts were read. */
      readonly accounts: number
    }
  | {
      /** The event identifier was recorded already; the source was not read. */
      readonly kind: 'duplicate'
    }
  | {
      /** The notification names no account, so there was nothing to read. */
      readonly kind: 'ignored'
    }
  | {
      /** Verification failed, whatever the cause. The outcome says nothing about which check. */
      readonly kind: 'refused'
    }
  | {
      /** The source could not be read in time; its identifier was forgotten so a retry runs. */
      readonly kind: 'failed'
    }

/** The HTTP answer to a webhook request: a status and a body that serializes as JSON. */
export interface WebhookAnswer {
  /** The HTTP status. */
  readonly status: number
  /** The JSON body. Never holds payload content or an identifier. */
  readonly body: Readonly<Record<string, string | number>>
}

/** The answer to a refusal: one status and one body for every cause, built once. */
const REFUSED: WebhookAnswer = Object.freeze({
  status: 401,
  body: Object.freeze({
    ...new SubscriptionError(SUBSCRIPTION_ERROR_CODES.WEBHOOK_REFUSED).toJSON()
  })
})

/** The answer to a failure: the source retries on any status but 200. */
const FAILED: WebhookAnswer = Object.freeze({
  status: 503,
  body: Object.freeze({
    ...new SubscriptionError(SUBSCRIPTION_ERROR_CODES.SOURCE_UNAVAILABLE).toJSON()
  })
})

/**
 * The HTTP answer the source's contract expects for an outcome: 200 for a processed, a repeated
 * or an ignored notification so the source stops retrying, 401 for a refusal and 503 for a
 * failure so the source retries. The refusal's answer is the same object for every cause.
 *
 * @param outcome What became of the request.
 * @returns The status and the body.
 */
export function toHttpAnswer(outcome: WebhookOutcome): WebhookAnswer {
  switch (outcome.kind) {
    case 'processed':
      return { status: 200, body: { outcome: 'processed', accounts: outcome.accounts } }
    case 'duplicate':
      return { status: 200, body: { outcome: 'duplicate' } }
    case 'ignored':
      return { status: 200, body: { outcome: 'ignored' } }
    case 'refused':
      return REFUSED
    case 'failed':
      return FAILED
  }
}
