/**
 * @fileoverview The one place that joins a tenant identifier and an account identifier into a key.
 * @layer internal
 *
 * The key is a length-prefixed encoding, not a delimited join. Each field is written as its
 * length in UTF-16 code units, a colon, and then exactly that many units, so a field's content
 * never moves the boundary between fields: a reader skips the stated number of units whatever
 * they are, delimiter characters included. The first character says whether a tenant is present
 * (`t`) or not (`a`), and the parse of any key is therefore unique: read the marker, read the
 * digits up to the colon, take that many units, and repeat for the account. Two different
 * (tenant, account) pairs can only produce the same key if the parse of that key were not unique,
 * which it is. Nothing is hashed, so a host that stores the key can still read it.
 *
 * Tenant and account never meet anywhere else in the library. The decoder lives beside the
 * encoder so the two cannot drift apart; it accepts only what the encoder writes.
 */
import { SUBSCRIPTION_ERROR_CODES, SubscriptionError } from '@bymax-one/nest-subscription/shared'

import type { AccountReference } from './source.port'

/** A field written as its length, a colon and its content. */
function field(marker: string, value: string): string {
  return `${marker}${value.length}:${value}`
}

/**
 * Encodes a tenant and an account into one key such that no two different pairs share it, whatever
 * characters the identifiers hold. An account with no tenant never shares a key with an account
 * that has one, including a tenant that is the empty string.
 *
 * @throws {SubscriptionError} with `SUBSCRIPTION_INVALID_INPUT` when the account identifier is
 * empty or blank.
 */
export function encodeAccountKey(account: AccountReference): string {
  if (account.accountId.trim().length === 0) {
    throw new SubscriptionError(SUBSCRIPTION_ERROR_CODES.INVALID_INPUT)
  }
  const encodedAccount = field('a', account.accountId)
  return account.tenantId === undefined
    ? encodedAccount
    : `${field('t', account.tenantId)}:${encodedAccount}`
}

/** A field as `field` wrote it, read leniently from `from`: its marker, its text and its end. */
function readField(
  key: string,
  from: number
): { readonly marker: string; readonly value: string; readonly end: number } {
  const colon = key.indexOf(':', from)
  const end = colon + 1 + Number(key.slice(from + 1, colon))
  return { marker: key.charAt(from), value: key.slice(colon + 1, end), end }
}

/**
 * Reads a key written by {@link encodeAccountKey} back into its account reference, or returns
 * `null` for anything the encoder could not have written. The key is read leniently and the
 * result is accepted only when encoding it gives exactly the key, so whatever the reading made of
 * malformed text, only a key the encoder writes comes back. The tenant is absent from the result
 * when the key has none.
 */
export function decodeAccountKey(key: string): AccountReference | null {
  const first = readField(key, 0)
  const reference: AccountReference =
    first.marker === 't'
      ? { tenantId: first.value, accountId: readField(key, first.end + 1).value }
      : { accountId: first.value }
  try {
    return encodeAccountKey(reference) === key ? reference : null
  } catch {
    return null
  }
}
