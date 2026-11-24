/**
 * @fileoverview The one error class of the library. It carries a code from the closed catalogue
 * and the catalogue's fixed message, and serializes to nothing else.
 * @layer shared
 */
import { SUBSCRIPTION_ERROR_MESSAGES, type SubscriptionErrorCode } from './error-codes'

/** The fixed message of a code, followed by the option paths when there are any. */
function composeMessage(code: SubscriptionErrorCode, optionPaths: readonly string[]): string {
  const fixed = SUBSCRIPTION_ERROR_MESSAGES[code]
  return optionPaths.length === 0 ? fixed : `${fixed} Offending options: ${optionPaths.join(', ')}.`
}

/**
 * The error every part of the library raises. The message is the fixed text of the code, so it
 * never holds an account or tenant identifier, a secret or a provider payload. The optional cause
 * stays on the standard `cause` property for debugging and is left out of the serialized form.
 *
 * A configuration error may also name the options that are wrong. The names are appended to the
 * message and kept on `optionPaths`; a name is a path the library wrote, never a value the host
 * supplied.
 */
export class SubscriptionError extends Error {
  /** The code from the closed catalogue. */
  readonly code: SubscriptionErrorCode

  /** The paths of the offending options, in the order they were given; empty when none apply. */
  readonly optionPaths: readonly string[]

  /**
   * @param code A code of the catalogue; its fixed message becomes the error's message.
   * @param options The standard options bag, plus the option paths a configuration error names.
   */
  constructor(
    code: SubscriptionErrorCode,
    options?: { readonly cause?: unknown; readonly optionPaths?: readonly string[] }
  ) {
    const optionPaths = Object.freeze([...(options?.optionPaths ?? [])])
    super(composeMessage(code, optionPaths), options)
    this.name = 'SubscriptionError'
    this.code = code
    this.optionPaths = optionPaths
  }

  /** The serialized form: the code and the message, nothing else. */
  toJSON(): { readonly code: SubscriptionErrorCode; readonly message: string } {
    return { code: this.code, message: this.message }
  }
}
