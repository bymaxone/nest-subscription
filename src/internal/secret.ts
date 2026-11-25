/**
 * @fileoverview The holder of every credential and webhook secret the library keeps. The values
 * live in `#private` fields, which no enumeration, spread, serialization or inspection reaches,
 * and a value comes out only through an explicit call. It supports two valid values at once, so a
 * secret can be rotated without downtime (SEC09).
 * @layer internal
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { inspect } from 'node:util'

import { SUBSCRIPTION_ERROR_CODES, SubscriptionError } from '@bymax-one/nest-subscription/shared'

/** What every serialization, inspection and string conversion of a secret shows instead of it. */
export const SECRET_PLACEHOLDER = '[Secret]'

/** The ways a host or an adapter may give a secret: one value, a rotation pair, or a holder. */
export type SecretInput = string | { readonly current: string; readonly previous?: string } | Secret

/** A usable secret value: a string with at least one character. */
function isUsable(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The fixed-width digest of a value, so two values of any length compare as equal-length buffers. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Holds one secret, or two during a rotation. A deliberate read is `reveal()` or `candidates()`;
 * everything else shows {@link SECRET_PLACEHOLDER}. Never rely on TypeScript `private` for this:
 * it is erased at run time and leaves the property enumerable.
 */
export class Secret {
  readonly #current: string
  readonly #previous: string | undefined

  /**
   * @param current The value in force.
   * @param previous The value retired by a rotation that is still valid, when there is one.
   * @throws SubscriptionError with the invalid-configuration code for an empty or non-string value.
   *   The error never contains the value.
   */
  constructor(current: string, previous?: string) {
    if (!isUsable(current) || (previous !== undefined && !isUsable(previous))) {
      throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.CONFIG_INVALID)
    }
    this.#current = current
    this.#previous = previous
    Object.freeze(this)
  }

  /** Wraps what a host passed; a secret already wrapped is returned as it is. */
  static from(input: SecretInput): Secret {
    if (input instanceof Secret) return input
    return typeof input === 'string' ? new Secret(input) : new Secret(input.current, input.previous)
  }

  /** The value in force. This is the deliberate read: nothing else returns a value. */
  reveal(): string {
    return this.#current
  }

  /** Every value that is valid now: the current one, then the previous one during a rotation. */
  candidates(): readonly string[] {
    return Object.freeze(
      this.#previous === undefined ? [this.#current] : [this.#current, this.#previous]
    )
  }

  /**
   * Whether a presented value equals any valid value. Both sides are reduced to a SHA-256 digest
   * first, so `timingSafeEqual` always sees equal-length buffers and the length of a value never
   * decides the path taken. Every candidate is compared, whether or not an earlier one matched.
   */
  matches(presented: string): boolean {
    if (typeof presented !== 'string') return false
    const wanted = digest(presented)
    let matched = 0
    for (const candidate of this.candidates()) {
      matched |= timingSafeEqual(digest(candidate), wanted) ? 1 : 0
    }
    return matched === 1
  }

  /** The placeholder, so a serialized object holding a secret does not look broken. */
  toJSON(): string {
    return SECRET_PLACEHOLDER
  }

  /** The placeholder, for string conversion and template literals. */
  toString(): string {
    return SECRET_PLACEHOLDER
  }

  /** The placeholder, for `util.inspect` and `console` with any options. */
  [inspect.custom](): string {
    return SECRET_PLACEHOLDER
  }
}
