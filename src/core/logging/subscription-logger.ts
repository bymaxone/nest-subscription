/**
 * @fileoverview The one place the library writes a log line. A line is a fixed sentence for one
 * closed event plus an error code of the catalogue, so no account identifier, no tenant, no
 * payload and no error text can reach a log through it.
 * @layer core
 */
import type { SubscriptionErrorCode } from '@bymax-one/nest-subscription/shared'

/**
 * Where the library writes its warnings. A host passes any object with a `warn` method, such as
 * a NestJS `Logger`; the library calls nothing else on it.
 */
export interface SubscriptionLogger {
  /** Writes one warning line. */
  warn(message: string): void
}

/** The things the library logs. Each has one fixed sentence. */
export type LogEvent =
  'background_refresh_failed' | 'change_hook_failed' | 'change_clear_failed' | 'change_read_failed'

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
  }
}

/**
 * Logs one event with the code of the error that caused it, or `unclassified` for an error that
 * is not the library's. Nothing raised by the logger leaves this function, so a broken logger
 * never turns a handled failure into an unhandled one.
 *
 * @param logger The logger the host configured.
 * @param event The event; it picks the sentence.
 * @param code The catalogue code of the error, or `null` when it was not one.
 */
export function logEvent(
  logger: SubscriptionLogger,
  event: LogEvent,
  code: SubscriptionErrorCode | null
): void {
  try {
    logger.warn(`${sentenceOf(event)}: ${code ?? 'unclassified'}.`)
  } catch {
    // A logger that throws must not break the operation it reports on.
  }
}
