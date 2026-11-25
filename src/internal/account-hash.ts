/**
 * @fileoverview The short, salted, one-way hash of an account key, for correlating the lines of a
 * log. It is the only form in which an account can appear in a log line.
 * @layer internal
 */
import { createHmac, randomBytes } from 'node:crypto'

/** How many hexadecimal characters of the digest are kept. */
const HASH_LENGTH = 12

/** A salt made once per process, so a hash cannot be matched to an account across processes. */
const PROCESS_SALT = randomBytes(16).toString('hex')

/**
 * Hashes an account key into 12 hexadecimal characters with HMAC-SHA256 under a salt. The same key
 * and salt always give the same hash, so the lines of one account can be correlated; without the
 * salt the hash cannot be turned back into the key or matched against a list of known accounts.
 *
 * This is for correlation in logs only. It is not an access control, it is not a token and it is
 * not unique: twelve characters are short on purpose, and two accounts can share one. The salt
 * defaults to one generated for this process; pass a salt to keep hashes the same across
 * processes.
 *
 * @param key The output of `encodeAccountKey`.
 * @param salt The salt. Defaults to the one generated for this process.
 * @returns 12 lowercase hexadecimal characters.
 */
export function hashAccountKey(key: string, salt: string = PROCESS_SALT): string {
  return createHmac('sha256', salt).update(key).digest('hex').slice(0, HASH_LENGTH)
}
