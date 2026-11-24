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
 * Tenant and account never meet anywhere else in the library.
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
