/**
 * @fileoverview The one error class of the library. It carries a code from the closed catalogue
 * and the catalogue's fixed message, and serializes to nothing else.
 * @layer shared
 */
import { SUBSCRIPTION_ERROR_MESSAGES, type SubscriptionErrorCode } from './error-codes'

/**
 * The error every part of the library raises. The message is the fixed text of the code, so it
 * never holds an account or tenant identifier, a secret or a provider payload. The optional cause
 * stays on the standard `cause` property for debugging and is left out of the serialized form.
 */
export class SubscriptionError extends Error {
  /** The code from the closed catalogue. */
  readonly code: SubscriptionErrorCode

  /**
   * @param code A code of the catalogue; its fixed message becomes the error's message.
   * @param options The standard options bag; only `cause` is read.
   */
  constructor(code: SubscriptionErrorCode, options?: { readonly cause?: unknown }) {
    super(SUBSCRIPTION_ERROR_MESSAGES[code], options)
    this.name = 'SubscriptionError'
    this.code = code
  }

  /** The serialized form: the code and the message, nothing else. */
  toJSON(): { readonly code: SubscriptionErrorCode; readonly message: string } {
    return { code: this.code, message: this.message }
  }
}
