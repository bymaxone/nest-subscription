/**
 * @fileoverview The one place the library writes a log line. A line is a fixed sentence for one
 * closed event plus an error code of the catalogue, so no account identifier, no tenant, no
 * payload and no error text can reach a log through it.
 * @layer core
 */
import { SubscriptionError, hashAccountKey } from '@bymax-one/nest-subscription/internal'
import type { SubscriptionErrorCode } from '@bymax-one/nest-subscription/shared'

/**
 * Where the library writes its warnings. A host passes any object with a `warn` method, such as
 * a NestJS `Logger`; the library calls nothing else on it.
 */
export interface SubscriptionLogger {
  /** Writes one warning line. */
  warn(message: string): void
}

/** The catalogue code of an error, or `null` for one that is not the library's. */
export function errorCodeOf(error: unknown): SubscriptionErrorCode | null {
  return error instanceof SubscriptionError ? error.code : null
}

/** The things the library logs. Each has one fixed sentence. */
export type LogEvent =
  | 'background_refresh_failed'
  | 'change_hook_failed'
  | 'change_clear_failed'
  | 'change_read_failed'
  | 'webhook_forget_failed'
  | 'event_purge_failed'
  | 'webhook_rerecord_failed'
  | 'webhook_raw_body_missing'

/** The fixed sentence of an event. */
function sentenceOf(event: LogEvent): string {
  switch (event) {
    case 'background_refresh_failed':
      return 'Background refresh of a stale snapshot failed'
    case 'change_hook_failed':
      return 'The change hook failed; its changes stay pending and are delivered again'
    case 'change_clear_failed':
      return 'The change hook returned but its changes could not be cleared; they are delivered again'
    case 'change_read_failed':
      return 'The pending changes of an account could not be read for delivery'
    case 'webhook_forget_failed':
      return 'A failed webhook event could not be forgotten; its identifier stays recorded'
    case 'event_purge_failed':
      return 'Processed webhook event identifiers could not be purged'
    case 'webhook_rerecord_failed':
      return 'A processed webhook event could not be recorded again; a later delivery of it is processed again'
    case 'webhook_raw_body_missing':
      return 'A webhook request arrived without its raw body; create the application with rawBody: true'
  }
}

/**
 * Logs one event with a short hash of the account, so the lines of one account can be correlated
 * (an event that concerns no account has none), and the code of the error that caused it, or `unclassified` for an error that is not the
 * library's. The account itself, the tenant and the error's text never reach the line. Nothing
 * raised by the logger leaves this function, so a broken logger never turns a handled failure into
 * an unhandled one.
 *
 * @param logger The logger the host configured.
 * @param event The event; it picks the sentence.
 * @param code The catalogue code of the error, or `null` when it was not one.
 * @param accountKey The output of `encodeAccountKey` for the account the event concerns, or
 * `null` for an event that concerns none.
 */
export function logEvent(
  logger: SubscriptionLogger,
  event: LogEvent,
  code: SubscriptionErrorCode | null,
  accountKey: string | null
): void {
  try {
    const subject = accountKey === null ? '' : ` (account ${hashAccountKey(accountKey)})`
    logger.warn(`${sentenceOf(event)}${subject}: ${code ?? 'unclassified'}.`)
  } catch {
    // A logger that throws must not break the operation it reports on.
  }
}
