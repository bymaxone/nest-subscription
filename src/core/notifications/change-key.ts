/**
 * @fileoverview The stable key of a change: the same change, computed again from the same two
 * snapshots or from the same state read at another instant, gets the same key, and any other
 * change gets another. The key is derived from snapshot data only and holds no raw identifier.
 * @layer core
 */
import { createHash } from 'node:crypto'

import type { RawChange } from './diff-rules/raw-change'

/** The SHA-256 digest of a text, as 64 lowercase hexadecimal characters. */
function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The key of one change. Each field is hashed to a fixed width on its own and the digests are
 * joined and hashed again, so no field's content can move the boundary between two fields and the
 * number of facts is part of what the key says. The fields are the account key, the kind, the
 * subscription the change concerns (a change of the whole account is told apart from any
 * subscription) and the discriminating facts of its kind.
 *
 * The key does not depend on the fetch instant, on property order or on the order of the
 * subscriptions in a list: the facts a rule hands over are already sorted where a list is one.
 *
 * @param accountKey The output of `encodeAccountKey` for the account; it is hashed and never
 * appears in the key.
 * @param change The change, as a rule found it.
 * @returns 64 lowercase hexadecimal characters.
 */
export function changeKey(accountKey: string, change: RawChange): string {
  const reference =
    change.subscriptionReference === null ? 'none' : `subscription:${change.subscriptionReference}`
  return digest(
    [accountKey, change.kind, reference, ...change.facts].map((field) => digest(field)).join(':')
  )
}
